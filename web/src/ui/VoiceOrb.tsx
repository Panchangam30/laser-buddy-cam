import type { RealtimeStatus } from "../lib/voice";

/**
 * The voice assistant as an orb floating over the board: click to talk, click
 * again to hang up. Pure CSS -- layered drifting gradients clipped to a circle
 * -- so it costs nothing while the 3D view is rendering.
 */
export function VoiceOrb({ status, error, muted, onStart, onStop, onMute }: {
  status: RealtimeStatus;
  error: string;
  muted: boolean;
  onStart: () => void;
  onStop: () => void;
  onMute: () => void;
}) {
  const live = status === "live";
  const busy = status === "connecting";
  const caption = busy ? "Connecting…" : live ? (muted ? "Muted" : "Listening") : "Talk to the TA";

  return (
    <div className={`voiceorb ${status} ${muted ? "muted" : ""}`}>

      <div className="orb-wrap">
        <button className="orb" onClick={live || busy ? onStop : onStart}
          aria-label={live || busy ? "End conversation with the TA" : "Talk to the TA"}
          title={live || busy ? "End conversation" : "Talk to the TA"}>
          <span className="orb-base" />
          <span className="orb-cloud a" />
          <span className="orb-cloud b" />
          <span className="orb-shine" />
        </button>
        {live && (
          <button className={`orb-mute ${muted ? "on" : ""}`} onClick={onMute}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
            title={muted ? "Unmute" : "Mute"}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="3" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              {muted && <path d="M4 4l16 16" />}
            </svg>
          </button>
        )}
      </div>

      <span className="orb-caption">{caption}</span>
      {error && <p className="orb-error">{error}</p>}
    </div>
  );
}
