import { expect as baseExpect, test } from "playwright/test";
import { TUTORIALS, buildTutorial } from "../src/lib/tutorials";
import { validatePlanShape } from "../server/validatePlan";
import { planForGoal } from "../server/goalPlans";

const expect = baseExpect.configure({ timeout: 30_000 });

test("all 50 authored tutorials have valid plans and distinct sketches", () => {
  expect(TUTORIALS).toHaveLength(50);
  expect(new Set(TUTORIALS.map((item) => item.id)).size).toBe(50);
  expect(new Set(TUTORIALS.map((item) => item.title)).size).toBe(50);
  for (const category of ["Servos", "LEDs", "Buttons", "Analog", "Sound"]) {
    expect(TUTORIALS.filter((item) => item.category === category)).toHaveLength(10);
  }
  const sketches = new Set<string>();
  for (const tutorial of TUTORIALS) {
    const plan = buildTutorial(tutorial.id);
    expect(validatePlanShape(plan), tutorial.id).toBeNull();
    expect(plan.steps.map((step) => step.n)).toEqual(plan.steps.map((_, i) => i + 1));
    expect(plan.steps.at(-1)?.instruction).toBe(tutorial.test);
    for (const step of plan.steps) for (const id of step.artifactIds ?? []) {
      expect(plan.artifacts?.some((artifact) => artifact.id === id)).toBe(true);
    }
    sketches.add(plan.artifacts!.find((artifact) => artifact.kind === "code")!.content);
  }
  expect(sketches.size).toBe(50);
  expect(planForGoal("make a servo sweep on a button press")?.ok).toBe(true);
  expect(() => buildTutorial("unknown")).toThrow("Unknown tutorial");
});

test("all tutorials normalize and resolve every 3D external wire endpoint", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { TUTORIALS, buildTutorial } = await import("/src/lib/tutorials.ts");
    const { normalizePlan } = await import("/src/lib/plans.ts");
    const { externalAnchorMap } = await import("/src/three/ExternalDevices.tsx");
    return TUTORIALS.map((item) => {
      const plan = normalizePlan(buildTutorial(item.id));
      const anchors = externalAnchorMap(plan.devices ?? []);
      return { id: item.id, problem: plan.problem, parts: plan.parts.length,
        missing: plan.parts.flatMap((part) => part.pins.filter((pin) => pin.startsWith("EXT:") && !anchors.has(pin.toUpperCase()))),
        warnings: plan.warnings?.filter((warning) => warning.blocksPower) };
    });
  });
  for (const result of results) {
    expect(result.problem, result.id).toBeFalsy();
    expect(result.parts, result.id).toBeGreaterThan(0);
    expect(result.missing, result.id).toEqual([]);
    expect(result.warnings, result.id).toEqual([]);
  }
});

test("searches, filters, loads, and persists a tutorial without a goal API", async ({ page }) => {
  test.setTimeout(180_000); // Several scene reloads run on software WebGL in CI.
  page.on("pageerror", (error) => console.error("Page error:", error.message));
  let goalRequests = 0;
  await page.route("**/api/plan/goal", (route) => { goalRequests++; return route.abort(); });
  await page.goto("/");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  const catalog = page.locator(".tutorial-catalog");
  await expect(catalog.locator(".tutorial-card")).toHaveCount(50);
  await page.screenshot({ path: "/tmp/arduino-tutorial-catalog.png" });
  await page.getByRole("button", { name: "Analog", exact: true }).click();
  await expect(catalog.locator(".tutorial-card")).toHaveCount(10);
  await page.getByLabel("Find a tutorial").fill("potentiometer");
  await expect(catalog.locator(".tutorial-card")).toHaveCount(1);
  await page.getByLabel("Find a tutorial").fill("does not exist");
  await expect(catalog.getByText("No matches yet.", { exact: false })).toBeVisible();
  await page.getByLabel("Find a tutorial").fill("");
  await page.getByRole("button", { name: "Servos", exact: true }).click();
  await page.getByRole("button", { name: "Load Button-controlled servo sweep", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Projects" })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Button-controlled servo sweep", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Button-controlled servo sweep", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByLabel("Start from a named goal").fill("Knob LED dimmer");
  await page.getByRole("button", { name: "Build plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Knob LED dimmer", exact: true })).toBeVisible();
  expect(goalRequests).toBe(0);
});
