import { expect, test } from "playwright/test";

test.describe("Arduino learning hub", () => {
  test("adds an accessible Hub control beside Docs", async ({ page }) => {
    await page.goto("/");
    const hub = page.getByRole("link", { name: "Arduino Learning Hub" });
    await expect(hub).toHaveAttribute("href", "/hub");
    await expect(hub).toBeVisible();
    await expect(page.getByRole("link", { name: "Docs" })).toBeVisible();
  });

  test("renders the complete searchable help catalog", async ({ page }) => {
    await page.goto("/hub");
    await expect(page).toHaveTitle("Arduino Learning Hub · Laser Buddy");
    await expect(page.getByRole("heading", { name: /Find the fault/ })).toBeVisible();
    await expect(page.locator(".hub-challenge-card")).toHaveCount(8);
    await expect(page.locator(".hub-problem-card")).toHaveCount(216);

    const links = await page.locator(".hub-problem-card").evaluateAll((items) =>
      items.map((item) => item.getAttribute("href")));
    expect(new Set(links).size).toBe(216);

    await page.getByLabel("Search Arduino help").fill("servo reset");
    await expect(page.locator(".hub-problem-card")).toHaveCount(3);
    await expect(page.getByRole("link", { name: /Servo makes Arduino reset/ }).first()).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page.locator(".hub-problem-card")).toHaveCount(216);
  });

  test("filters categories and opens a beginner-friendly fix", async ({ page }) => {
    await page.goto("/hub");
    await page.getByRole("button", { name: /^LEDs & resistors/ }).click();
    await expect(page.locator(".hub-problem-card")).toHaveCount(18);
    await page.getByRole("link", { name: /LED never turns on/ }).click();
    await expect(page).toHaveURL(/\/hub\/problems\/leds-led-never-turns-on$/);
    await expect(page.getByRole("heading", { name: "Try these checks in order" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Official Arduino learning guide/ }))
      .toHaveAttribute("href", "https://docs.arduino.cc/learn/");
  });

  test("unlocks progressive hints and solves a 3D challenge", async ({ page }) => {
    await page.goto("/hub/challenges/backwards-led");
    await expect(page.getByTestId("assembly-scene")).toBeVisible();
    await expect(page.getByText("FAULTY CIRCUIT — DO NOT POWER")).toBeVisible();

    await page.getByRole("button", { name: "Unlock hint 1" }).click();
    await expect(page.getByText("An LED lets current travel in only one direction.")).toBeVisible();
    await page.getByRole("button", { name: "Unlock hint 2" }).click();
    await page.getByRole("button", { name: "Unlock hint 3" }).click();
    await expect(page.getByText("Check E20 and E22")).toBeVisible();

    await page.getByRole("button", { name: /The LED is backwards/ }).click();
    await expect(page.getByText("Case solved")).toBeVisible();
    await expect(page.getByText("CORRECTED CIRCUIT", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Try on my board" }))
      .toHaveAttribute("href", "/?challenge=backwards-led");
  });

  test("hands a challenge to the physical workbench without duplicate ids", async ({ page }) => {
    await page.goto("/?challenge=backwards-led");
    const panel = page.getByLabel("Troubleshooting challenge");
    await expect(panel).toContainText("Reversed LED");
    await expect(panel.getByRole("button", { name: "Unlock hint 2" })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Troubleshooting challenge")).toContainText("Reversed LED");
  });

  test("keeps the learning library usable on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/hub");
    await expect(page.getByLabel("Search Arduino help")).toBeVisible();
    await expect(page.locator(".hub-challenge-card").first()).toBeVisible();
    await expect(page.locator(".hub-problem-card").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
