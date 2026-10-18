import { expect, test } from "playwright/test";
import express from "express";
import { once } from "node:events";
import { createSketchReviewRouter } from "../server/sketchReview";
import { CODE_LIBRARY } from "../src/lib/codeLibrary";
import { parseSketchFeedback, type SketchFeedback } from "../src/lib/sketchFeedback";

const feedback: SketchFeedback = {
  summary: "This sketch toggles an LED output and waits between changes.",
  explanation: [{ line: 5, text: "This configures the LED pin as an output." }, { line: null, text: "The loop repeats after setup." }],
  issues: [{ line: 10, severity: "info", title: "Consider responsive timing", explanation: "The delay blocks input handling.", suggestion: "Use millis() if you need to read buttons during the blink." }],
  nextSteps: ["Compile the sketch for Arduino Uno."],
  suggestedCode: "// suggested revision\nvoid setup() {}\nvoid loop() {}\n",
};

async function withApi(apiKey: string, fetchImpl: typeof fetch, check: (url: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use("/api/sketch", createSketchReviewRouter({ apiKey, model: "configured-test-model", fetchImpl }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  try { await check(`http://127.0.0.1:${address.port}/api/sketch/review`); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const source = Array.from({ length: 15 }, () => "// source").join("\n");

test("the library has 53 complete, distinct sketches with offline explanations", () => {
  expect(CODE_LIBRARY).toHaveLength(53);
  expect(new Set(CODE_LIBRARY.map((item) => item.id)).size).toBe(53);
  expect(new Set(CODE_LIBRARY.map((item) => item.code)).size).toBe(53);
  for (const example of CODE_LIBRARY) {
    expect(example.code).toContain("void setup()");
    expect(example.code).toContain("void loop()");
    expect(example.explanation.length).toBeGreaterThan(2);
    expect(example.expected.length).toBeGreaterThan(10);
    expect(example.parts.length).toBeGreaterThan(0);
  }
  expect(parseSketchFeedback(feedback, 15)).toEqual(feedback);
  expect(parseSketchFeedback({ ...feedback, explanation: [{ line: 999, text: "bad line" }] }, 15)).toBeNull();
});

test("the API calls Groq with a server-side key, requests structured output, and validates the response", async () => {
  let seenBody: Record<string, unknown> = {};
  const provider: typeof fetch = async (url, init) => {
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-only-key");
    seenBody = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(feedback) } }] });
  };
  await withApi("test-only-key", provider, async (url) => {
    const response = await post(url, { code: source, question: "How can I keep the button responsive?", projectTitle: "LED build" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ feedback, model: "configured-test-model" });
    expect(JSON.stringify(body)).not.toContain("test-only-key");
    expect(seenBody.model).toBe("configured-test-model");
    expect(seenBody.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
    expect(JSON.stringify(seenBody.messages)).toContain("keep the button responsive");
  });
});

test("the API handles missing keys and invalid input without contacting the provider", async () => {
  let calls = 0;
  await withApi("", async () => { calls++; throw new Error("unexpected provider request"); }, async (url) => {
    expect((await post(url, { code: "" })).status).toBe(400);
    expect((await post(url, { code: "x".repeat(40001) })).status).toBe(400);
    expect((await post(url, { code: source, question: 45 })).status).toBe(400);
    const missing = await post(url, { code: source });
    expect(missing.status).toBe(503);
    expect((await missing.json()).error).toContain("GROQ_API_KEY");
  });
  expect(calls).toBe(0);
});

test("the API rejects malformed, refused, and truncated feedback and sanitizes provider errors", async () => {
  for (const scenario of [
    { upstream: 401, body: { secret: "must not leak" }, expected: 502 },
    { upstream: 429, body: { secret: "must not leak" }, expected: 429 },
    { upstream: 200, body: { choices: [{ finish_reason: "stop", message: { content: "bad json" } }] }, expected: 502 },
    { upstream: 200, body: { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ summary: "incomplete" }) } }] }, expected: 502 },
    { upstream: 200, body: { choices: [{ finish_reason: "length", message: { content: "{}" } }] }, expected: 502 },
    { upstream: 200, body: { choices: [{ finish_reason: "stop", message: { refusal: "Cannot review" } }] }, expected: 422 },
  ]) {
    await withApi("test-only-key", async () => Response.json(scenario.body, { status: scenario.upstream }), async (url) => {
      const response = await post(url, { code: source });
      expect(response.status).toBe(scenario.expected);
      const body = await response.json();
      expect(typeof body.error).toBe("string");
      expect(JSON.stringify(body)).not.toContain("must not leak");
    });
  }
});

test("searches the library, explains offline, and confirms before using code", async ({ page }) => {
  await page.route("**/api/sketch/review", () => { throw new Error("Library should not request LLM feedback"); });
  await page.goto("/");
  await page.getByRole("button", { name: "Sketch Studio" }).click();
  await page.getByRole("button", { name: "Library 53" }).click();
  await expect(page.locator(".code-library-item")).toHaveCount(53);
  await page.getByLabel("Code library category").selectOption("Servos");
  await expect(page.locator(".code-library-item")).toHaveCount(10);
  await page.getByLabel("Search code library").fill("toggle");
  await expect(page.locator(".code-library-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Explain Button-toggle gate", exact: true }).click();
  const explanation = page.getByLabel("Starter explanation");
  await expect(explanation.getByRole("heading", { name: "How it works" })).toBeVisible();
  await expect(explanation).toContainText("Servo library sends control pulses on D9");
  await page.screenshot({ path: "/tmp/laser-buddy-code-library.png" });
  await page.getByRole("button", { name: "Use this sketch" }).click();
  await page.getByRole("button", { name: "Replace draft" }).click();
  await expect(page.getByLabel("Arduino sketch code")).toHaveValue(/servo.write\(open \? 120 : 20\)/);
});

test("requests LLM feedback with the current sketch and question and requires confirmation for suggestions", async ({ page }) => {
  await page.route("**/api/sketch/review", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.code).toContain("LED_BUILTIN");
    expect(body.question).toBe("How do I make this respond to a button?");
    expect(body).not.toHaveProperty("apiKey");
    await route.fulfill({ json: { feedback, model: "configured-test-model" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Sketch Studio" }).click();
  await page.getByRole("tab", { name: "LLM feedback", exact: true }).click();
  await page.getByLabel("Goal or question (optional)").fill("How do I make this respond to a button?");
  await page.getByRole("button", { name: "Review with LLM" }).click();
  await expect(page.getByText(feedback.summary, { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/laser-buddy-llm-feedback.png" });
  await page.getByLabel("Goal or question (optional)").fill("A different goal");
  await expect(page.getByText(feedback.summary, { exact: true })).toHaveCount(0);
  await page.getByLabel("Goal or question (optional)").fill("How do I make this respond to a button?");
  await page.getByRole("tab", { name: "What it does" }).click();
  await page.getByRole("tab", { name: "LLM feedback", exact: true }).click();
  await expect(page.getByText(feedback.summary, { exact: true })).toBeVisible();
  await page.getByText("Suggested revision", { exact: true }).click();
  await page.getByRole("button", { name: "Use suggestion" }).click();
  await expect(page.getByLabel("Arduino sketch code")).toHaveValue(/LED_BUILTIN/);
  await page.getByRole("button", { name: "Replace draft" }).click();
  await expect(page.getByLabel("Arduino sketch code")).toHaveValue(feedback.suggestedCode!);
  await expect(page.getByText(feedback.summary, { exact: true })).toHaveCount(0);
  await expect(page.getByText("The code or question changed.", { exact: false })).toBeVisible();
});

test("shows recoverable missing-key errors and keeps the draft", async ({ page }) => {
  await page.route("**/api/sketch/review", (route) => route.fulfill({ status: 503, json: { error: "Add GROQ_API_KEY and restart the API server." } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Sketch Studio" }).click();
  await page.getByRole("tab", { name: "LLM feedback", exact: true }).click();
  await page.getByRole("button", { name: "Review with LLM" }).click();
  await expect(page.getByRole("alert")).toContainText("GROQ_API_KEY");
  await expect(page.getByLabel("Arduino sketch code")).toHaveValue(/LED_BUILTIN/);
  await expect(page.getByRole("button", { name: "Review with LLM" })).toBeEnabled();
});

test("cancels a pending review and does not display a late response", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/sketch/review", async (route) => { await gate; await route.fulfill({ json: { feedback, model: "configured-test-model" } }).catch(() => {}); });
  await page.goto("/");
  await page.getByRole("button", { name: "Sketch Studio" }).click();
  await page.getByRole("tab", { name: "LLM feedback", exact: true }).click();
  const requested = page.waitForRequest("**/api/sketch/review");
  await page.getByRole("button", { name: "Review with LLM" }).click();
  await requested;
  await page.getByRole("button", { name: "Cancel review" }).click();
  release();
  await expect(page.getByRole("button", { name: "Review with LLM" })).toBeEnabled();
  await expect(page.getByText(feedback.summary, { exact: true })).toHaveCount(0);
});

test("fits the library and LLM controls on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Sketch Studio" }).click();
  await page.getByRole("button", { name: "Library 53" }).click();
  await page.getByLabel("Search code library").fill("Blink an LED");
  await page.getByRole("button", { name: "Explain Blink an LED", exact: true }).click();
  await page.getByLabel("Starter explanation").scrollIntoViewIfNeeded();
  const dialog = page.getByRole("dialog", { name: "Sketch Studio" });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/laser-buddy-library-mobile.png" });
  await page.getByRole("button", { name: "Back to editor" }).click();
  await page.getByRole("tab", { name: "LLM feedback", exact: true }).click();
  await expect(page.getByLabel("Goal or question (optional)")).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
