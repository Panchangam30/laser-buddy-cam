import type { Plan } from "./types";
import { instructionsFor, toolsFor, type RealtimeStatus, type Utterance, type VoiceSession, type VoiceOpts } from "./voice";
import { MicCapture, PcmPlayer, RATE, toBase64, fromBase64 } from "./audio";

const WS_URL = "wss://api.x.ai/v1/realtime";

/**
 * Live voice with Grok, over WebSocket.
 *
 * Grok's realtime API has no WebRTC transport, so this owns the whole audio
 * path: mic capture, PCM framing, and playback scheduling. Echo cancellation
 * comes from getUserMedia rather than from WebRTC's integrated AEC, which is
 * the main practical difference -- use headphones if it starts hearing itself.
 */
export class GrokVoiceSession implements VoiceSession {
  private ws: WebSocket | null = null;
  private mic = new MicCapture();
  private player = new PcmPlayer();
  private opts: VoiceOpts;
  private assistantBuf = "";
  private pendingTools = 0;

  constructor(opts: VoiceOpts) { this.opts = opts; }

  get live() { return this.ws?.readyState === WebSocket.OPEN; }

  async connect() {
    this.opts.onStatus("connecting");
    try {
      const tr = await fetch("/api/xai-realtime-token", { method: "POST" });
      const tok = await tr.json();
      if (!tr.ok) throw new Error(tok.detail || tok.error || `token HTTP ${tr.status}`);

      // The browser cannot set headers on a WebSocket, so the token rides in
      // the subprotocol field -- this is xAI's documented browser path.
      const ws = new WebSocket(WS_URL, [`xai-client-secret.${tok.token}`]);
      this.ws = ws;

      ws.onopen = () => {
        this.configure();
        void this.startMic();
        this.opts.onStatus("live");
      };
      ws.onmessage = (e) => this.onEvent(e.data);
      ws.onerror = () => this.opts.onStatus("error", "WebSocket error connecting to xAI");
      ws.onclose = (e) => {
        if (e.code !== 1000 && e.reason) this.opts.onStatus("error", `closed: ${e.reason}`);
        else this.opts.onStatus("idle");
        this.teardown();
      };
    } catch (e) {
      this.opts.onStatus("error", e instanceof Error ? e.message : String(e));
      this.disconnect();
    }
  }

  private configure() {
    this.send({
      type: "session.update",
      session: {
        voice: this.opts.voice ?? "atlas",
        instructions: instructionsFor(this.opts),
        turn_detection: { type: "server_vad" },
        tools: toolsFor(this.opts.mode),
        audio: {
          input: { format: { type: "audio/pcm", rate: RATE } },
          output: { format: { type: "audio/pcm", rate: RATE } },
        },
      },
    });
  }

  private async startMic() {
    try {
      await this.mic.start((pcm) => {
        this.send({ type: "input_audio_buffer.append", audio: toBase64(pcm.buffer) });
      });
    } catch (e) {
      this.opts.onStatus("error", `Microphone unavailable: ${e instanceof Error ? e.message : e}`);
    }
  }

  disconnect() {
    this.teardown();
    this.ws?.close(1000, "client closed");
    this.ws = null;
    this.opts.onStatus("idle");
  }

  private teardown() {
    this.mic.stop();
    this.player.stop();
  }

  setMuted(muted: boolean) { this.mic.muted = muted; }

  private send(ev: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(ev));
  }

  refreshContext(plan: Plan, step: number, live?: string, challenge = this.opts.challenge) {
    this.opts.plan = plan;
    this.opts.step = step;
    this.opts.challenge = challenge;
    this.send({
      type: "session.update",
      session: { instructions: instructionsFor(this.opts, live) },
    });
  }

  sendText(text: string) {
    this.send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    });
    this.send({ type: "response.create" });
    this.opts.onUtterance({ who: "you", text });
  }

  /**
   * Grok voice sessions do not accept images, so a frame cannot be handed to
   * the model directly. The caller describes it out-of-band instead and passes
   * the description in as text.
   */
  sendImage() {
    /* not supported by this provider -- see describeFrame in App */
  }

  private async onEvent(raw: unknown) {
    if (typeof raw !== "string") return;          // binary transport is off
    let ev: { type?: string; [k: string]: unknown };
    try { ev = JSON.parse(raw); } catch { return; }

    switch (ev.type) {
      case "response.output_audio.delta": {
        const b64 = (ev.delta ?? ev.audio) as string | undefined;
        if (b64) this.player.push(fromBase64(b64));
        break;
      }
      // Server VAD heard the student start talking -- stop speaking over them.
      case "input_audio_buffer.speech_started":
        this.player.clear();
        break;

      case "conversation.item.input_audio_transcription.updated":
      case "conversation.item.input_audio_transcription.completed": {
        const text = String(ev.transcript ?? "").trim();
        // xAI sends a cumulative transcript, so replace rather than append.
        if (text) this.opts.onUtterance({ who: "you", text, replace: true });
        break;
      }

      case "response.output_audio_transcript.delta":
        this.assistantBuf += String(ev.delta ?? "");
        break;
      case "response.output_audio_transcript.done": {
        const text = String(ev.transcript ?? this.assistantBuf).trim();
        this.assistantBuf = "";
        if (text) this.opts.onUtterance({ who: "assistant", text });
        break;
      }

      case "response.function_call_arguments.done": {
        const name = String(ev.name ?? "");
        const callId = String(ev.call_id ?? "");
        if (!name || !callId) break;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(String(ev.arguments ?? "{}")); } catch { /* junk args */ }

        this.pendingTools++;
        const output = await this.opts.onTool(name, args);
        this.send({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: callId, output },
        });
        // xAI: do not ask for a response until every pending call has replied.
        if (--this.pendingTools === 0) this.send({ type: "response.create" });
        break;
      }

      case "error":
        this.opts.onStatus("error", JSON.stringify(ev.error ?? ev).slice(0, 220));
        break;
    }
  }
}

export type { RealtimeStatus, Utterance };
