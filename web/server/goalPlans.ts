function stamp() { return new Date().toISOString(); }

export interface GoalResult {
  ok: true;
  plan: Record<string, unknown>;
}

const SERVO_CODE = `#include <Servo.h>

Servo servo;
const int buttonPin = 2;
const int servoPin = 9;

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  servo.attach(servoPin);
  servo.write(0);
}

void loop() {
  if (digitalRead(buttonPin) == LOW) {
    for (int angle = 0; angle <= 180; angle += 2) {
      servo.write(angle);
      delay(15);
    }
    for (int angle = 180; angle >= 0; angle -= 2) {
      servo.write(angle);
      delay(15);
    }
    while (digitalRead(buttonPin) == LOW) delay(10);
  }
}`;

function servoButtonPlan(goal: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: `goal-servo-button-${Date.now().toString(36)}`,
    revision: 1,
    title: "Button-controlled servo sweep",
    summary: "Pressing the pushbutton makes a small servo sweep to 180 degrees and return. The button uses the Arduino's internal pull-up, so no guessed resistor value is needed.",
    workspace: { profileId: "breadboard-830", profileVersion: 1 },
    source: { kind: "goal", goal, generatedAt: stamp() },
    requirements: [
      { id: "arduino", label: "Arduino Uno", count: 1, availability: "unknown" },
      { id: "breadboard", label: "830-point breadboard", count: 1, availability: "unknown" },
      { id: "servo", label: "Small 5 V micro servo", count: 1, availability: "unknown", note: "Use a separate regulated 5 V supply for a larger servo." },
      { id: "button", label: "Tactile pushbutton", count: 1, availability: "unknown" },
      { id: "jumpers", label: "Jumper wire", count: 6, availability: "unknown" }
    ],
    detected: [],
    observedInventory: [],
    devices: [
      {
        id: "arduino", kind: "arduino-uno", label: "Arduino Uno",
        color: "#0d7d8c", aliases: ["Arduino", "Uno"], visibleFromStep: 1,
        placement: { side: "front", order: 0 },
        ports: ["D2", "D9", "5V", "GND"].map((label) => ({ id: label.toLowerCase(), label })),
      },
      {
        id: "servo", kind: "micro-servo", label: "Micro servo",
        color: "#2563eb", aliases: ["Servo"], visibleFromStep: 4,
        placement: { side: "right", order: 0 },
        ports: ["signal", "5V", "GND"].map((label) => ({ id: label.toLowerCase(), label })),
      },
    ],
    parts: [
      { id: "button1", kind: "button", label: "Pushbutton", pins: ["E20", "F20"], color: "#333333", value: "", polarised: false },
      { id: "button-signal", kind: "wire", label: "Button to Arduino D2", pins: ["A20", "EXT:Arduino D2"], color: "#2f7fff", value: "", polarised: false },
      { id: "button-ground", kind: "wire", label: "Button to ground rail", pins: ["J20", "B-20"], color: "#1c1c1e", value: "", polarised: false },
      { id: "ground-common", kind: "wire", label: "Ground rail to Arduino GND", pins: ["B-8", "EXT:Arduino GND"], color: "#1c1c1e", value: "", polarised: false },
      { id: "servo-signal", kind: "wire", label: "Arduino D9 to servo signal", pins: ["EXT:Arduino D9", "EXT:Servo signal"], color: "#f2a23a", value: "", polarised: false },
      { id: "servo-power", kind: "wire", label: "Arduino 5V to servo power", pins: ["EXT:Arduino 5V", "EXT:Servo 5V"], color: "#e24b43", value: "", polarised: false },
      { id: "servo-ground", kind: "wire", label: "Arduino GND to servo ground", pins: ["EXT:Arduino GND", "EXT:Servo GND"], color: "#24262b", value: "", polarised: false }
    ],
    steps: [
      { id: "place-button", n: 1, kind: "placement", completion: "workspace", title: "Place the button", adds: ["button1"], instruction: "Place the pushbutton across the centre channel with the used terminals in E20 and F20.", warning: "Tactile buttons have internally paired legs. Keep the body across the centre channel so the two sides are separate nodes." },
      { id: "wire-button", n: 2, kind: "placement", completion: "workspace", title: "Wire the input", adds: ["button-signal"], instruction: "Run a jumper from A20 to Arduino digital pin 2." },
      { id: "ground-button", n: 3, kind: "placement", completion: "workspace", title: "Ground the button", adds: ["button-ground", "ground-common"], instruction: "Connect J20 to the negative rail, then connect that rail to Arduino GND." },
      { id: "connect-servo", n: 4, kind: "configure", completion: "manual", title: "Connect the servo", adds: [], renders: ["servo-signal", "servo-power", "servo-ground"], instruction: "Connect the servo signal lead to Arduino D9, ground to Arduino GND, and the red lead to Arduino 5V for this small micro servo.", warning: "Do not power a larger servo from the Arduino 5 V pin. Use a separate regulated supply and always share ground with the Arduino." },
      { id: "upload-code", n: 5, kind: "code", completion: "manual", title: "Upload the sketch", adds: [], artifactIds: ["arduino-sketch"], instruction: "Open the Arduino sketch below, select your Uno and port, then upload it." },
      { id: "test-build", n: 6, kind: "test", completion: "test", title: "Test the sweep", adds: [], instruction: "Power the circuit and press the button once. The servo should sweep out and return; disconnect power if it chatters or the Arduino resets." }
    ],
    warnings: [
      { severity: "warn", message: "Servo current depends on the model. Use a separate regulated 5 V supply if it can draw more than the Arduino USB supply can safely provide.", blocksPower: true }
    ],
    artifacts: [
      { id: "arduino-sketch", kind: "code", title: "Arduino servo sweep sketch", language: "cpp", content: SERVO_CODE }
    ],
    problem: "Confirm the servo's current requirement before powering it. Larger servos need a separate regulated 5 V supply with a common ground."
  };
}

export function planForGoal(goal: string): GoalResult | null {
  const value = goal.toLowerCase();
  if (value.includes("servo") && (value.includes("button") || value.includes("press"))) {
    return { ok: true, plan: servoButtonPlan(goal) };
  }
  return null;
}
