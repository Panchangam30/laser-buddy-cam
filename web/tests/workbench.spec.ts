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
    await expect(tooltip).toHaveCSS("opacity", "0");
    await page.waitForTimeout(500);
    await expect(tooltip).toHaveCSS("opacity", "1");
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
