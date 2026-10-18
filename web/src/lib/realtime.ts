import type { Plan } from "./types";
import { instructionsFor, toolsFor, type VoiceOpts, type VoiceSession } from "./voice";

/**
 * One Realtime voice session over WebRTC.
 *
 * WebRTC rather than a raw WebSocket because the browser then handles mic
 * capture, echo cancellation and jitter buffering itself -- without echo
 * cancellation the model hears its own voice through the speakers and
 * interrupts itself constantly.
 */
export class OpenAIVoiceSession implements VoiceSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private assistantBuf = "";
  /** Set by disconnect(). A connect still in flight must not come alive after it. */
  private closed = false;

  private opts: VoiceOpts;

  constructor(opts: VoiceOpts) {
    this.opts = opts;
  }

  get live() { return this.dc?.readyState === "open"; }

  async connect() {
    this.opts.onStatus("connecting");
    try {
      const instructions = instructionsFor(this.opts);
      const tr = await fetch("/api/realtime-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions, tools: toolsFor(this.opts.mode) }),
      });
      const tok = await tr.json();
      if (!tr.ok) throw new Error(tok.detail || tok.error || `token HTTP ${tr.status}`);
      if (this.closed) return;

      const pc = new RTCPeerConnection();
      this.pc = pc;

      // Remote audio -> speakers.
      this.audio = new Audio();
      this.audio.autoplay = true;
      pc.ontrack = (e) => { if (this.audio) this.audio.srcObject = e.streams[0]; };

      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (this.closed) { this.disconnect(); return; }
      this.mic.getTracks().forEach((t) => pc.addTrack(t, this.mic!));

      const dc = pc.createDataChannel("oai-events");
      this.dc = dc;
      dc.onmessage = (e) => this.onEvent(JSON.parse(e.data));
      dc.onopen = () => this.opts.onStatus("live");
      dc.onclose = () => { if (!this.closed) this.opts.onStatus("idle"); };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: { Authorization: `Bearer ${tok.token}`, "Content-Type": "application/sdp" },
      });
      if (!sdpRes.ok) throw new Error(`SDP exchange failed: ${sdpRes.status} ${(await sdpRes.text()).slice(0, 200)}`);

      const answer = await sdpRes.text();
      if (this.closed) { this.disconnect(); return; }
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (e) {
      this.opts.onStatus("error", e instanceof Error ? e.message : String(e));
      this.disconnect();
    }
  }

  disconnect() {
    this.closed = true;
    this.dc?.close();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.pc?.close();
    if (this.audio) this.audio.srcObject = null;
    this.dc = this.pc = null;
    this.mic = null;
    this.opts.onStatus("idle");
  }

  setMuted(muted: boolean) {
    this.mic?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
  }

  private send(ev: unknown) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(ev));
  }

  /** Push fresh context after the plan or step changes. */
  refreshContext(plan: Plan, step: number, live?: string, challenge = this.opts.challenge) {
    this.opts.plan = plan;
    this.opts.step = step;
    this.opts.challenge = challenge;
    this.send({
      type: "session.update",
      session: { type: "realtime", instructions: instructionsFor(this.opts, live) },
    });
  }

  /** Type instead of talking -- useful in a noisy lab, and testable. */
  sendText(text: string) {
    this.send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    });
    this.send({ type: "response.create" });
    this.opts.onUtterance({ who: "you", text });
  }

  /** Hand the model a camera frame, then ask it to comment. */
  sendImage(dataUrl: string, note = "Here is what the camera sees right now.") {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message", role: "user",
        content: [
          { type: "input_text", text: note },
          { type: "input_image", image_url: dataUrl },
        ],
      },
    });
  }

  private async onEvent(ev: { type: string; [k: string]: unknown }) {
    switch (ev.type) {
      // Assistant speech, streamed as text.
      case "response.output_audio_transcript.delta":
        this.assistantBuf += String(ev.delta ?? "");
        break;
      case "response.output_audio_transcript.done": {
        const text = String(ev.transcript ?? this.assistantBuf).trim();
        this.assistantBuf = "";
        if (text) this.opts.onUtterance({ who: "assistant", text });
        break;
      }
      // What the student said.
      case "conversation.item.input_audio_transcription.completed": {
        const text = String(ev.transcript ?? "").trim();
        if (text) this.opts.onUtterance({ who: "you", text });
        break;
      }
      case "response.done": {
        const out = (ev.response as { output?: unknown[] } | undefined)?.output ?? [];
        for (const item of out as { type?: string; name?: string; arguments?: string; call_id?: string }[]) {
          if (item.type !== "function_call" || !item.name || !item.call_id) continue;
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(item.arguments ?? "{}"); } catch { /* model sent junk */ }
          const result = await this.opts.onTool(item.name, args);
          this.send({
            type: "conversation.item.create",
            item: { type: "function_call_output", call_id: item.call_id, output: result },
          });
          this.send({ type: "response.create" });
        }
        break;
      }
      case "error":
        this.opts.onStatus("error", JSON.stringify(ev.error ?? ev).slice(0, 200));
        break;
    }
  }
}
