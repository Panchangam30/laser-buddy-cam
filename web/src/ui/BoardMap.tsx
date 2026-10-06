import { useEffect, useState } from "react";
import { visionDebugUrl } from "../lib/world";

/**
 * What the detector actually sees: the board straightened out, with a box and a
 * hole reference on everything it has found.
 *
 * Worth having on screen rather than buried in a log. When a part is reported in
 * the wrong holes the cause is almost always visible here in a second -- the
 * board outline caught the edge of a notebook, or two parts touching were read
 * as one -- and a student who can see that can fix it by moving the camera.
 */
export function BoardMap({ onClose, live }: { onClose: () => void; live: boolean }) {
  const [view, setView] = useState<"rect" | "frame">("rect");
  const [broken, setBroken] = useState(false);
  const [, refresh] = useState(0);

  // The URL carries a timestamp, so each refresh fetches a new frame.
  const src = visionDebugUrl(view);

  useEffect(() => {
    if (!live) return;
    // Slower than the tracking loop on purpose: this is for watching, and a new
    // JPEG four times a second is a lot of decoding for no extra insight.
    const id = window.setInterval(() => refresh((tick) => tick + 1), 700);
    return () => window.clearInterval(id);
  }, [live]);

  return (
    <div className="boardmap">
      <div className="boardmap-bar">
        <strong>What the detector sees</strong>
        <button className={view === "rect" ? "on" : ""} onClick={() => setView("rect")}>
          Straightened
        </button>
        <button className={view === "frame" ? "on" : ""} onClick={() => setView("frame")}>
          Camera
        </button>
        <button onClick={onClose}>Close</button>
      </div>
      {broken ? (
        <p className="hint">
          No frame has been analysed yet — turn tracking on and point the camera
          at the board.
        </p>
      ) : (
        <img src={src} alt="annotated view of the board" onError={() => setBroken(true)}
             onLoad={() => setBroken(false)} />
      )}
    </div>
  );
}
