import { buildTutorial, TUTORIALS } from "./tutorials";
import { SKETCH_STARTERS } from "./sketch";

export interface CodeExample {
  id: string; title: string; category: string; description: string; code: string;
  explanation: string[]; expected: string; parts: string[];
}

export const CODE_LIBRARY: CodeExample[] = [
  ...SKETCH_STARTERS.map((starter, index) => ({
    ...starter, id: `basic-${starter.id}`, category: "Basics",
    description: ["Blink the Uno's onboard LED without an external circuit.", "Use an input pull-up to control the onboard LED with a button.", "Print an analog input to Serial Monitor."][index],
    explanation: [
      ["ledPin names the Uno's built-in LED, normally D13.", "setup() configures that pin as an output once.", "loop() writes HIGH, waits 1000 ms, writes LOW, and waits again. The complete cycle takes about two seconds."],
      ["Connect the button between D2 and GND; the internal pull-up holds D2 HIGH when released.", "setup() enables INPUT_PULLUP on D2 and configures the built-in LED as OUTPUT.", "loop() reads D2. The conditional expression turns the LED on when the button reads LOW, and off when it reads HIGH."],
      ["Connect a compatible analog signal to A0 with a shared ground.", "setup() opens serial communication at 9600 baud.", "loop() reads A0, prints the 0–1023 reading, and waits 250 ms. Set Serial Monitor to 9600 baud."],
    ][index],
    expected: ["The onboard LED stays on for one second, then off for one second.", "Pressing the button lights the onboard LED; releasing it turns the LED off.", "Serial Monitor shows roughly four analog readings per second."][index],
    parts: ["Arduino Uno", ...(index === 1 ? ["Pushbutton", "Jumper wires"] : index === 2 ? ["Compatible analog sensor or potentiometer", "Jumper wires"] : [])],
  })),
  ...TUTORIALS.map((tutorial): CodeExample => {
    const plan = buildTutorial(tutorial.id);
    return {
      id: tutorial.id, title: tutorial.title, category: tutorial.category, description: tutorial.description,
      code: plan.artifacts!.find((artifact) => artifact.kind === "code")!.content,
      expected: tutorial.test,
      parts: plan.requirements.map((part) => `${part.count} × ${part.label}`),
      explanation: [
        tutorial.description,
        `setup() starts Serial Monitor at 9600 baud${tutorial.outputs ? ` and configures ${tutorial.outputs} LED output${tutorial.outputs === 1 ? "" : "s"} on ${[5, 6, 10].slice(0, tutorial.outputs).map((n) => `D${n}`).join(", ")}` : ""}.`,
        ...(tutorial.button ? ["The button connects D2 to GND. INPUT_PULLUP means pressed is LOW. The loop waits for 30 ms of stable readings, sets down while held, and emits pressed once for each new press."] : []),
        ...(tutorial.knob ? ["The potentiometer wiper connects to A0. analogRead(A0) returns 0–1023, which the loop can map to brightness, timing, pitch, or angle."] : []),
        ...(tutorial.category === "Servos" ? ["The Servo library sends control pulses on D9. servo.write() requests an angle; power the servo from a suitable regulated supply and share ground with the Uno."] : []),
        ...(tutorial.category === "Sound" ? ["tone() drives a small passive piezo on D8. Its frequency is in hertz; noTone() stops it. A duration argument makes a finite tone."] : []),
        `The project-specific loop should produce this behavior: ${tutorial.test}`,
        ...(tutorial.body.includes("delay(") ? ["delay() blocks the sketch for the requested milliseconds. This is easy to follow, but it can postpone input handling during a sequence."] : []),
        ...(tutorial.body.includes("millis()") ? ["millis() measures elapsed time so the sketch can check timing without pausing the whole loop."] : []),
      ],
    };
  }),
];

export const CODE_CATEGORIES = ["Basics", "LEDs", "Buttons", "Analog", "Servos", "Sound"];
