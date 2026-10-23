import type { Part, Plan } from "../lib/types";

export type HubCategoryId =
  | "start" | "power" | "upload" | "breadboard" | "leds" | "inputs"
  | "sensors" | "motion" | "displays" | "code" | "libraries" | "safety";

export interface HubCategory {
  id: HubCategoryId;
  title: string;
  short: string;
  icon: string;
  color: string;
  checks: string[];
  causes: string[];
  topics: string[];
}

export interface HubProblem {
  id: string;
  category: HubCategoryId;
  title: string;
  symptom: string;
  causes: string[];
  steps: string[];
  safety?: string;
  keywords: string[];
  level: "First steps" | "Getting confident";
  resource: { label: string; url: string };
}

export interface BuildGuide {
  id: string;
  title: string;
  description: string;
  time: string;
  level: string;
  parts: string[];
  steps: string[];
  resource: string;
}

export interface ChallengeHint {
  title: string;
  text: string;
  partIds: string[];
  holes: string[];
}

export interface TroubleshootingChallenge {
  id: string;
  title: string;
  kicker: string;
  prompt: string;
  difficulty: "Starter" | "Builder";
  faultyPlan: Plan;
  solutionPlan: Plan;
  options: { id: string; label: string; correct: boolean; feedback: string }[];
  hints: ChallengeHint[];
  safety?: string;
  relatedCategory: HubCategoryId;
}

const OFFICIAL = {
  learn: "https://docs.arduino.cc/learn/",
  start: "https://docs.arduino.cc/learn/starting-guide/getting-started-arduino/",
  examples: "https://docs.arduino.cc/built-in-examples/",
  reference: "https://docs.arduino.cc/language-reference/",
  support: "https://support.arduino.cc/hc/en-us",
  upload: "https://support.arduino.cc/hc/en-us/sections/360003198300-Uploading",
};

/**
 * Eighteen real search intents per category produce 216 concise help records.
 * Category-level checks keep advice consistent while the symptom copy remains
 * specific enough for a beginner to recognize their exact problem.
 */
export const HUB_CATEGORIES: HubCategory[] = [
  {
    id: "start", title: "Start here", short: "Boards, pins, sketches, and your first five minutes.", icon: "01", color: "#2f6bd8",
    causes: ["The board or port has not been selected yet.", "A first-time setup step was skipped.", "The board is connected with a charge-only USB cable."],
    checks: ["Disconnect any extra wires and start with only the Arduino and USB cable.", "Choose the exact board model in the IDE.", "Choose the port that appears when the board is plugged in.", "Open Blink from File → Examples → 01.Basics and upload it."],
    topics: ["Arduino does nothing when first connected", "I cannot find the Arduino IDE", "I do not know which Arduino board I have", "The power light does not turn on", "I cannot find the board menu", "I cannot find the port menu", "I do not know what a sketch is", "I do not know where setup goes", "I do not know where loop goes", "The built-in LED will not blink", "The board gets warm", "The board disconnects when touched", "I cannot tell GND from 5V", "I do not know which pins are digital", "I do not know which pins are analog", "My first project feels too complicated", "I connected the board but nothing opened", "I need a safe first test"],
  },
  {
    id: "power", title: "Power & USB", short: "When lights flicker, boards reset, or USB disappears.", icon: "02", color: "#ef7b62",
    causes: ["The USB cable carries power but not data.", "The circuit is drawing more current than the board or computer can supply.", "Power and ground are connected to the wrong rails."],
    checks: ["Unplug external power and remove the circuit from the Arduino.", "Try a known data-capable USB cable and another USB port.", "Check that 5V never touches GND directly.", "Reconnect one section at a time and watch for the first reset."],
    topics: ["Arduino powers on but computer cannot see it", "Arduino keeps restarting", "Power LED flickers", "USB port shuts down", "Board works on USB but not battery", "Board works on battery but not USB", "9V battery becomes hot", "Vin pin does not power the circuit", "5V rail reads zero", "Breadboard power rail is dead", "Voltage drops when motor starts", "Servo makes Arduino reset", "Laptop reports USB overcurrent", "Board powers through an input pin", "Two power supplies are connected", "Power disappears across a split rail", "Circuit only works when USB is touched", "External supply and Arduino have no common ground"],
  },
  {
    id: "upload", title: "Upload & IDE", short: "Compiler messages, ports, drivers, and uploads.", icon: "03", color: "#7ca8ff",
    causes: ["The selected board or port does not match the connected device.", "Another program is using the serial port.", "The sketch has a compile error before upload begins."],
    checks: ["Read the first red error line, not only the final summary.", "Confirm Tools → Board and Tools → Port.", "Close Serial Monitor and other apps using the port.", "Press Reset once, then upload the unmodified Blink example."],
    topics: ["Upload says no device found", "Upload says programmer is not responding", "Upload stays on uploading", "Port menu is greyed out", "Port disappears during upload", "Wrong board is selected", "Sketch compiles but will not upload", "Exit status 1 appears", "Expected semicolon error appears", "Not declared in this scope appears", "Multiple definition error appears", "Board package is missing", "IDE cannot download board package", "Serial port permission is denied", "Old sketch uploads instead of new sketch", "Upload succeeds but code does not run", "Bootloader may be missing", "IDE freezes while compiling"],
  },
  {
    id: "breadboard", title: "Breadboards & wiring", short: "Rows, rails, loose wires, and one-column mistakes.", icon: "04", color: "#74c69d",
    causes: ["The breadboard joins holes differently than the drawing suggests.", "A jumper is one row or column away from its intended node.", "A rail is split in the middle or not connected to the Arduino."],
    checks: ["Disconnect power before moving any wire.", "Trace one electrical node at a time from source to GND.", "Check hole labels and remember A–E and F–J are separate.", "Bridge split rails explicitly and test the smallest section first."],
    topics: ["Circuit works only when wire is pressed", "Jumper is one column off", "Breadboard center gap is misunderstood", "Rows A to E are not connected to F to J", "Power rail is split in the middle", "Positive and negative rails are swapped", "Top and bottom rails are not linked", "Loose component lead misses the spring", "Component legs share the same node", "Button straddles the board incorrectly", "IC is not across the center channel", "Rail colors do not match wiring", "Circuit works without following the diagram", "Long jumpers make mistakes hard to see", "Bare leads touch each other", "Breadboard has a damaged contact", "Ground wire goes to the wrong rail", "Schematic does not match physical layout"],
  },
  {
    id: "leds", title: "LEDs & resistors", short: "Dark LEDs, wrong polarity, and safe current limiting.", icon: "05", color: "#ff6b6b",
    causes: ["The LED is backwards or connected to the wrong node.", "There is no complete path from the output pin to GND.", "The resistor value is too large, too small, or missing."],
    checks: ["Disconnect power and identify the LED anode and cathode.", "Confirm a 220 Ω to 1 kΩ resistor is in series with the LED.", "Check the Arduino pin named in the sketch.", "Test the LED with Blink before adding other parts."],
    topics: ["LED never turns on", "LED is backwards", "LED burned out immediately", "LED is very dim", "LED stays on all the time", "LED flickers unexpectedly", "LED fades instead of switching", "Wrong color LED turns on", "RGB LED colors are mixed up", "RGB LED common pin is wrong", "Resistor is missing", "Resistor value is too high", "Resistor value is too low", "Resistor color bands are hard to read", "LED legs were cut to equal length", "PWM brightness does not change", "Several LEDs make the board reset", "LED works on pin 13 but not another pin"],
  },
  {
    id: "inputs", title: "Buttons & inputs", short: "Floating pins, backwards logic, and unreliable presses.", icon: "06", color: "#c59cff",
    causes: ["The input is floating because it has no pull-up or pull-down.", "The two internally joined button legs were mistaken for separate contacts.", "The code expects HIGH when the wiring produces LOW."],
    checks: ["Print the raw input value in Serial Monitor.", "Place a four-leg button across the breadboard center channel.", "Use INPUT_PULLUP for the simplest button circuit.", "Remember that a pressed INPUT_PULLUP button reads LOW."],
    topics: ["Button press is never detected", "Button always reads pressed", "Button reading jumps randomly", "Button works backwards", "One press counts many times", "Four-leg button is rotated wrong", "Button is connected on the same side", "Pull-up resistor is missing", "Pull-down resistor is missing", "INPUT_PULLUP logic is confusing", "Switch works only when touched", "Potentiometer always reads zero", "Potentiometer always reads 1023", "Potentiometer value jumps", "Joystick center value is wrong", "Tilt switch chatters", "Touch input triggers by itself", "Digital input was connected to analog output"],
  },
  {
    id: "sensors", title: "Sensors & analog", short: "Noisy readings, wrong pins, calibration, and voltage ranges.", icon: "07", color: "#57c7d4",
    causes: ["Signal, power, and ground pins are in the wrong order.", "The sketch reads a different pin than the wire uses.", "The sensor needs calibration, settling time, or a stable supply."],
    checks: ["Find the module pin labels instead of relying only on wire color.", "Confirm the sensor voltage matches the Arduino board.", "Print the raw reading before converting it to units.", "Test with short wires and a simple official example."],
    topics: ["Analog sensor always reads zero", "Analog sensor always reads maximum", "Sensor value is noisy", "Sensor value changes when USB moves", "Wrong analog pin is read", "Photoresistor reacts backwards", "Thermistor temperature is unrealistic", "Ultrasonic sensor always returns zero", "Ultrasonic distance jumps", "PIR sensor never settles", "Soil sensor corrodes quickly", "Sensor module power pins are reversed", "3.3V sensor is connected to 5V", "I2C sensor is not detected", "Sensor needs calibration", "Reference voltage is wrong", "Long sensor wire adds noise", "Two sensors affect each other"],
  },
  {
    id: "motion", title: "Motors & servos", short: "Jitter, resets, drivers, flyback, and shared grounds.", icon: "08", color: "#f2a65a",
    causes: ["The motor is drawing too much current from an Arduino pin or 5V rail.", "The control signal has no common ground with the motor supply.", "A driver, flyback diode, or separate supply is missing."],
    checks: ["Disconnect power if anything is hot, noisy, or smells unusual.", "Never power a DC motor directly from an Arduino I/O pin.", "Use a suitable driver and external supply with shared GND.", "Test at low speed with the mechanism unloaded."],
    topics: ["Servo does not move", "Servo jitters", "Servo moves to the wrong angle", "Servo makes Arduino reset", "Servo buzzes at its limit", "Servo wires are in the wrong order", "DC motor does not spin", "DC motor spins only one direction", "Motor is weak", "Motor driver becomes hot", "Flyback diode is missing", "Transistor switch does not turn on", "Stepper vibrates but does not rotate", "Stepper coil order is wrong", "Motor noise changes sensor readings", "Relay clicks but load stays off", "Relay makes Arduino reset", "External motor supply lacks common ground"],
  },
  {
    id: "displays", title: "Displays & communication", short: "Serial, I²C, SPI, LCDs, and address mix-ups.", icon: "09", color: "#5cc8a1",
    causes: ["The device address, baud rate, or pin mapping is wrong.", "SDA/SCL or SPI wires are swapped or missing a common ground.", "The display has power but its contrast or initialization is wrong."],
    checks: ["Run an I²C scanner or the library's smallest example.", "Match the sketch baud rate to Serial Monitor.", "Confirm the board-specific SDA, SCL, MOSI, MISO, and SCK pins.", "Reduce the circuit to one communication device."],
    topics: ["Serial Monitor shows gibberish", "Serial Monitor shows nothing", "Wrong baud rate is selected", "LCD backlight is on but text is blank", "LCD shows solid blocks", "LCD contrast is wrong", "I2C scanner finds nothing", "I2C address is wrong", "SDA and SCL are swapped", "Two I2C devices share an address", "OLED remains black", "Seven-segment digits are scrambled", "Common anode display acts backwards", "SPI display stays white", "Chip select pin is wrong", "Serial input includes hidden newline", "Bluetooth serial does not connect", "Communication stops with long wires"],
  },
  {
    id: "code", title: "Code & logic", short: "Timing, variables, loops, conditions, and debugging.", icon: "10", color: "#8ba7ff",
    causes: ["The program is running, but a condition or variable has an unexpected value.", "A blocking delay prevents other work from happening.", "A pin mode, comparison, or loop boundary is incorrect."],
    checks: ["Add short Serial.print statements before and after the suspicious line.", "Test one input and one output independently.", "Check pinMode, comparison operators, and braces.", "Replace long delays with the BlinkWithoutDelay pattern when tasks must overlap."],
    topics: ["setup runs but loop seems not to", "Code inside if never runs", "Code inside if always runs", "Equals and double equals are mixed up", "Loop runs one time too many", "Variable resets unexpectedly", "Integer calculation loses decimals", "millis timing wraps or behaves oddly", "delay blocks button reading", "Serial print changes timing", "Array index goes out of range", "Function returns the wrong value", "Pin mode was not set", "Analog and digital pin functions are mixed", "PWM value is outside 0 to 255", "State machine gets stuck", "Debounce logic misses presses", "Code works until another feature is added"],
  },
  {
    id: "libraries", title: "Libraries & boards", short: "Missing headers, examples, versions, and board packages.", icon: "11", color: "#d69eff",
    causes: ["The required library or board package is not installed.", "Two installed libraries provide the same header.", "The example targets a different board or an older library version."],
    checks: ["Install libraries through Library Manager when possible.", "Open an example bundled with the installed library.", "Read which library path the compiler selected.", "Check the library README for board and voltage compatibility."],
    topics: ["No such file or directory for a header", "Library has no compatible architecture", "Multiple libraries were found", "Example menu does not show a library", "Library Manager cannot install", "ZIP library will not import", "Board package install fails", "Board definition disappeared", "Library example uses different pins", "Library API changed after update", "Old tutorial code no longer compiles", "Library name conflicts with sketch file", "Wrong Servo library is selected", "I2C library call is deprecated", "Memory warning appears during compile", "Sketch is too big for the board", "Dynamic memory is almost full", "Custom board URL is incorrect"],
  },
  {
    id: "safety", title: "Safety & damaged hardware", short: "Heat, smells, shorts, polarity, and when to unplug.", icon: "12", color: "#ff806c",
    causes: ["Power or polarity is incorrect.", "A load is drawing more current than the component can handle.", "A short circuit or damaged part is present."],
    checks: ["Unplug USB and external power immediately.", "Let hot parts cool before touching or moving them.", "Inspect for reversed power, touching leads, and damaged insulation.", "Do not reconnect power until the fault is understood."],
    topics: ["A component is hot", "Arduino smells burned", "USB cable becomes warm", "Battery becomes hot", "LED flashed and stopped working", "Voltage regulator is too hot", "Electrolytic capacitor is reversed", "Capacitor is bulging", "IC was inserted backwards", "5V and GND are shorted", "Motor is connected directly to a pin", "Relay load exceeds its rating", "Mains voltage project is planned", "Lithium battery is damaged", "Board was powered from two sources", "Metal touched the board underside", "Smoke appeared during testing", "I am not sure whether it is safe to power"],
  },
];

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const HUB_PROBLEMS: HubProblem[] = HUB_CATEGORIES.flatMap((category) =>
  category.topics.map((topic, index) => ({
    id: `${category.id}-${slug(topic)}`,
    category: category.id,
    title: topic,
    symptom: `You may notice that ${topic.charAt(0).toLowerCase()}${topic.slice(1)}. Start with the simple checks below; most beginner problems are one connection or setting, not a broken board.`,
    causes: category.causes,
    steps: category.checks,
    safety: category.id === "safety" || category.id === "power" || category.id === "motion"
      ? "Remove power before changing wiring. If anything is hot, swollen, smoking, or smells burned, stop and ask an experienced adult or instructor for help."
      : undefined,
    keywords: [...topic.toLowerCase().split(/\s+/), category.title.toLowerCase(), `help-${index + 1}`],
    level: index < 10 ? "First steps" : "Getting confident",
    resource: {
      label: category.id === "upload" || category.id === "libraries" ? "Official Arduino support" : "Official Arduino learning guide",
      url: category.id === "upload" || category.id === "libraries" ? OFFICIAL.upload : OFFICIAL.learn,
    },
  })));

export const BUILD_GUIDES: BuildGuide[] = [
  ["meet-your-uno", "Meet your Arduino Uno", "Find power, ground, digital, and analog pins without wiring anything yet.", "10 min", ["Arduino Uno", "USB data cable"], ["Connect the Uno by USB.", "Find the ON and L LEDs.", "Locate GND, 5V, digital 13, and analog A0.", "Upload the built-in Blink example."], OFFICIAL.start],
  ["breadboard-basics", "Understand a breadboard", "Learn which holes are secretly connected before building a circuit.", "12 min", ["Breadboard", "2 jumper wires"], ["Find the center channel.", "Trace one five-hole terminal strip.", "Find the power rails.", "Check whether each rail is split in the middle."], OFFICIAL.start],
  ["blink", "Blink the built-in LED", "Prove the board, cable, port, and upload process all work.", "10 min", ["Arduino Uno", "USB data cable"], ["Open the Blink example.", "Choose Arduino Uno and the correct port.", "Upload the sketch.", "Change both delay values and upload again."], OFFICIAL.examples],
  ["external-led", "Light an external LED", "Build the classic LED and resistor circuit safely.", "20 min", ["LED", "220 Ω resistor", "2 jumpers", "Breadboard"], ["Disconnect USB power.", "Place the LED across two different nodes.", "Add the resistor in series.", "Connect the circuit between D13 and GND, then upload Blink."], OFFICIAL.examples],
  ["button", "Read a pushbutton", "Use the Arduino's internal pull-up so the input never floats.", "20 min", ["Pushbutton", "2 jumpers", "Breadboard"], ["Place the button across the center channel.", "Connect one side to GND.", "Connect the other side to D2.", "Use pinMode(2, INPUT_PULLUP) and remember pressed means LOW."], OFFICIAL.examples],
  ["potentiometer", "Turn a knob into a number", "Read an analog voltage and watch it in Serial Monitor.", "20 min", ["10 kΩ potentiometer", "3 jumpers"], ["Connect the outer pins to 5V and GND.", "Connect the center pin to A0.", "Upload AnalogReadSerial.", "Turn the knob and watch values from about 0 to 1023."], OFFICIAL.examples],
  ["buzzer", "Make a buzzer beep", "Create tones and learn why timing matters.", "20 min", ["Piezo buzzer", "2 jumpers"], ["Connect the buzzer between a digital pin and GND.", "Check its polarity marking.", "Use tone() for a short note.", "Call noTone() when finished."], OFFICIAL.reference],
  ["servo", "Move a small servo", "Control angle while keeping motor power safe.", "30 min", ["Micro servo", "3 jumpers", "Suitable 5V supply"], ["Identify signal, 5V, and GND from the servo datasheet.", "Connect a shared ground.", "Use the Servo library Sweep example.", "Stop if the board resets or the servo chatters."], OFFICIAL.learn],
  ["ultrasonic", "Measure distance", "Trigger an ultrasonic sensor and time its echo.", "35 min", ["HC-SR04-style sensor", "4 jumpers"], ["Check the module voltage and pin order.", "Connect VCC and GND.", "Connect Trigger and Echo to the sketch's pins.", "Print raw timing before converting to distance."], OFFICIAL.learn],
  ["i2c-display", "Find an I²C display", "Use an address scanner before drawing text or graphics.", "35 min", ["I²C display", "4 jumpers"], ["Check the display voltage.", "Connect SDA, SCL, power, and GND.", "Run an I²C scanner.", "Put the discovered address into the display example."], OFFICIAL.learn],
  ["debug-routine", "Use the five-minute debug routine", "A repeatable process for almost any circuit that does not work.", "5 min", ["Your circuit", "Its diagram"], ["Remove power.", "Compare power and ground first.", "Trace one signal from pin to component to GND.", "Test the smallest official example.", "Add one section back at a time."], OFFICIAL.support],
].map(([id, title, description, time, parts, steps, resource]) => ({
  id: id as string, title: title as string, description: description as string,
  time: time as string, level: "Beginner", parts: parts as string[], steps: steps as string[], resource: resource as string,
}));

const uno = (ports = ["D2", "D7", "D9", "D13", "A0", "5V", "GND"]) => ({
  id: "arduino", kind: "arduino-uno" as const, label: "Arduino Uno", color: "#0d7d8c",
  aliases: ["Arduino", "Uno"], visibleFromStep: 1, placement: { side: "front" as const, order: 0 },
  ports: ports.map((label) => ({ id: label.toLowerCase(), label })),
});

function challengePlan(id: string, title: string, parts: Part[], summary: string, faulty = true): Plan {
  return {
    schemaVersion: 1, id: `challenge-${id}`, revision: 1, title, summary,
    workspace: { profileId: "breadboard-830", profileVersion: 1 },
    source: { kind: "challenge", challengeId: id },
    requirements: [], detected: [], devices: [uno()], parts,
    steps: [{ id: "inspect", n: 1, kind: "test", completion: "test", title: "Inspect the whole circuit", instruction: "Find the fault before applying power.", adds: parts.map((part) => part.id) }],
    warnings: faulty
      ? [{ severity: "warn", message: "This exercise shows an intentionally incorrect circuit. Do not power it until the fault is fixed.", blocksPower: true }]
      : [],
  };
}

const led = (pins: string[]): Part => ({ id: "led", kind: "led", label: "Red LED", pins, color: "#ff3b30", polarised: true });
const resistor = (pins: string[]): Part => ({ id: "resistor", kind: "resistor", label: "220 Ω resistor", pins, color: "#d9c08a", value: "220 ohm" });
const wire = (id: string, label: string, pins: string[], color = "#2f7fff"): Part => ({ id, kind: "wire", label, pins, color });
const button = (pins: string[]): Part => ({ id: "button", kind: "button", label: "Pushbutton", pins, color: "#333333" });

function options(correct: string, wrongA: string, wrongB: string) {
  return [
    { id: "a", label: wrongA, correct: false, feedback: "That can cause trouble, but it does not match what the 3D board shows." },
    { id: "b", label: correct, correct: true, feedback: "Correct. This fault matches the circuit shown." },
    { id: "c", label: wrongB, correct: false, feedback: "Look at the electrical path again and unlock a hint if you need one." },
  ];
}

function makeChallenge(spec: {
  id: string; title: string; kicker: string; prompt: string; category: HubCategoryId;
  faulty: Part[]; solution: Part[]; answer: string; wrong: [string, string];
  hints: [string, string, string]; focus: string; holes: string[]; safety?: string;
}): TroubleshootingChallenge {
  return {
    id: spec.id, title: spec.title, kicker: spec.kicker, prompt: spec.prompt,
    difficulty: spec.category === "start" || spec.category === "leds" ? "Starter" : "Builder",
    faultyPlan: challengePlan(spec.id, spec.title, spec.faulty, spec.prompt),
    solutionPlan: challengePlan(spec.id, `${spec.title} — corrected`, spec.solution, `Corrected version: ${spec.answer}`, false),
    options: options(spec.answer, spec.wrong[0], spec.wrong[1]),
    hints: [
      { title: "Think about the rule", text: spec.hints[0], partIds: [], holes: [] },
      { title: "Look in this area", text: spec.hints[1], partIds: [spec.focus], holes: [] },
      { title: "Check this exact connection", text: spec.hints[2], partIds: [spec.focus], holes: spec.holes },
    ],
    safety: spec.safety, relatedCategory: spec.category,
  };
}

const basicCorrect = [led(["E20", "E22"]), resistor(["E22", "E26"]), wire("signal", "D13 signal", ["A20", "EXT:Arduino D13"]), wire("ground", "Ground return", ["A26", "EXT:Arduino GND"], "#222222")];

export const CHALLENGES: TroubleshootingChallenge[] = [
  makeChallenge({ id: "backwards-led", title: "Reversed LED", kicker: "Polarity detective", prompt: "The sketch uploads, but the LED stays dark. What is wrong?", category: "leds", faulty: [led(["E22", "E20"]), ...basicCorrect.slice(1)], solution: basicCorrect, answer: "The LED is backwards", wrong: ["The resistor is too close to the LED", "The blue jumper is too long"], focus: "led", holes: ["E20", "E22"], hints: ["An LED lets current travel in only one direction.", "Compare the LED's two legs with the signal and resistor sides.", "The anode belongs at E20 and the cathode at E22." ] }),
  makeChallenge({ id: "missing-resistor", title: "Missing series resistor", kicker: "Protect the LED", prompt: "This LED path has no current control. Find the missing safety part.", category: "leds", faulty: [led(["E20", "E22"]), wire("signal", "D13 signal", ["A20", "EXT:Arduino D13"]), wire("ground", "Direct ground", ["A22", "EXT:Arduino GND"], "#222222")], solution: basicCorrect, answer: "A current-limiting resistor is missing", wrong: ["The breadboard needs a second Arduino", "The LED needs two ground wires"], focus: "ground", holes: ["E22", "E26"], safety: "Do not power an LED directly from an Arduino output. Add a suitable series resistor first.", hints: ["LEDs need something that limits current.", "Follow the path from the LED's cathode toward GND.", "Replace the direct E22-to-GND connection with a 220 Ω resistor from E22 to E26 and ground E26." ] }),
  makeChallenge({ id: "one-column-off", title: "Resistor one column off", kicker: "Follow the node", prompt: "Everything looks close, but the circuit is open by one column.", category: "breadboard", faulty: [led(["E20", "E22"]), resistor(["E23", "E26"]), ...basicCorrect.slice(2)], solution: basicCorrect, answer: "The resistor starts one column away from the LED", wrong: ["The LED color is incompatible", "The resistor must cross the center channel"], focus: "resistor", holes: ["E22", "E26"], hints: ["Close is not connected on a breadboard.", "Check where the resistor meets the LED's short-leg node.", "Move the resistor end from E23 to E22." ] }),
  makeChallenge({ id: "missing-common-ground", title: "No common ground", kicker: "Share a reference", prompt: "The signal wire is present, but the module cannot understand it.", category: "motion", faulty: [wire("signal", "Servo signal", ["A20", "EXT:Arduino D9"], "#f2a23a"), wire("power", "Servo power", ["A24", "EXT:Arduino 5V"], "#e24b43")], solution: [wire("signal", "Servo signal", ["A20", "EXT:Arduino D9"], "#f2a23a"), wire("power", "Servo power", ["A24", "EXT:Arduino 5V"], "#e24b43"), wire("ground", "Common ground", ["A26", "EXT:Arduino GND"], "#222222")], answer: "The circuit is missing a common ground", wrong: ["The signal wire must be red", "The Arduino needs two USB cables"], focus: "power", holes: ["A26"], hints: ["A voltage signal needs a shared zero-volt reference.", "The signal and power paths are present; inspect the return path.", "Add a ground connection from the module ground node at A26 to Arduino GND." ] }),
  makeChallenge({ id: "split-power-rail", title: "The invisible rail break", kicker: "Breadboard map", prompt: "Power reaches the left half of the rail, but not the right half.", category: "breadboard", faulty: [wire("feed", "5V rail feed", ["T+8", "EXT:Arduino 5V"], "#e24b43"), wire("load", "Load power", ["T+48", "A48"], "#e24b43")], solution: [wire("feed", "5V rail feed", ["T+8", "EXT:Arduino 5V"], "#e24b43"), wire("bridge", "Rail bridge", ["T+30", "T+34"], "#e24b43"), wire("load", "Load power", ["T+48", "A48"], "#e24b43")], answer: "The split power rail needs a bridge", wrong: ["Power rails only work with blue wire", "The Arduino must sit on the breadboard"], focus: "load", holes: ["T+30", "T+34"], hints: ["Some long breadboard rails stop connecting at the middle.", "The source and load are on opposite halves of the top positive rail.", "Add a jumper between T+30 and T+34." ] }),
  makeChallenge({ id: "button-same-side", title: "The button that is always pressed", kicker: "Hidden connections", prompt: "The input never changes because both wires use internally joined legs.", category: "inputs", faulty: [button(["E20", "E22"]), wire("input", "Button input", ["A20", "EXT:Arduino D2"]), wire("ground", "Button ground", ["A22", "EXT:Arduino GND"], "#222222")], solution: [button(["E20", "F20"]), wire("input", "Button input", ["A20", "EXT:Arduino D2"]), wire("ground", "Button ground", ["J20", "EXT:Arduino GND"], "#222222")], answer: "Both wires are on the same internally connected side", wrong: ["Buttons only work on analog pins", "The button needs a motor driver"], focus: "button", holes: ["E20", "F20"], hints: ["The pairs of legs on a four-leg tactile button are already joined.", "Look at whether the button crosses the breadboard's center channel.", "Place the used button contacts at E20 and F20, then ground the F–J side." ] }),
  makeChallenge({ id: "servo-wires-swapped", title: "Servo wiring fault", kicker: "Three wires, three jobs", prompt: "The servo twitches and the board may reset. Signal and power are mixed up.", category: "motion", faulty: [wire("signal", "Servo signal", ["A20", "EXT:Arduino 5V"], "#f2a23a"), wire("power", "Servo power", ["A24", "EXT:Arduino D9"], "#e24b43"), wire("ground", "Servo ground", ["A26", "EXT:Arduino GND"], "#222222")], solution: [wire("signal", "Servo signal", ["A20", "EXT:Arduino D9"], "#f2a23a"), wire("power", "Servo power", ["A24", "EXT:Arduino 5V"], "#e24b43"), wire("ground", "Servo ground", ["A26", "EXT:Arduino GND"], "#222222")], answer: "The servo signal and power connections are swapped", wrong: ["The ground wire should be removed", "The signal belongs on an analog input"], focus: "signal", holes: ["A20", "A24"], safety: "Disconnect power before correcting servo wires. Confirm the colors against the servo documentation because colors can vary.", hints: ["A servo has separate power, ground, and control jobs.", "Compare the 5V and D9 destinations of the orange and red paths.", "Connect the signal path to D9 and the power path to 5V." ] }),
  makeChallenge({ id: "wrong-sensor-pin", title: "The sensor stuck at zero", kicker: "Code meets wiring", prompt: "The sketch reads A0, but the sensor signal goes somewhere else.", category: "sensors", faulty: [wire("signal", "Sensor output", ["A20", "EXT:Arduino D7"], "#57c7d4"), wire("power", "Sensor power", ["A24", "EXT:Arduino 5V"], "#e24b43"), wire("ground", "Sensor ground", ["A26", "EXT:Arduino GND"], "#222222")], solution: [wire("signal", "Sensor output", ["A20", "EXT:Arduino A0"], "#57c7d4"), wire("power", "Sensor power", ["A24", "EXT:Arduino 5V"], "#e24b43"), wire("ground", "Sensor ground", ["A26", "EXT:Arduino GND"], "#222222")], answer: "The sensor signal is on D7 instead of A0", wrong: ["Analog sensors do not need ground", "The USB cable changes analog pins"], focus: "signal", holes: ["A20"], hints: ["The sketch and wire must name the same input.", "Trace the blue sensor signal to its Arduino socket.", "Move the signal destination from D7 to A0." ] }),
];

export function challengeById(id: string | null | undefined) {
  return CHALLENGES.find((challenge) => challenge.id === id);
}

export function problemById(id: string | null | undefined) {
  return HUB_PROBLEMS.find((problem) => problem.id === id);
}

export function categoryById(id: string | null | undefined) {
  return HUB_CATEGORIES.find((category) => category.id === id);
}
