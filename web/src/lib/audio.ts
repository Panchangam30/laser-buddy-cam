/**
 * PCM plumbing for the Grok voice session.
 *
 * Grok's realtime API is WebSocket-only, so unlike WebRTC nothing is done for
 * us: we capture mic audio, convert to 16-bit PCM, and schedule playback of the
 * PCM that comes back. Everything runs at 24kHz, which the API expects.
 */

export const RATE = 24000;

/** Capture worklet, inlined so there is no extra file to serve. */
const WORKLET = `
class Cap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(new Float32Array(ch));
    return true;
  }
}
registerProcessor('cap', Cap);
`;

export function f32ToPcm16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function pcm16ToF32(p: Int16Array): Float32Array {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) out[i] = p[i] / (p[i] < 0 ? 0x8000 : 0x7fff);
  return out;
}

export function toBase64(buf: ArrayBufferLike): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  // Chunked: String.fromCharCode(...bytes) blows the stack on large buffers.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}

/** Mic -> 16-bit PCM frames at 24kHz. */
export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private url = "";
  muted = false;

  async start(onFrame: (pcm: Int16Array) => void) {
    // Ask the browser to resample to 24kHz for us rather than doing it here.
    this.ctx = new AudioContext({ sampleRate: RATE });
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    this.url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(this.url);

    this.node = new AudioWorkletNode(this.ctx, "cap");
    this.node.port.onmessage = (e) => {
      if (!this.muted) onFrame(f32ToPcm16(e.data as Float32Array));
    };
    this.ctx.createMediaStreamSource(this.stream).connect(this.node);
    // Worklet must be connected to the graph to be pulled, but we don't want
    // to hear ourselves -- a zero-gain sink does that.
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.node.connect(sink).connect(this.ctx.destination);
  }

  stop() {
    this.node?.port.close();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    if (this.url) URL.revokeObjectURL(this.url);
    this.ctx = this.node = null;
    this.stream = null;
  }
}

/** Gapless playback of PCM chunks as they stream in. */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private cursor = 0;
  private sources = new Set<AudioBufferSourceNode>();

  private ensure(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext({ sampleRate: RATE });
      this.cursor = 0;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  push(pcm: Int16Array) {
    if (!pcm.length) return;
    const ctx = this.ensure();
    const buf = ctx.createBuffer(1, pcm.length, RATE);
    buf.getChannelData(0).set(pcm16ToF32(pcm));

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);

    // Small lead so the first chunk isn't scheduled in the past.
    const now = ctx.currentTime + 0.06;
    this.cursor = Math.max(this.cursor, now);
    src.start(this.cursor);
    this.cursor += buf.duration;

    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  /** Barge-in: drop everything still queued. */
  clear() {
    this.sources.forEach((s) => { try { s.stop(); } catch { /* already ended */ } });
    this.sources.clear();
    this.cursor = this.ctx ? this.ctx.currentTime : 0;
  }

  stop() {
    this.clear();
    this.ctx?.close();
    this.ctx = null;
  }
}
