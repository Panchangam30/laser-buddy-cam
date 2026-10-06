import { expect, test } from "playwright/test";

test.describe("3D planning workbench", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Plan", exact: true }).click();
  });

  test("uses the two requested view modes", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Plan", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "My board", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Compare", exact: true })).toHaveCount(0);
  });

  test("renders the Arduino beside the breadboard and connects its wire", async ({ page }) => {
    const scene = page.getByTestId("assembly-scene");
    await expect(scene).toHaveAttribute("data-device-ids", /arduino/);

    await page.getByRole("button", { name: /Next/ }).click();
    await page.getByRole("button", { name: /Next/ }).click();
    await expect(scene).toHaveAttribute("data-part-ids", /w1/);
  });

  test("starts fresh board tracking before recalibration", async ({ page }) => {
    await page.route("**/api/vision/laser", async (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        connected: true, port: "/dev/test", portAvailable: "/dev/test",
        pan: 90, tilt: 90, laserOn: false, error: "", aimedAt: "",
        calibration: {
          ready: true, running: false, progress: "", error: "", done: 32, total: 32,
          samples: 28, rmsMm: 0.1, checked: 8, at: Date.now(),
          quality: "Lands in the right hole",
        },
      }),
    }));
    await page.reload();

    await page.getByRole("button", { name: "Recalibrate" }).click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Finding board…" })).toBeDisabled();
    await expect(page.getByText("Board tracking is starting automatically")).toBeVisible();
  });

  test("opens the starter kit and places components", async ({ page }) => {
    await page.getByRole("button", { name: /Components/ }).click();
    await expect(page.locator(".component-card")).toHaveCount(32);

    await page.locator(".component-card").filter({ hasText: "Arduino Uno R3" }).click();
    await page.locator(".component-card").filter({ hasText: "Jumper Wire" }).click();

    await expect(page.locator(".component-count")).toHaveText("2");
    await expect(page.locator(".part-actions")).toContainText("Part selected");
  });

  test("starts, configures, stops, and restarts simulation without losing the plan", async ({ page }) => {
    const play = page.getByRole("button", { name: "Play simulation" });
    await expect(play).toBeDisabled();
    await page.getByRole("button", { name: /Components/ }).click();
    await page.locator(".component-card").filter({ hasText: "Red LED" }).click();
    await play.click();
    await expect(page.getByRole("button", { name: "Stop simulation" })).toBeVisible();
    await expect(page.getByLabel("Simulation settings")).toHaveCount(0);
    await page.getByRole("button", { name: "Show simulation details" }).click();
    await expect(page.getByLabel("Simulation settings")).toContainText("Electrical accuracy is unavailable");
    await expect(page.getByLabel("Simulation settings")).toContainText("Red LED");
    await expect(page.getByLabel("Simulation settings").getByRole("checkbox")).toBeChecked();
    await page.getByLabel("Simulation settings").getByRole("checkbox").uncheck();
    await expect(page.getByLabel("Simulation settings")).toContainText("0 active");
    await page.getByLabel("Simulation settings").getByRole("checkbox").check();
    await page.getByLabel("Simulation speed").fill("1.5");
    await page.getByRole("button", { name: "Pause power" }).click();
    await page.getByRole("button", { name: "Stop simulation" }).click();
    await expect(page.getByRole("button", { name: "Show simulation details" })).toHaveCount(0);
    await expect(page.locator(".component-count")).toHaveText("1");
    await page.getByRole("button", { name: "Play simulation" }).click();
    await page.getByRole("button", { name: "Show simulation details" }).click();
    await expect(page.getByRole("button", { name: "Resume power" })).toBeVisible();
  });

  test("shows component help without a long hover delay", async ({ page }) => {
    await page.getByRole("button", { name: /Components/ }).click();
    const card = page.locator(".component-card").first();
    const tooltip = card.locator(".component-tooltip");

    await card.hover();
    await expect(tooltip).toHaveCSS("opacity", "1", { timeout: 1_000 });
    await expect(tooltip).toHaveCSS("visibility", "visible");
  });

  test("creates and restores a named-goal project", async ({ page }) => {
    await page.route("**/api/plan/goal", async (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        title: "Verified goal project",
        summary: "A deterministic test plan.",
        detected: [],
        requirements: [
          { id: "arduino", label: "Arduino Uno", count: 1, availability: "unknown" },
          { id: "servo", label: "Micro servo", count: 1, availability: "unknown" },
        ],
        devices: [
          { id: "arduino", kind: "arduino-uno", label: "Arduino Uno", visibleFromStep: 1,
            aliases: ["Arduino"], placement: { side: "front", order: 0 },
            ports: [{ id: "d9", label: "D9" }] },
          { id: "servo", kind: "micro-servo", label: "Micro servo", visibleFromStep: 4,
            aliases: ["Servo"], placement: { side: "right", order: 0 },
            ports: [{ id: "signal", label: "signal" }] },
        ],
        parts: [
          { id: "r1", kind: "resistor", label: "220 ohm resistor", pins: ["E20", "E22"] },
          { id: "servo-signal", kind: "wire", label: "Servo signal",
            pins: ["EXT:Arduino D9", "EXT:Servo signal"] },
        ],
        steps: [
          { id: "place-r1", n: 1, title: "Place resistor", instruction: "Place it.", adds: ["r1"] },
          { id: "prep", n: 2, title: "Prepare", instruction: "Prepare it.", adds: [] },
          { id: "check", n: 3, title: "Check", instruction: "Check it.", adds: [] },
          { id: "servo", n: 4, title: "Connect servo", instruction: "Connect it.", adds: [],
            renders: ["servo-signal"] },
        ],
        warnings: [],
        source: { kind: "goal", goal: "test goal", generatedAt: new Date().toISOString() },
      }),
    }));

    await page.getByRole("button", { name: "Projects" }).click();
    await page.getByLabel("Start from a named goal").fill("test goal");
    await page.getByRole("button", { name: "Build plan" }).click();
    await expect(page.getByRole("heading", { name: "Verified goal project" })).toBeVisible();
    const scene = page.getByTestId("assembly-scene");
    await expect(scene).toHaveAttribute("data-device-ids", /^arduino$/);

    await page.getByRole("button", { name: "4 Connect servo" }).click();
    await expect(scene).toHaveAttribute("data-device-ids", /arduino servo/);
    await expect(scene).toHaveAttribute("data-part-ids", /servo-signal/);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Verified goal project" })).toBeVisible();
  });

  test("can collapse and reopen the circuit guide", async ({ page }) => {
    await page.getByRole("button", { name: "Close circuit guide" }).click();
    await expect(page.locator(".app")).toHaveClass(/sidebar-collapsed/);
    await page.getByRole("button", { name: "Open circuit guide" }).click();
    await expect(page.locator(".app")).not.toHaveClass(/sidebar-collapsed/);
  });

  test("links to documentation and the public project", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    await expect(page.getByRole("link", { name: /View Laser Buddy live/ }))
      .toHaveAttribute("href", "https://laserbuddy.vercel.app/");
  });
});
