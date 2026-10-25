import { useEffect, useRef, useState } from "react";
import type { Scene } from "../lib/objects";
import { streamUrl, type CameraSource } from "../lib/camera";

/**
 * Live webcam preview with a capture button. Capture downscales to 1024px on the
 * long side before encoding -- full-resolution frames cost more tokens without
 * helping the model read anything.
 *
 * With `source="service"` the vision service owns the camera and this only shows
 * its stream; the browser's own camera is not opened at all.
 */
export function CameraPanel({
  onCapture, busy, registerGrab, floating = false, hidden = false, scene,
  source = "browser", serviceError = "", onSwitchCamera, onUseBrowser, onUseService,
}: {
  onCapture: (dataUrl: string) => void;
  busy: boolean;
  /** Picture-in-picture over the board, bottom right. */
  floating?: boolean;
  /** Kept mounted (frames are still grabbed from it) but not shown. */
  hidden?: boolean;
  /** Tracked objects, boxed over the video so you see what Buddy sees. */
  scene?: Scene;
  /** Hands the parent a function to grab a frame on demand (used by voice). */
  registerGrab?: (fn: () => string | null) => void;
  /** Who reads the webcam; "unknown" opens nothing until it is decided. */
  source?: CameraSource;
  /** Why the service cannot read its camera, if it cannot. */
  serviceError?: string;
  onSwitchCamera?: () => void;
  onUseBrowser?: () => void;
  onUseService?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const sourceRef = useRef(source); sourceRef.current = source;
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [streamN, setStreamN] = useState(0);

  // The service's stream: ready once a frame has decoded, and reconnected if it
  // drops (a service restart ends the response).
  useEffect(() => {
    if (source !== "service") return;
    setReady(false);
    setError("");
    const id = window.setInterval(() => {
      const img = imgRef.current;
      setReady(Boolean(img && img.naturalWidth > 0));
    }, 400);
    return () => window.clearInterval(id);
  }, [source, streamN]);

  useEffect(() => {
    if (source !== "browser") return;
    setReady(false);
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          // Wait for actual video data, not just for the stream to be handed
          // over. A camera that is granted but not yet producing frames left a
          // black rectangle sitting there looking like a fault.
          videoRef.current.addEventListener(
            "loadeddata", () => setReady(true), { once: true });
        }
      })
      .catch((e) => setError(
        e?.name === "NotAllowedError"
          ? "Camera blocked. Allow camera access for this site and reload."
          : `Camera unavailable: ${e?.message ?? e}`
      ));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [source]);

  function grab(): string | null {
    // Whichever is showing: the service's stream (same origin through the API
    // proxy, so the canvas is not tainted) or the browser's own video.
    const img = sourceRef.current === "service" ? imgRef.current : null;
    const v = img ? null : videoRef.current;
    const w = img ? img.naturalWidth : v?.videoWidth ?? 0;
    const h = img ? img.naturalHeight : v?.videoHeight ?? 0;
    if (!w || !(img ?? v)) return null;
    const scale = Math.min(1, 1024 / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    c.getContext("2d")!.drawImage((img ?? v)!, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.9);
  }

  useEffect(() => { registerGrab?.(grab); }, [registerGrab]);

  function capture() {
    const d = grab();
    if (d) onCapture(d);
  }

  const cls = ["camera", floating && "camera-pip", hidden && "camera-hidden"]
    .filter(Boolean).join(" ");

  return (
    <div className={cls} aria-hidden={hidden || undefined}>
      {error ? (
        <p className="camera-error">{error}</p>
      ) : (
        <>
          <div className="camera-frame" data-ready={ready}>
            {source === "service" ? (
              <img ref={imgRef} className="cam-feed" src={streamUrl(streamN)} alt="Camera"
                onError={() => window.setTimeout(() => setStreamN((n) => n + 1), 2000)} />
            ) : (
              <video ref={videoRef} autoPlay playsInline muted />
            )}
            {ready && scene && scene.size[0] > 0 && (
              <svg className="cam-boxes" viewBox={`0 0 ${scene.size[0]} ${scene.size[1]}`}
                preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                {scene.objects.filter((o) => o.tracking).map((o) => (
                  <g key={o.id}>
                    <rect x={o.box[0]} y={o.box[1]} width={o.box[2]} height={o.box[3]} rx={8} />
                    <text x={o.box[0] + 6} y={Math.max(30, o.box[1] - 10)}>{o.label}</text>
                  </g>
                ))}
              </svg>
            )}
            {!ready && (
              <p className="camera-waiting">
                {source === "service" && serviceError ? serviceError : "Waiting for the camera"}
              </p>
            )}
          </div>
          {source === "service" && (onSwitchCamera || onUseBrowser) && (
            <div className="camera-source">
              {onSwitchCamera && <button className="pill ghost sm" onClick={onSwitchCamera}>Switch camera</button>}
              {onUseBrowser && <button className="pill ghost sm" onClick={onUseBrowser}>Use browser camera</button>}
            </div>
          )}
          {source === "browser" && onUseService && (
            <div className="camera-source">
              <button className="pill ghost sm" onClick={onUseService}
                title="The vision service reads the webcam itself, so laser checks keep working when this window is hidden">
                Let the service read the camera
              </button>
            </div>
          )}
          <button className="capture" onClick={capture} disabled={!ready || busy}>
            {busy ? "Working out the circuit…" : "Scan the bench"}
          </button>
        </>
      )}
    </div>
  );
}
