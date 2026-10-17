export type SketchIssue = { line: number; severity: "error" | "warning"; title: string; help: string };
export type SketchReview = { issues: SketchIssue[]; purpose: string; actions: { line: number; text: string }[]; pins: string[] };
export type CodeToken = { text: string; kind: "comment" | "string" | "keyword" | "number" | "function" | "plain" };

export const SKETCH_STARTERS = [
  { id: "blink", title: "Blink an LED", code: `// Blink the Uno's built-in LED once every second.
const int ledPin = LED_BUILTIN;

void setup() {
  pinMode(ledPin, OUTPUT);
}

void loop() {
  digitalWrite(ledPin, HIGH);
  delay(1000);
  digitalWrite(ledPin, LOW);
  delay(1000);
}
` },
  { id: "button", title: "Button-controlled LED", code: `// Connect a button between D2 and GND. Pressed means LOW.
const int buttonPin = 2;
const int ledPin = LED_BUILTIN;

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
}

void loop() {
  int buttonState = digitalRead(buttonPin);
  digitalWrite(ledPin, buttonState == LOW ? HIGH : LOW);
}
` },
  { id: "sensor", title: "Read an analog sensor", code: `// Connect a compatible sensor's analog output to A0.
const int sensorPin = A0;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int reading = analogRead(sensorPin);
  Serial.println(reading);
  delay(250);
}
` },
];

// A small lexer keeps comments and quoted text out of static checks. It is not
// a C++ parser; expressions, preprocessor branches, and execution are not resolved.
export function tokenizeSketch(code: string): CodeToken[] {
  const expression = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\\n])*(?:"|(?=\n|$))|'(?:\\[^\n]|[^'\\\n])*(?:'|(?=\n|$))|\b(?:void|const|int|byte|bool|float|double|long|unsigned|char|return|if|else|for|while|true|false|HIGH|LOW|OUTPUT|INPUT_PULLUP|INPUT|LED_BUILTIN)\b|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*(?=\s*\()/g;
  const tokens: CodeToken[] = [];
  let end = 0;
  for (const match of code.matchAll(expression)) {
    if (match.index > end) tokens.push({ text: code.slice(end, match.index), kind: "plain" });
    const text = match[0];
    const kind = text.startsWith("//") || text.startsWith("/*") ? "comment" : /^["']/.test(text) ? "string" : /^\d/.test(text) ? "number" : /^(?:void|const|int|byte|bool|float|double|long|unsigned|char|return|if|else|for|while|true|false|HIGH|LOW|OUTPUT|INPUT_PULLUP|INPUT|LED_BUILTIN)$/.test(text) ? "keyword" : "function";
    tokens.push({ text, kind });
    end = match.index + text.length;
  }
  if (end < code.length) tokens.push({ text: code.slice(end), kind: "plain" });
  return tokens;
}

export function reviewSketch(code: string): SketchReview {
  const tokens = tokenizeSketch(code);
  const clean = tokens.map((token) => token.kind === "comment" || token.kind === "string" ? token.text.replace(/[^\n]/g, " ") : token.text).join("");
  const issues: SketchIssue[] = [];
  const actions: SketchReview["actions"] = [];
  const lineAt = (index: number) => clean.slice(0, index).split("\n").length;
  const issue = (line: number, severity: SketchIssue["severity"], title: string, help: string) => issues.push({ line, severity, title, help });

  for (const name of ["setup", "loop"]) {
    if (!new RegExp(`\\bvoid\\s+${name}\\s*\\(\\s*(?:void)?\\s*\\)\\s*\\{`).test(clean)) {
      issue(1, "error", `Missing ${name}() function`, `Add void ${name}() { … }. ${name === "setup" ? "Setup runs once when the board starts." : "Loop repeats after setup finishes."}`);
    }
  }
  const stack: { char: string; index: number }[] = [];
  const pairs: Record<string, string> = { "}": "{", ")": "(", "]": "[" };
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if ("{([".includes(char)) stack.push({ char, index: i });
    else if (pairs[char] && stack.pop()?.char !== pairs[char]) issue(lineAt(i), "error", `Unexpected “${char}”`, "Check the matching braces, parentheses, or brackets around this line.");
  }
  for (const open of stack) issue(lineAt(open.index), "error", `Unclosed “${open.char}”`, "Add the matching closing delimiter.");
  let offset = 0;
  for (const token of tokens) {
    if (token.text.startsWith("/*") && !token.text.endsWith("*/")) issue(lineAt(offset), "error", "Unclosed comment", "Finish the block comment with */.");
    if (token.kind === "string" && (token.text.length < 2 || token.text.at(-1) !== token.text[0] || /(?<!\\)(?:\\\\)*\\["']$/.test(token.text))) issue(lineAt(offset), "error", "Unclosed quoted text", "Close the string or character literal on the same line.");
    offset += token.text.length;
  }
  clean.split("\n").forEach((line, index) => {
    if (/^\s*(?:(?:int|byte|bool|float|long)\s+\w+\s*=\s*)?(?:pinMode|digitalWrite|digitalRead|analogRead|analogWrite|delay|tone|noTone|Serial\.(?:begin|print|println))\s*\([^;{}]*\)\s*$/.test(line)) issue(index + 1, "error", "Possible missing semicolon", "Arduino statements usually end with ;. Add one after this call.");
  });
  const constants = new Map<string, string>([["LED_BUILTIN", "13"]]);
  for (const match of clean.matchAll(/\b(?:const\s+)?(?:int|byte|uint8_t|auto)\s+(\w+)\s*=\s*(\d+|A[0-5]|LED_BUILTIN)\s*;|^\s*#define\s+(\w+)\s+(\d+|A[0-5]|LED_BUILTIN)\b/gm)) {
    constants.set(match[1] ?? match[3], match[2] ?? match[4]);
  }
  function resolve(value: string): string | null {
    let next = value.trim();
    const seen = new Set<string>();
    while (constants.has(next) && !seen.has(next)) { seen.add(next); next = constants.get(next)!; }
    return /^(?:\d+|A[0-5])$/.test(next) ? next : null;
  }
  const calls = [...clean.matchAll(/\b(pinMode|digitalWrite|digitalRead|analogRead|analogWrite|delay|millis|tone|noTone|Serial\.(?:begin|print|println))\s*\(([^();\n]*)\)/g)].map((match) => ({ name: match[1], args: match[2].split(",").map((arg) => arg.trim()), line: lineAt(match.index) }));
  const outputs = new Set(calls.filter((call) => call.name === "pinMode" && call.args[1] === "OUTPUT").map((call) => resolve(call.args[0])).filter(Boolean));
  const pins = new Set<string>();
  let reads = false, writes = false, serial = false, timing = false, sound = false;
  for (const call of calls) {
    const pin = resolve(call.args[0]);
    const pinLabel = pin ? (/^A/.test(pin) ? pin : Number(pin) >= 14 && Number(pin) <= 19 ? `A${Number(pin) - 14}` : `D${pin}`) : call.args[0];
    if (/^(?:pinMode|digital|analog|tone|noTone)/.test(call.name) && pin) pins.add(pinLabel);
    let text = "";
    if (call.name === "pinMode") text = `Configures ${pinLabel} as ${call.args[1] === "INPUT_PULLUP" ? "an input with an internal pull-up; a button to ground reads LOW when pressed" : call.args[1] === "OUTPUT" ? "an output" : call.args[1] === "INPUT" ? "an input" : `mode ${call.args[1] || "(missing)"}`}.`;
    if (call.name === "digitalWrite") { writes = true; text = `Sets ${pinLabel} to ${call.args[1] === "HIGH" ? "HIGH" : call.args[1] === "LOW" ? "LOW" : `the value of ${call.args[1]}`}.`; }
    if (call.name === "analogWrite") { writes = true; text = `Requests PWM on ${pinLabel} with duty value ${call.args[1]} (0–255 on Uno).`; }
    if (call.name === "digitalRead" || call.name === "analogRead") { reads = true; text = `Reads ${call.name === "analogRead" ? "an analog value (0–1023 on Uno)" : "a HIGH or LOW input"} from ${pinLabel}.`; }
    if (call.name === "delay") { timing = true; text = `Pauses execution for ${call.args[0]} milliseconds when this line is reached.`; }
    if (call.name === "millis") text = "Reads elapsed milliseconds since the sketch started, useful for timing without delay().";
    if (call.name === "Serial.begin") { serial = true; text = `Starts serial communication at ${call.args[0]} baud.`; }
    if (/^Serial\.print/.test(call.name)) { serial = true; text = `Sends a value to Serial Monitor${call.name === "Serial.println" ? " followed by a new line" : ""}.`; }
    if (call.name === "tone" || call.name === "noTone") { sound = true; text = call.name === "tone" ? `Requests a tone on ${pinLabel} at ${call.args[1]} Hz.` : `Stops the tone on ${pinLabel}.`; }
    if (text) actions.push({ line: call.line, text });
    if ((call.name === "digitalWrite" || call.name === "analogWrite") && pin && !outputs.has(pin)) issue(call.line, "warning", `Check output mode for ${pinLabel}`, "No simple pinMode(pin, OUTPUT) call was found for this pin. Add one in setup(), or confirm a helper or library configures it.");
    if (call.name === "analogWrite" && pin && !["3", "5", "6", "9", "10", "11"].includes(pin)) issue(call.line, "warning", `${pinLabel} is not a PWM pin on Uno`, "For variable PWM duty, use D3, D5, D6, D9, D10, or D11. Other Uno pins behave as digital outputs.");
    if (call.name === "analogWrite" && /^-?\d+$/.test(call.args[1] ?? "") && (Number(call.args[1]) < 0 || Number(call.args[1]) > 255)) issue(call.line, "warning", "PWM value outside 0–255", "Use a duty value between 0 and 255 for Arduino Uno.");
    if (call.name === "delay" && Number(call.args[0]) >= 1000) issue(call.line, "warning", "This delay blocks other work", "Long pauses can make buttons feel unresponsive. Consider millis() if the sketch must handle several things at once.");
  }
  if (calls.some((call) => /^Serial\.print/.test(call.name)) && !calls.some((call) => call.name === "Serial.begin")) issue(1, "warning", "Serial Monitor needs initialization", "Add Serial.begin(9600) in setup(), or confirm your helper initializes serial.");
  const effects = [reads && "reads inputs", writes && "controls outputs", serial && "uses serial communication", timing && "uses blocking delays", sound && "controls a tone"].filter(Boolean);
  const blinkPin = calls.find((call) => call.name === "digitalWrite" && call.args[1] === "HIGH" && resolve(call.args[0]) && calls.some((other) => other.name === "digitalWrite" && other.args[1] === "LOW" && resolve(other.args[0]) === resolve(call.args[0])));
  const pattern = blinkPin && timing ? `The HIGH/LOW writes and delays suggest a blinking output on D${resolve(blinkPin.args[0])}. ` : reads && writes ? "The input reads and output writes suggest an interactive control sketch. " : reads && serial ? "The input reads and serial printing suggest a sensor-monitoring sketch. " : "";
  const purpose = effects.length ? `${pattern}This sketch ${effects.join(", ")}. setup() initializes the board once; loop() repeats afterward. The walkthrough lists recognized calls in source order; conditions and helper functions determine which calls actually run.` : "No familiar Arduino I/O calls were recognized. Add setup() and loop(), or review any custom functions and libraries in the Arduino IDE. This local reviewer cannot infer the purpose of arbitrary C++ code.";
  return { issues: issues.sort((a, b) => a.line - b.line), purpose, actions, pins: [...pins] };
}
