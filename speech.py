"""Text-to-speech via xAI's Grok TTS, with playback on macOS.

Kept separate from identify.py on purpose: speech is an enhancement, so every
failure here degrades to silence rather than breaking identification.

    POST https://api.x.ai/v1/tts  ->  raw MP3 bytes
"""

import os
import subprocess
import tempfile
import threading

import requests

TTS_URL = "https://api.x.ai/v1/tts"
VOICES_URL = "https://api.x.ai/v1/tts/voices"
# ~450 chars is about 30s of speech. Longer than that and students stop
# listening -- the full text is on screen anyway.
MAX_CHARS = 450


class Speaker:
    """Synthesises and plays speech in the background. Never raises."""

    def __init__(self, enabled=True, voice=None, language="en", speed=None):
        self.voice = voice or os.environ.get("XAI_VOICE_ID", "eve")
        self.language = language
        try:
            self.speed = float(speed if speed is not None
                               else os.environ.get("TTS_SPEED", "1.1"))
        except ValueError:
            self.speed = 1.1
        self.speed = min(max(self.speed, 0.7), 1.5)   # xAI accepts 0.7-1.5
        self.key = os.environ.get("XAI_API_KEY", "").strip()
        self._proc = None
        self._lock = threading.Lock()

        self.enabled = bool(enabled and self.key)
        # Distinguish "turned off" from "can't work" so main can warn once.
        self.reason = ""
        if enabled and not self.key:
            self.reason = ("XAI_API_KEY not set in .env -- answers will be "
                           "shown but not spoken")

    def list_voices(self):
        r = requests.get(VOICES_URL, headers={"Authorization": f"Bearer {self.key}"},
                         timeout=30)
        r.raise_for_status()
        return r.json()

    def stop(self):
        """Cut off whatever is currently playing."""
        with self._lock:
            if self._proc and self._proc.poll() is None:
                self._proc.terminate()
            self._proc = None

    def say(self, text):
        """Speak text in a background thread. Returns immediately."""
        if not self.enabled or not text.strip():
            return
        threading.Thread(target=self._run, args=(text[:MAX_CHARS],),
                         daemon=True).start()

    def _run(self, text):
        try:
            audio = self._synthesize(text)
        except requests.HTTPError as e:
            code = e.response.status_code
            hint = {400: "check XAI_API_KEY in .env -- a malformed key reads as 400",
                    401: "check XAI_API_KEY in .env",
                    403: "this key isn't allowed to use TTS",
                    404: f"voice '{self.voice}' not found -- try --voices",
                    429: "rate limited by xAI"}.get(code, "")
            # xAI puts the real reason in the body; a bare status code helps nobody.
            body = (e.response.text or "").strip().replace("\n", " ")[:160]
            print(f"  [tts] xAI returned {code}" + (f" -- {hint}" if hint else ""))
            if body:
                print(f"  [tts] {body}")
            return
        except Exception as e:
            print(f"  [tts] {type(e).__name__}: {e}")
            return
        self._play(audio)

    def _synthesize(self, text):
        r = requests.post(
            TTS_URL,
            headers={"Authorization": f"Bearer {self.key}",
                     "Content-Type": "application/json"},
            json={"text": text, "voice_id": self.voice,
                  "language": self.language, "speed": self.speed},
            timeout=60,
        )
        r.raise_for_status()
        # Default response is raw audio bytes; guard against a JSON error body
        # arriving with a 200 status.
        if r.headers.get("content-type", "").startswith("application/json"):
            raise RuntimeError(f"expected audio, got JSON: {r.text[:200]}")
        return r.content

    def _play(self, audio):
        path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
                f.write(audio)
                path = f.name
            self.stop()                      # barge-in: drop the previous answer
            with self._lock:
                self._proc = subprocess.Popen(
                    ["afplay", path],
                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                proc = self._proc
            _, err = proc.communicate()
            # afplay refuses audio whose content doesn't match the extension, so
            # a silent failure here would look exactly like "the voice didn't work".
            # Exit code is negative when stop() terminated it, which is expected.
            if proc.returncode > 0:
                detail = err.decode(errors="replace").strip()
                print(f"  [tts] afplay failed ({proc.returncode})"
                      + (f": {detail}" if detail else ""))
        except FileNotFoundError:
            print("  [tts] 'afplay' not found -- playback needs macOS")
        except Exception as e:
            print(f"  [tts] playback failed: {type(e).__name__}: {e}")
        finally:
            if path:
                try:
                    os.unlink(path)
                except OSError:
                    pass


def spoken_summary(result):
    """Turn the identification JSON into something worth hearing.

    Reading every field aloud is tedious -- a student listening wants the name,
    what it is, and the thing that will bite them. The rest stays on screen.
    """
    name = str(result.get("name", "") or "").strip()
    what = str(result.get("what_it_is", "") or "").strip()
    watch = str(result.get("watch_out", "") or "").strip()
    conf = str(result.get("confidence", "") or "").lower()
    reshoot = str(result.get("reshoot", "") or "").strip()

    parts = []
    if name:
        parts.append(f"This looks like {name}." if conf == "low" else f"{name}.")
    if what:
        parts.append(what)
    if watch:
        parts.append(f"Watch out: {watch}")
    if conf == "low" and reshoot:
        parts.append(f"I'm not confident though. {reshoot}")
    return " ".join(parts)
