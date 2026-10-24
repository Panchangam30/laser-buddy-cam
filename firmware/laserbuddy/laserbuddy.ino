/*
  Controls the optional pan/tilt pointer used by Laser Buddy.
  Pan servo: D9. Tilt servo: D10. Laser switch: D7.

  Serial commands (115200 baud, Newline):
    P <pan> <tilt>   smooth move, e.g.  P 90 60
    J <pan> <tilt>   jump instantly
    L 1 / L 0        laser on / off
    C                center both servos, laser off
    ?                report current angles

  P and J take time to finish. The computer should wait for the "OK" reply
  before sending another command.
*/

#include <Servo.h>

const int PAN_PIN = 9, TILT_PIN = 10, LASER_PIN = 7;

// Limits keep the servos from hitting the frame. Tilt uses the servo's full
// travel so the beam can reach the near edge of the desk; if your bracket hits
// something at one end, bring that end in a few degrees (and match vision/laser.py).
const int PAN_MIN = 10,  PAN_MAX = 170;
const int TILT_MIN = 0, TILT_MAX = 180;
const unsigned long LASER_TIMEOUT_MS = 15000;   // laser turns itself off after 15 s idle

Servo panServo, tiltServo;
float panNow = 90, tiltNow = 90;
unsigned long lastCmd = 0;
bool laserOn = false;

// Keep each serial command in a small fixed-size buffer.
const byte LINE_MAX = 48;
char line[LINE_MAX];
byte lineLen = 0;
bool lineTooLong = false;

void setLaser(bool on) {
  laserOn = on;
  digitalWrite(LASER_PIN, on ? HIGH : LOW);
}

void writeServos() {
  panServo.writeMicroseconds(map((long)(panNow * 10), 0, 1800, 500, 2400));
  tiltServo.writeMicroseconds(map((long)(tiltNow * 10), 0, 1800, 500, 2400));
}

void moveTo(float p, float t, bool smooth) {
  p = constrain(p, (float)PAN_MIN, (float)PAN_MAX);
  t = constrain(t, (float)TILT_MIN, (float)TILT_MAX);
  if (!smooth) {
    panNow = p; tiltNow = t; writeServos();
    delay(350);
    return;
  }
  float dp = p - panNow, dt = t - tiltNow;
  int steps = max(1, (int)(max(fabs(dp), fabs(dt)) / 1.5));
  float p0 = panNow, t0 = tiltNow;
  for (int i = 1; i <= steps; i++) {
    float k = (float)i / steps;
    k = k * k * (3 - 2 * k);          // ease in/out
    panNow = p0 + dp * k; tiltNow = t0 + dt * k;
    writeServos();
    delay(12);
  }
  delay(150);
}

// Read the two angle values after the command letter.
bool parseTwo(char *cmd, float &p, float &t) {
  char *sp = strchr(cmd, ' ');
  if (!sp) return false;
  char *afterP, *afterT;
  p = strtod(sp, &afterP);
  if (afterP == sp) return false;          // no number where one was expected
  t = strtod(afterP, &afterT);
  return afterT != afterP;
}

void handle(char *cmd) {
  while (*cmd == ' ') cmd++;
  if (*cmd == 0) return;
  char c = toupper(cmd[0]);
  lastCmd = millis();

  if (c == 'P' || c == 'J') {
    float p, t;
    if (parseTwo(cmd, p, t)) {
      moveTo(p, t, c == 'P');
      Serial.print("OK "); Serial.print(panNow, 1); Serial.print(' '); Serial.println(tiltNow, 1);
    } else Serial.println("ERR usage: P <pan> <tilt>");
  } else if (c == 'L') {
    while (*cmd == ' ') cmd++;
    if ((cmd[1] == ' ' || cmd[1] == '\t') &&
        (cmd[2] == '0' || cmd[2] == '1') && cmd[3] == 0) {
      setLaser(cmd[2] == '1');
      Serial.println(laserOn ? "OK laser on" : "OK laser off");
    } else {
      Serial.println("ERR usage: L 0 or L 1");
    }
  } else if (c == 'C') {
    setLaser(false);
    moveTo(90, 90, true);
    Serial.println("OK centered");
  } else if (c == '?') {
    Serial.print("OK "); Serial.print(panNow, 1); Serial.print(' '); Serial.println(tiltNow, 1);
  } else {
    Serial.println("ERR unknown command");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LASER_PIN, OUTPUT);
  setLaser(false);
  panServo.attach(PAN_PIN, 500, 2400);
  tiltServo.attach(TILT_PIN, 500, 2400);
  writeServos();
  Serial.println("LaserBuddy ready");
}

void loop() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n' || ch == '\r') {
      line[lineLen] = 0;
      if (lineTooLong) {
        Serial.println("ERR command too long");
      } else {
        handle(line);
      }
      lineLen = 0;
      lineTooLong = false;
    } else if (lineLen < LINE_MAX - 1) {
      line[lineLen++] = ch;
    } else {
      lineTooLong = true;
    }
  }
  if (laserOn && millis() - lastCmd > LASER_TIMEOUT_MS) setLaser(false);
}
