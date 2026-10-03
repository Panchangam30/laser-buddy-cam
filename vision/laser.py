"""Serial link to the LaserBuddy pan/tilt head.

Speaks the protocol in firmware/laserbuddy/laserbuddy.ino. Two things about that
firmware shape this file:

  * `P` and `J` block for the whole duration of the move -- up to about 800 ms --
    and the board cannot read serial while it is moving. The Uno's input buffer
    is 64 bytes, so streaming commands at it loses them silently. Every command
    here therefore waits for its "OK" line before the next one is sent.
  * The laser switches itself off after 15 seconds with no command. That is a
    good safety default and is left alone; when the host wants the laser to stay
    on it says so again, rather than the firmware being changed to trust us.
"""

from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass

try:
    import serial
    import serial.tools.list_ports
except ImportError:                      # pragma: no cover - optional dependency
    serial = None                        # type: ignore[assignment]

#: Arduino's USB vendor id. Used to pick the right port without guessing names.
ARDUINO_VID = 0x2341

#: The Uno resets when the port is opened; nothing it prints before this is real.
BOOT_WAIT_S = 2.0

#: Longest a single command may take. A full-sweep smooth move is ~800 ms.
REPLY_TIMEOUT_S = 3.0

#: Probes allowed when opening the link, and the pause between them. The first
#: can arrive while the bootloader still has the port, so one is not enough.
PROBE_ATTEMPTS = 4
PROBE_GAP_S = 0.45

#: Re-assert the laser inside the firmware's 15 s timeout.
KEEPALIVE_S = 9.0

#: Must match the firmware's limits, or the host aims somewhere the head will
#: silently clamp and the calibration learns a lie.
PAN_MIN, PAN_MAX = 10.0, 170.0
TILT_MIN, TILT_MAX = 20.0, 160.0


@dataclass
class Pose:
    pan: float
    tilt: float


def find_port() -> str | None:
    """The most likely LaserBuddy port, or None."""
    if serial is None:
        return None
    ports = list(serial.tools.list_ports.comports())
    for p in ports:
        if p.vid == ARDUINO_VID:
            return p.device
    # Some clones report no vid; fall back to the usual macOS/Linux names, and
    # never to Bluetooth or the debug console, which are not it.
    for p in ports:
        name = p.device.lower()
        if ("usbmodem" in name or "usbserial" in name or "ttyacm" in name
                or "ttyusb" in name):
            return p.device
    return None


class LaserLink:
    """One serial connection, with the command lock the firmware requires."""

    def __init__(self, port: str | None = None, baud: int = 115200) -> None:
        self.port = port
        self.baud = baud
        self.ser: "serial.Serial | None" = None
        self.pose = Pose(90.0, 90.0)
        self.laser_on = False
        self.error = ""
        self.banner = ""
        self._lock = threading.RLock()
        self._last_cmd = 0.0
        self._keepalive: threading.Thread | None = None
        self._stop = threading.Event()
        self._dead = False

    # ------------------------------------------------------------- connection

    @property
    def connected(self) -> bool:
        """True only while the port is open AND has not failed fatally.

        `is_open` alone is not enough, and the difference matters. Unplug the
        board and the handle stays "open" indefinitely while every write fails
        with ENXIO. Anything asking "are we connected?" is told yes, so nothing
        ever reconnects, and the rig looks broken until the process is
        restarted -- with an error about the port that points at the hardware
        rather than at this.
        """
        return self.ser is not None and self.ser.is_open and not self._dead

    def connect(self, port: str | None = None) -> bool:
        """Open the port and wait out the bootloader. Returns success."""
        if serial is None:
            self.error = "pyserial is not installed. Run: pip install -r requirements.txt"
            return False
        self.disconnect()
        target = port or self._best_port()
        if not target:
            self.error = "No Arduino found. Check the USB cable."
            return False

        self._dead = False
        try:
            self.ser = serial.Serial(target, self.baud, timeout=REPLY_TIMEOUT_S)
        except Exception as e:
            self.ser = None
            busy = "Resource busy" in str(e) or getattr(e, "errno", None) == 16
            self.error = (
                f"{target} is already open in another program -- close the "
                f"Arduino IDE's Serial Monitor and try again"
                if busy else f"could not open {target}: {e}")
            return False

        self.port = target
        # Opening the port resets the board. Anything it says before the banner
        # is bootloader noise, so wait it out and clear it.
        time.sleep(BOOT_WAIT_S)

        # Probe a few times rather than once. Opening the port resets the Uno,
        # and the bootloader runs for about a second before handing over; a
        # probe that lands in that window is half-eaten, and the sketch then
        # parses the leftovers as a command it does not know. The board is fine
        # -- it answered -- so one mistimed probe must not fail the connection.
        self.banner = ""
        for attempt in range(PROBE_ATTEMPTS):
            with self._lock:
                if self.ser is None:
                    break
                self.ser.reset_input_buffer()
                reply = self._command("?") or ""
            if reply.startswith("OK"):
                self.banner = reply
                break
            self.banner = reply
            if not self.connected:
                break            # link torn down; its own message is better
            time.sleep(PROBE_GAP_S)

        if not self.connected:
            return False
        if not self.banner.startswith("OK"):
            self.error = (f"{target} answered {self.banner!r} rather than an angle "
                          f"report -- is the LaserBuddy sketch on this board?")
            self.disconnect()
            return False

        self.error = ""
        self._parse_pose(self.banner)
        self._start_keepalive()
        return True

    def _best_port(self) -> str | None:
        """The port to try, preferring the one that worked last time.

        Only if it still exists. macOS names the device after the USB socket it
        is in, so replugging the board into a different port of a hub brings it
        back as a different file -- cu.usbmodem1101 becomes cu.usbmodem1201.
        Remembering the old name without checking means every later connect
        retries a path that is gone, reporting a missing file while the board
        sits there working on the port right next to it.
        """
        if self.port and os.path.exists(self.port):
            return self.port
        found = find_port()
        if found and found != self.port:
            self.port = None          # the remembered one is stale; let it go
        return found

    def disconnect(self) -> None:
        self._stop.set()
        with self._lock:
            if self.ser is not None:
                try:
                    if self.laser_on:
                        self._command("L 0")
                except Exception:
                    pass                 # going away anyway; do not mask the reason
                try:
                    self.ser.close()
                except Exception:
                    pass
            self.ser = None
        self.laser_on = False

    # ---------------------------------------------------------------- commands

    def _command(self, cmd: str) -> str | None:
        """Send one line and return its reply. Caller must hold the lock."""
        if self.ser is None:
            return None
        try:
            self.ser.reset_input_buffer()
            self.ser.write((cmd.strip() + "\n").encode())
            self.ser.flush()
            self._last_cmd = time.time()
            # The firmware answers exactly one line per command, after the move
            # has finished. A blank read means it timed out.
            reply = self.ser.readline().decode(errors="replace").strip()
            if not reply:
                # Silence is not a valid answer: the firmware replies to every
                # command. Usually the board has gone away, or reset under us.
                self._mark_dead("the board stopped answering")
                return None
            return reply
        except Exception as e:
            # Any failure here tears the link down so the next call rebuilds it.
            #
            # Not just the ones that look fatal: pyserial wraps the underlying
            # OSError in a SerialException and drops its errno, so the code that
            # would distinguish "the board was unplugged" from a passing glitch
            # is gone by the time we see it -- only the message survives, and
            # matching on message text is a trap that breaks on the next
            # pyserial release. Reconnecting costs two seconds and happens only
            # after something already went wrong; not reconnecting leaves every
            # later command failing against a handle that can never work again.
            self._mark_dead(f"lost the link to the board ({e})")
            return None

    def _mark_dead(self, why: str) -> None:
        """Tear the link down so a later call can rebuild it."""
        self._dead = True
        self.error = why
        self.laser_on = False
        self._stop.set()
        try:
            if self.ser is not None:
                self.ser.close()
        except Exception:
            pass
        self.ser = None

    def command(self, cmd: str) -> str | None:
        with self._lock:
            return self._command(cmd)

    def _parse_pose(self, reply: str | None) -> None:
        if not reply or not reply.startswith("OK"):
            return
        bits = reply.split()
        if len(bits) >= 3:
            try:
                self.pose = Pose(float(bits[1]), float(bits[2]))
            except ValueError:
                pass

    def move(self, pan: float, tilt: float, smooth: bool = True) -> bool:
        """Aim the head. Angles are clamped here as well as in the firmware.

        Clamping on both sides is deliberate: the firmware clamps to protect the
        servos, and this clamps so the caller is told the truth about where the
        head actually went. Calibration that believes an out-of-range angle was
        reached learns a mapping that is wrong everywhere.
        """
        pan = max(PAN_MIN, min(PAN_MAX, float(pan)))
        tilt = max(TILT_MIN, min(TILT_MAX, float(tilt)))
        with self._lock:
            reply = self._command(f"{'P' if smooth else 'J'} {pan:.1f} {tilt:.1f}")
        self._parse_pose(reply)
        return bool(reply and reply.startswith("OK"))

    def set_laser(self, on: bool) -> bool:
        with self._lock:
            reply = self._command(f"L {1 if on else 0}")
        if reply and reply.startswith("OK"):
            self.laser_on = on
            return True
        return False

    def centre(self) -> bool:
        with self._lock:
            reply = self._command("C")
        if reply and reply.startswith("OK"):
            self.pose = Pose(90.0, 90.0)
            self.laser_on = False
            return True
        return False

    def read_pose(self) -> Pose:
        with self._lock:
            self._parse_pose(self._command("?"))
        return self.pose

    # --------------------------------------------------------------- keepalive

    def _start_keepalive(self) -> None:
        """Hold the laser on past the firmware's idle timeout, but only while on.

        The 15 second cutout is a safety feature, not a bug: a laser left burning
        because a browser tab was closed is exactly what it is there to prevent.
        So this only runs while the host is deliberately pointing at something,
        and it stops the moment the laser is turned off or the link drops.
        """
        self._stop.clear()

        def run() -> None:
            while not self._stop.wait(1.0):
                if not self.connected:
                    return
                if self.laser_on and time.time() - self._last_cmd > KEEPALIVE_S:
                    with self._lock:
                        self._command("L 1")

        self._keepalive = threading.Thread(target=run, daemon=True)
        self._keepalive.start()

    def status(self) -> dict:
        return {
            "connected": self.connected,
            "port": self.port,
            "pan": round(self.pose.pan, 1),
            "tilt": round(self.pose.tilt, 1),
            "laserOn": self.laser_on,
            "error": self.error,
        }
