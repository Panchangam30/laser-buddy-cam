import { useEffect, useRef, useState } from "react";

/**
 * Live webcam preview with a capture button. Capture downscales to 1024px on the
 * long side before encoding -- full-resolution frames cost more tokens without
 * helping the model read anything.
 */
export function CameraPanel({ onCapture, busy, registerGrab }: {
  onCapture: (dataUrl: string) => void;
  busy: boolean;
  /** Hands the parent a function to grab a frame on demand (used by voice). */
  registerGrab?: (fn: () => string | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
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
  }, []);

  function grab(): string | null {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const scale = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.9);
  }

  useEffect(() => { registerGrab?.(grab); }, [registerGrab]);

  function capture() {
    const d = grab();
    if (d) onCapture(d);
  }

  return (
    <div className="camera">
      {error ? (
        <p className="camera-error">{error}</p>
      ) : (
        <>
          <div className="camera-frame" data-ready={ready}>
            <video ref={videoRef} autoPlay playsInline muted />
            {!ready && <p className="camera-waiting">Waiting for the camera</p>}
          </div>
          <button className="capture" onClick={capture} disabled={!ready || busy}>
            {busy ? "Working out the circuit…" : "Scan the bench"}
          </button>
        </>
      )}
    </div>
  );
}
