import { expect, test } from "playwright/test";
import { reviewSketch, SKETCH_STARTERS, tokenizeSketch } from "../src/lib/sketch";

test("explains starters and resolves the Uno's built-in LED pin", () => {
  const blink = reviewSketch(SKETCH_STARTERS[0].code);
  expect(blink.purpose).toContain("blinking output on D13");
  expect(blink.pins).toEqual(["D13"]);
  expect(blink.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(blink.actions.some((action) => action.text.includes("Pauses execution for 1000"))).toBe(true);
  expect(reviewSketch(SKETCH_STARTERS[1].code).purpose).toContain("interactive control");
  expect(reviewSketch(SKETCH_STARTERS[2].code).purpose).toContain("sensor-monitoring");
});

test("checks source rather than comments or strings and reports useful errors", () => {
  const valid = `// digitalWrite(4, HIGH) { setup()
void setup() { Serial.begin(9600); }
void loop() { Serial.println("unmatched { [ digitalWrite(2, HIGH)"); }
`;
  expect(reviewSketch(valid).issues).toEqual([]);
  const broken = reviewSketch(`void setup() {\n  pinMode(13, OUTPUT)\n}\nvoid loop() {\n digitalWrite(13, HIGH);`);
  expect(broken.issues.some((issue) => issue.title === "Possible missing semicolon" && issue.line === 2)).toBe(true);
  expect(broken.issues.some((issue) => issue.title === "Unclosed “{”" && issue.line === 4)).toBe(true);
  expect(reviewSketch("// void setup() {}\nvoid loop() {}").issues.some((issue) => issue.title === "Missing setup() function")).toBe(true);
  expect(reviewSketch('void setup() {}\nvoid loop() { Serial.println("hello); }').issues.some((issue) => issue.title === "Unclosed quoted text")).toBe(true);
  expect(reviewSketch("/* open comment").issues.some((issue) => issue.title === "Unclosed comment")).toBe(true);
  expect(tokenizeSketch(valid).map((token) => token.text).join("")).toBe(valid);
});

test("flags Uno PWM limits, output configuration, and serial initialization", () => {
  const result = reviewSketch("void setup() {}\nvoid loop() { analogWrite(13, 300); Serial.println(42); }");
  expect(result.issues.map((issue) => issue.title)).toEqual(expect.arrayContaining([
    "PWM value outside 0–255", "D13 is not a PWM pin on Uno", "Check output mode for D13", "Serial Monitor needs initialization",
  ]));
});

test("edits, reviews, jumps to an issue, and marks edited results as stale", async ({ page }) => {
  await page.goto("/");
  await page.screenshot({ path: "/tmp/laser-buddy-tools-sidebar.png" });
  await page.getByRole("button", { name: /Sketch Studio/ }).click();
  const dialog = page.getByRole("dialog", { name: "Sketch Studio" });
  const code = dialog.getByRole("textbox", { name: "Arduino sketch code" });
  await expect(code).toContainText("LED_BUILTIN");
  await dialog.getByRole("button", { name: "Check & explain" }).click();
  await expect(dialog.getByText(/suggest a blinking output/)).toBeVisible();
  await page.screenshot({ path: "/tmp/laser-buddy-sketch-desktop.png" });
  await code.fill("void setup() {\n pinMode(13, OUTPUT)\n}\nvoid loop() {}\n");
  await expect(dialog.getByText("Your code has changed.")).toBeVisible();
  await code.press("Control+Enter");
  await expect(dialog.getByRole("tab", { name: /Problems/ })).toHaveAttribute("aria-selected", "true");
  await dialog.getByRole("button", { name: /Possible missing semicolon/ }).click();
  await expect(code).toBeFocused();
  expect(await code.evaluate((element: HTMLTextAreaElement) => element.value.slice(0, element.selectionStart).split("\n").length)).toBe(2);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Sketch Studio/ })).toBeFocused();
});

test("keeps drafts across reloads and isolates projects", async ({ page }) => {
  await page.goto("/?challenge=backwards-led");
  await page.getByRole("button", { name: /Sketch Studio/ }).click();
  await page.getByLabel("Arduino sketch code").fill("// my own sketch\nvoid setup() {}\nvoid loop() {}\n");
  await page.reload();
  await page.getByRole("button", { name: /Sketch Studio/ }).click();
  await expect(page.getByLabel("Arduino sketch code")).toHaveValue(/my own sketch/);
  await page.goto("/?challenge=missing-resistor");
  await page.getByRole("button", { name: /Sketch Studio/ }).click();
  await expect(page.getByLabel("Arduino sketch code")).not.toHaveValue(/my own sketch/);
});

test("loads starter sketches with confirmation and downloads an ino file", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Sketch Studio/ }).click();
  const code = page.getByLabel("Arduino sketch code");
  await page.getByLabel("Starter sketch").selectOption("sensor");
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(code).toHaveValue(SKETCH_STARTERS[0].code);
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await page.getByRole("button", { name: "Replace draft" }).click();
  await expect(code).toHaveValue(SKETCH_STARTERS[2].code);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .ino" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("sketch.ino");
});

test("loads a project's supplied sketch and keeps the original artifact unchanged", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { createProject } = await import("/src/lib/plans.ts");
    const { MOCK_PLAN } = await import("/src/lib/mockPlan.ts");
    const { saveProject } = await import("/src/lib/projects.ts");
    await saveProject(createProject({ ...MOCK_PLAN, artifacts: [{ id: "sketch", kind: "code", title: "Test sketch", content: "// supplied by project\nvoid setup() {}\nvoid loop() {}\n" }] }, "With sketch"));
  });
  await page.reload();
  await page.getByRole("button", { name: /Sketch Studio/ }).click();
  await expect(page.getByLabel("Arduino sketch code")).toHaveValue(/supplied by project/);
  await page.getByLabel("Arduino sketch code").fill("// edited draft");
  const artifact = await page.evaluate(async () => {
    const { loadLastProject } = await import("/src/lib/projects.ts");
    return (await loadLastProject())?.plan.artifacts?.[0].content;
  });
  expect(artifact).toContain("supplied by project");
});

test("keeps the editor and review usable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Sketch Studio/ }).click();
  const dialog = page.getByRole("dialog", { name: "Sketch Studio" });
  await page.getByRole("button", { name: "Check & explain" }).click();
  await expect(page.getByLabel("Arduino sketch code")).toBeVisible();
  await dialog.getByRole("tab", { name: "What it does" }).scrollIntoViewIfNeeded();
  await expect(dialog.getByText(/suggest a blinking output/)).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/laser-buddy-sketch-mobile.png" });
});
