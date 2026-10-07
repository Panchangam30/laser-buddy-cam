import type { ExternalDevice, Part, Plan, Requirement, Step } from "./types.js";

export type TutorialCategory = "LEDs" | "Buttons" | "Analog" | "Servos" | "Sound";
export interface Tutorial {
  id: string; title: string; category: TutorialCategory; description: string;
  outputs: number; button?: boolean; knob?: boolean; body: string; test: string;
}
type Entry = [string, string, string, number, string, string, boolean?, boolean?];
const group = (category: TutorialCategory, entries: Entry[]): Tutorial[] => entries.map(
  ([id, title, description, outputs, body, test, button, knob]) => ({ id, title, description, outputs, body, test, button, knob, category }));

/** Authored examples; no analytics or model-generated wiring required. */
export const TUTORIALS: Tutorial[] = [
  ...group("Servos", [
    ["servo-button", "Button-controlled servo sweep", "Press a button to sweep a servo out and back.", 0, "if (pressed) { for (int a=0; a<=180; a+=2) { servo.write(a); delay(15); } for (int a=180; a>=0; a-=2) { servo.write(a); delay(15); } }", "Press once: the servo sweeps to 180° and returns.", true],
    ["servo-sweep", "Automatic servo sweep", "Move a servo smoothly without a button.", 0, "for (int a=0; a<=180; a++) { servo.write(a); delay(20); } for (int a=180; a>=0; a--) { servo.write(a); delay(20); }", "The unloaded horn travels slowly back and forth."],
    ["servo-knob", "Knob-controlled servo", "Turn a potentiometer to set the servo angle.", 0, "servo.write(map(analogRead(A0),0,1023,0,180)); delay(20);", "Turn the knob: the servo follows its position.", false, true],
    ["servo-toggle", "Button-toggle gate", "Press to open a gate; press again to close it.", 0, "static bool open=false; if (pressed) { open=!open; servo.write(open ? 120 : 20); }", "Each press alternates between 20° and 120°.", true],
    ["servo-step", "Servo angle stepper", "Advance the servo by 15 degrees per press.", 0, "static int angle=0; if (pressed) { angle+=15; if(angle>180)angle=0; servo.write(angle); }", "Each press advances the angle, then wraps to zero.", true],
    ["servo-hold", "Hold-to-open servo", "Open while the button is held down.", 0, "servo.write(down ? 100 : 10); delay(20);", "Hold to open; release to return.", true],
    ["servo-three", "Three-position servo", "Cycle through three preset positions.", 0, "static byte pos=0; const int angles[]={20,90,160}; if (pressed) { pos=(pos+1)%3; servo.write(angles[pos]); }", "Three presses cycle through 90°, 160°, and 20°.", true],
    ["servo-slow-knob", "Smooth servo controller", "Ease toward the angle chosen by a knob.", 0, "static int angle=90; int target=map(analogRead(A0),0,1023,20,160); if (angle<target) angle++; if (angle>target) angle--; servo.write(angle); delay(20);", "Turn quickly: the servo approaches the new angle slowly.", false, true],
    ["servo-speed", "Adjustable sweep speed", "Use a knob to change how fast a servo sweeps.", 0, "static int angle=20, dir=1; servo.write(angle); angle+=dir; if(angle>=160 || angle<=20) dir=-dir; delay(map(analogRead(A0),0,1023,5,40));", "Turn the knob to change the sweep speed.", false, true],
    ["servo-home", "Servo return-to-center", "Move with a knob and press to return to 90°.", 0, "servo.write(down ? 90 : map(analogRead(A0),0,1023,20,160)); delay(20);", "The knob sets angle; holding the button centers it.", true, true],
  ]),
  ...group("LEDs", [
    ["led-blink", "First LED blink", "Build an external LED circuit and blink once a second.", 1, "digitalWrite(5,HIGH); delay(1000); digitalWrite(5,LOW); delay(1000);", "The LED is on for one second, then off for one second."],
    ["led-double", "Double-flash beacon", "Flash twice, then pause.", 1, "for(byte i=0;i<2;i++){ digitalWrite(5,HIGH); delay(150); digitalWrite(5,LOW); delay(150); } delay(1000);", "Two short flashes repeat with a pause."],
    ["led-heartbeat", "Heartbeat light", "Make a paired heartbeat pulse.", 1, "digitalWrite(5,HIGH); delay(80); digitalWrite(5,LOW); delay(120); digitalWrite(5,HIGH); delay(180); digitalWrite(5,LOW); delay(850);", "A short and long flash repeat like a heartbeat."],
    ["led-fade", "Breathing LED", "Use PWM to smoothly fade an LED.", 1, "for(int b=0;b<=255;b++){analogWrite(5,b);delay(8);} for(int b=255;b>=0;b--){analogWrite(5,b);delay(8);}", "Brightness rises and falls smoothly."],
    ["led-sos", "SOS signal", "Send the SOS pattern with light.", 1, "const int pulses[]={150,150,150,450,450,450,150,150,150}; for(byte i=0;i<9;i++){digitalWrite(5,HIGH);delay(pulses[i]);digitalWrite(5,LOW);delay(150);} delay(1500);", "Three short, three long, then three short flashes."],
    ["led-nonblocking", "Blink without delay", "Use millis() to keep the loop responsive.", 1, "static unsigned long at=0; static bool on=false; if(millis()-at>=500){at=millis();on=!on;digitalWrite(5,on);}", "The LED toggles every half second."],
    ["led-traffic", "Mini traffic light", "Sequence red, yellow, and green LEDs.", 3, "digitalWrite(5,HIGH);delay(2000);digitalWrite(5,LOW);digitalWrite(10,HIGH);delay(2000);digitalWrite(10,LOW);digitalWrite(6,HIGH);delay(700);digitalWrite(6,LOW);", "Red, green, then yellow light one at a time."],
    ["led-chase", "Three-LED chaser", "Move a light across three LEDs.", 3, "for(byte i=0;i<3;i++){digitalWrite(leds[i],HIGH);delay(200);digitalWrite(leds[i],LOW);}", "The light moves from LED 1 to LED 3."],
    ["led-bounce", "Bouncing scanner", "Bounce a light back and forth.", 3, "const byte order[]={0,1,2,1};for(byte i=0;i<4;i++){digitalWrite(leds[order[i]],HIGH);delay(180);digitalWrite(leds[order[i]],LOW);}", "The center LED lights on both passes."],
    ["led-binary", "Binary light counter", "Show numbers zero through seven using three LEDs.", 3, "for(byte n=0;n<8;n++){for(byte i=0;i<3;i++)digitalWrite(leds[i],(n>>i)&1);delay(800);}", "LED patterns count from all off to all on."],
  ]),
  ...group("Buttons", [
    ["button-led", "Press-to-light LED", "Read a button with an internal pull-up.", 1, "digitalWrite(5,down);", "The LED lights only while you hold the button.", true],
    ["button-toggle", "Toggle LED switch", "Latch the LED state on each press.", 1, "static bool on=false;if(pressed){on=!on;digitalWrite(5,on);}", "Press and release repeatedly to toggle the LED.", true],
    ["button-inverse", "Release-to-light LED", "Learn how inverted button logic works.", 1, "digitalWrite(5,!down);", "The LED is normally on and turns off when pressed.", true],
    ["button-counter", "Button press counter", "Count debounced presses in Serial Monitor.", 1, "static unsigned long count=0;if(pressed){count++;Serial.println(count);}digitalWrite(5,down);", "Serial Monitor at 9600 baud shows one count per press.", true],
    ["button-three", "Three-light selector", "Choose one of three LEDs with a button.", 3, "static byte pick=0;if(pressed)pick=(pick+1)%3;for(byte i=0;i<3;i++)digitalWrite(leds[i],i==pick);", "Each press selects the next LED.", true],
    ["button-dimmer", "Button brightness steps", "Cycle through four brightness levels.", 1, "static byte level=0;const byte brightness[]={0,70,150,255};if(pressed){level=(level+1)%4;analogWrite(5,brightness[level]);}", "Each press changes LED brightness.", true],
    ["button-timer", "Ten-second light timer", "Press once to turn a light on temporarily.", 1, "static unsigned long started=0;static bool active=false;if(pressed){started=millis();active=true;}if(active && millis()-started>=10000)active=false;digitalWrite(5,active);", "One press lights the LED for ten seconds.", true],
    ["button-blink", "Hold-to-blink LED", "Blink only while the button is down.", 1, "digitalWrite(5,down && ((millis()/200)%2));", "Holding the button starts blinking; release stops it.", true],
    ["button-binary", "Button binary counter", "Show your press count on three LEDs.", 3, "static byte n=0;if(pressed)n=(n+1)%8;for(byte i=0;i<3;i++)digitalWrite(leds[i],(n>>i)&1);", "Presses count from zero through seven in binary.", true],
    ["button-long", "Long-press detector", "Distinguish a short tap from a one-second hold.", 1, "static unsigned long start=0;if(pressed)start=millis();digitalWrite(5,down && millis()-start>=1000);", "Hold for one second: the LED turns on.", true],
  ]),
  ...group("Analog", [
    ["analog-read", "Read a potentiometer", "Watch the raw analog value in Serial Monitor.", 0, "Serial.println(analogRead(A0));delay(100);", "Turning the knob changes values from about 0 to 1023.", false, true],
    ["analog-voltage", "Knob voltage meter", "Convert an analog reading to approximate volts.", 0, "Serial.println(analogRead(A0)*5.0/1023.0,2);delay(100);", "Serial Monitor shows approximately 0–5 V on an Uno R3.", false, true],
    ["analog-dimmer", "Knob LED dimmer", "Map the analog input to PWM brightness.", 1, "analogWrite(5,analogRead(A0)/4);", "Turning the knob smoothly changes LED brightness.", false, true],
    ["analog-blink", "Adjustable blink speed", "Control blinking speed with a knob.", 1, "int interval=map(analogRead(A0),0,1023,50,1000);digitalWrite(5,HIGH);delay(interval);digitalWrite(5,LOW);delay(interval);", "Turn the knob to slow or speed up blinking.", false, true],
    ["analog-threshold", "Analog threshold switch", "Turn an LED on above halfway.", 1, "digitalWrite(5,analogRead(A0)>512);", "The LED lights above the midpoint.", false, true],
    ["analog-window", "Safe-zone indicator", "Light the LED only inside a selected range.", 1, "int value=analogRead(A0);digitalWrite(5,value>=350 && value<=700);", "Only the middle section of the knob lights the LED.", false, true],
    ["analog-meter", "Three-LED level meter", "Show low, medium, or high readings.", 3, "int level=min(2,analogRead(A0)/342);for(byte i=0;i<3;i++)digitalWrite(leds[i],i==level);", "Different LEDs indicate the knob's low, middle, and high ranges.", false, true],
    ["analog-bar", "Three-LED bar graph", "Fill a bar as the analog value increases.", 3, "int count=map(analogRead(A0),0,1023,0,3);for(byte i=0;i<3;i++)digitalWrite(leds[i],i<count);", "More LEDs light as the knob approaches maximum.", false, true],
    ["analog-smoothing", "Smoothed analog reader", "Average several readings to reduce noise.", 0, "long total=0;for(byte i=0;i<16;i++){total+=analogRead(A0);delay(2);}Serial.println(total/16);delay(50);", "Serial Monitor shows a steady averaged reading.", false, true],
    ["analog-hysteresis", "Stable threshold indicator", "Use two thresholds to prevent flickering near the boundary.", 1, "static bool on=false;int value=analogRead(A0);if(value>600)on=true;if(value<400)on=false;digitalWrite(5,on);", "Turn up past 600 to light; below 400 to switch off.", false, true],
  ]),
  ...group("Sound", [
    ["sound-beep", "First piezo beep", "Make a passive piezo play a short tone.", 0, "tone(8,1000,150);delay(1000);", "A short beep repeats once a second."],
    ["sound-button", "Button doorbell", "Play a tone when the button is pressed.", 0, "if(pressed){tone(8,880,180);delay(220);tone(8,660,300);}", "Each press plays a two-note doorbell.", true],
    ["sound-hold", "Hold-to-buzz", "Keep a buzzer sounding while holding a button.", 0, "if(down)tone(8,700);else noTone(8);", "Press to sound; release for silence.", true],
    ["sound-knob", "Knob-controlled pitch", "Turn a potentiometer to change a tone.", 0, "tone(8,map(analogRead(A0),0,1023,200,2000));delay(20);", "Turn the knob to hear a rising or falling pitch.", false, true],
    ["sound-siren", "Mini siren", "Sweep a tone upward and downward.", 0, "for(int f=400;f<=1200;f+=10){tone(8,f);delay(10);}for(int f=1200;f>=400;f-=10){tone(8,f);delay(10);}", "Pitch rises and falls repeatedly."],
    ["sound-scale", "Musical scale", "Play eight notes from a major scale.", 0, "const int notes[]={262,294,330,349,392,440,494,523};for(byte i=0;i<8;i++){tone(8,notes[i],200);delay(260);}delay(1000);", "Eight ascending notes repeat."],
    ["sound-countdown", "Countdown beeper", "Speed up beeps before a final long note.", 0, "for(int interval=800;interval>=100;interval-=100){tone(8,900,70);delay(interval);}tone(8,1400,500);delay(1800);", "Beeps accelerate, then finish with a long tone."],
    ["sound-metronome", "Adjustable metronome", "Set a beat rate with a knob.", 0, "tone(8,1200,30);delay(map(analogRead(A0),0,1023,250,1500));", "The knob controls the interval between clicks.", false, true],
    ["sound-tune", "Button victory tune", "Trigger a short ascending celebration.", 0, "if(pressed){const int notes[]={523,659,784,1047};for(byte i=0;i<4;i++){tone(8,notes[i],160);delay(200);}}", "A button press plays a four-note tune.", true],
    ["sound-threshold", "Analog warning buzzer", "Sound an alert above a knob threshold.", 0, "if(analogRead(A0)>750)tone(8,1500);else noTone(8);", "The buzzer sounds in the top quarter of the knob range.", false, true],
  ]),
];

const wire = (id: string, label: string, pins: string[], color = "#2f7fff"): Part => ({ id, label, pins, color, kind: "wire" });

export function buildTutorial(id: string): Plan {
  const tutorial = TUTORIALS.find((item) => item.id === id);
  if (!tutorial) throw new Error("Unknown tutorial.");
  const ports = ["GND", ...["D5", "D6", "D10"].slice(0, tutorial.outputs),
    ...(tutorial.button ? ["D2"] : []), ...(tutorial.knob ? ["5V", "A0"] : []),
    ...(tutorial.category === "Servos" ? ["D9"] : []), ...(tutorial.category === "Sound" ? ["D8"] : [])];
  const parts: Part[] = [];
  const steps: Step[] = [];
  const requirements: Requirement[] = [];
  const devices: ExternalDevice[] = [{ id: "arduino", kind: "arduino-uno", label: "Arduino Uno", aliases: ["Arduino"],
    ports: ports.map((label) => ({ id: label.toLowerCase(), label })), visibleFromStep: 1, placement: { side: "front", order: 0 } }];
  const requirePart = (id: string, label: string, count = 1) => requirements.push({ id, label, count, availability: "unknown" });
  requirePart("uno", "Arduino Uno R3"); requirePart("board", "830-point breadboard"); requirePart("usb", "USB data cable");
  const step = (title: string, instruction: string, additions: Part[], manual = false) => {
    parts.push(...additions);
    steps.push({ id: `step-${steps.length + 1}`, n: steps.length + 1, title, instruction,
      kind: manual ? "configure" : "placement", completion: manual ? "manual" : "workspace",
      adds: manual ? [] : additions.map((part) => part.id), renders: manual ? additions.map((part) => part.id) : undefined });
  };
  steps.push({ id: "prepare", n: 1, title: "Prepare the workbench", kind: "safety", completion: "manual", adds: [],
    instruction: "Unplug USB and external power. Gather the required parts and identify their pin labels before wiring." });
  if (tutorial.outputs) { requirePart("leds", tutorial.outputs === 3 ? "Red, yellow, and green LEDs" : "LED", tutorial.outputs); requirePart("resistors", "220 Ω resistor", tutorial.outputs); }
  for (let i = 0; i < tutorial.outputs; i++) {
    const col = 10 + i * 10;
    const color = ["#ef4444", "#e8b33a", "#22c55e"][i];
    step(`Place LED ${i + 1} and its resistor`, `Place the LED anode in E${col} and cathode in E${col + 2}. Add a 220 Ω resistor between E${col + 2} and E${col + 5}.`, [
      { id: `led-${i}`, kind: "led", label: `LED ${i + 1}`, pins: [`E${col}`, `E${col + 2}`], polarised: true, color },
      { id: `r-${i}`, kind: "resistor", label: "220 Ω resistor", pins: [`E${col + 2}`, `E${col + 5}`], value: "220 ohm", color: "#d9c08a" },
    ]);
    step(`Wire LED ${i + 1}`, `Connect A${col} to Arduino D${[5, 6, 10][i]}. Connect A${col + 5} to Arduino GND.`, [
      wire(`led-signal-${i}`, "LED signal", [`A${col}`, `EXT:Arduino D${[5, 6, 10][i]}`]),
      wire(`led-ground-${i}`, "LED return", [`A${col + 5}`, "EXT:Arduino GND"], "#222222"),
    ]);
  }
  if (tutorial.button) {
    requirePart("button", "Tactile pushbutton");
    step("Place the button", "Place the button across the center channel using opposite contacts at E45 and F45. Check its paired legs before inserting.", [{ id: "button", kind: "button", label: "Pushbutton", pins: ["E45", "F45"], color: "#333333" }]);
    step("Wire the button", "Connect A45 to Arduino D2 and J45 to GND. The sketch uses INPUT_PULLUP: pressed means LOW.", [wire("button-signal", "Button input", ["A45", "EXT:Arduino D2"]), wire("button-ground", "Button ground", ["J45", "EXT:Arduino GND"], "#222222")]);
  }
  if (tutorial.knob) {
    requirePart("knob", "10 kΩ linear potentiometer");
    step("Place the potentiometer", "Use outer terminals at E50 and E54 and the center wiper at E52. Adapt the physical lead spacing without changing these electrical nodes.", [{ id: "knob", kind: "potentiometer", label: "10 kΩ potentiometer", pins: ["E50", "E52", "E54"], value: "10k ohm", color: "#2563eb" }]);
    step("Wire the analog input", "Connect A50 to 5V, A54 to GND, and center wiper A52 to A0.", [wire("knob-power", "Knob power", ["A50", "EXT:Arduino 5V"], "#e24b43"), wire("knob-ground", "Knob ground", ["A54", "EXT:Arduino GND"], "#222222"), wire("knob-signal", "Analog signal", ["A52", "EXT:Arduino A0"])]);
  }
  if (tutorial.category === "Servos") {
    requirePart("servo", "Small 5 V micro servo"); requirePart("supply", "Regulated 5 V servo supply suitable for your servo");
    const visibleFromStep = steps.length + 1;
    devices.push({ id: "servo", kind: "micro-servo", label: "Micro servo", aliases: ["Servo"], ports: ["signal", "5V", "GND"].map((label) => ({ id: label.toLowerCase(), label })), visibleFromStep, placement: { side: "right", order: 0 } },
      { id: "supply", kind: "power-supply", label: "5 V supply", aliases: ["Supply"], ports: [{ id: "positive", label: "+5V" }, { id: "ground", label: "GND" }], visibleFromStep, placement: { side: "left", order: 0 } });
    step("Connect servo power and control", "Connect servo signal to D9, servo 5V to the separate regulated 5 V supply, and servo GND to supply GND. Join supply GND to Arduino GND. Keep the horn unloaded for the first test.", [wire("servo-signal", "Servo control", ["EXT:Arduino D9", "EXT:Servo signal"], "#f2a23a"), wire("servo-power", "Servo power", ["EXT:Supply positive", "EXT:Servo 5V"], "#e24b43"), wire("servo-ground", "Servo ground", ["EXT:Supply ground", "EXT:Servo GND"], "#222222"), wire("common-ground", "Common ground", ["EXT:Supply ground", "EXT:Arduino GND"], "#222222")], true);
  }
  if (tutorial.category === "Sound") {
    requirePart("piezo", "Small passive piezo transducer (not a speaker or active buzzer)");
    devices.push({ id: "piezo", kind: "generic", label: "Passive piezo", aliases: ["Piezo"], ports: [{ id: "positive", label: "+" }, { id: "negative", label: "−" }], visibleFromStep: steps.length + 1, placement: { side: "right", order: 0 } });
    step("Connect the passive piezo", "Connect the small passive piezo + terminal to D8 and its − terminal to GND. Do not substitute a loudspeaker or high-current buzzer.", [wire("piezo-signal", "Tone output", ["EXT:Arduino D8", "EXT:Piezo positive"]), wire("piezo-ground", "Piezo ground", ["EXT:Arduino GND", "EXT:Piezo negative"], "#222222")], true);
  }
  requirePart("jumpers", "Jumper wires", parts.filter((part) => part.kind === "wire").length);
  const code = `${tutorial.category === "Servos" ? "#include <Servo.h>\nServo servo;\n" : ""}const byte leds[] = {5, 6, 10};
${tutorial.button ? "bool lastRaw=HIGH, stableButton=HIGH;\nunsigned long changedAt=0;" : ""}
void setup() {
  Serial.begin(9600);
  for (byte i=0; i<${tutorial.outputs}; i++) pinMode(leds[i],OUTPUT);
  ${tutorial.button ? "pinMode(2,INPUT_PULLUP);" : ""}
  ${tutorial.category === "Servos" ? "servo.attach(9); servo.write(20);" : ""}
  ${tutorial.category === "Sound" ? "pinMode(8,OUTPUT);" : ""}
}
void loop() {
  ${tutorial.button ? `bool raw=digitalRead(2);
  if(raw!=lastRaw){changedAt=millis();lastRaw=raw;}
  bool pressed=false;
  if(millis()-changedAt>=30 && raw!=stableButton){stableButton=raw;pressed=(raw==LOW);}
  bool down=(stableButton==LOW);` : ""}
  ${tutorial.body}
}
`;
  steps.push({ id: "upload", n: steps.length + 1, title: "Upload the Arduino sketch", kind: "code", completion: "manual", adds: [], artifactIds: ["sketch", "reference"], instruction: "Check all wiring while power is disconnected. Reconnect USB, select Arduino Uno and the correct port, and upload this sketch. Open Serial Monitor at 9600 baud when the lesson uses it." },
    { id: "test", n: steps.length + 2, title: "Test your project", kind: "test", completion: "test", adds: [], instruction: tutorial.test });
  const reference = tutorial.category === "Servos" ? "https://docs.arduino.cc/learn/electronics/servo-motors/" : "https://docs.arduino.cc/built-in-examples/";
  return { schemaVersion: 1, id: `tutorial-${id}`, revision: 1, title: tutorial.title, summary: tutorial.description,
    workspace: { profileId: "breadboard-830", profileVersion: 1 }, source: { kind: "builtin", templateId: id }, requirements, detected: [], devices, parts, steps,
    warnings: [{ severity: "info", message: "Disconnect power before changing wiring. These tutorials target an Arduino Uno R3." }],
    artifacts: [{ id: "sketch", kind: "code", title: `${tutorial.title} sketch`, language: "cpp", content: code }, { id: "reference", kind: "note", title: "Official Arduino reference", content: reference }],
  };
}
