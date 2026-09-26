import type { Plan } from "./types";

/**
 * A known-good plan used to develop the renderer without spending API calls,
 * and as the fallback when the camera has not been used yet.
 * A blinking LED is the canonical first breadboard circuit.
 */
export const MOCK_PLAN: Plan = {
  title: "LED blink circuit",
  summary:
    "An Arduino drives an LED through a current-limiting resistor. The classic " +
    "first circuit: it proves your board, your wiring and your upload all work.",
  detected: [
    { label: "Breadboard, 830 tie-point", count: 1, confidence: "high" },
    { label: "Arduino Uno", count: 1, confidence: "high" },
    { label: "LED, red, 5mm", count: 1, confidence: "high" },
    { label: "Resistor (bands not legible)", count: 1, confidence: "low", unreadable: true },
    { label: "Jumper wire", count: 2, confidence: "high" },
  ],
  parts: [
    { id: "led1", kind: "led", label: "LED (red)", pins: ["E20", "E22"],
      color: "#ff3b30", polarised: true },
    { id: "r1", kind: "resistor", label: "Resistor 220R", pins: ["E22", "E26"],
      color: "#d9c08a", value: "220 ohm" },
    { id: "w1", kind: "wire", label: "D13 to LED anode", pins: ["A20", "T+20"],
      color: "#2f7fff" },
    { id: "w2", kind: "wire", label: "Resistor to ground", pins: ["A26", "B-26"],
      color: "#1c1c1e" },
    { id: "w3", kind: "wire", label: "Ground rail to GND", pins: ["B-10", "B-4"],
      color: "#1c1c1e" },
  ],
  steps: [
    { n: 1, title: "Place the LED", adds: ["led1"],
      instruction:
        "Push the LED legs into E20 and E22. The longer leg is the anode and goes in E20.",
      warning: "An LED only conducts one way. Backwards, it simply will not light." },
    { n: 2, title: "Add the resistor", adds: ["r1"],
      instruction:
        "Bridge E22 to E26 with the 220 ohm resistor. It shares column 22 with the LED's short leg." },
    { n: 3, title: "Wire the signal", adds: ["w1"],
      instruction: "Run a jumper from Arduino pin 13 to A20, which is the same net as the LED anode." },
    { n: 4, title: "Wire the ground return", adds: ["w2", "w3"],
      instruction:
        "Jumper A26 down to the negative rail, then the rail across to the Arduino GND pin.",
      warning: "Without this the circuit is open and nothing happens." },
  ],
};
