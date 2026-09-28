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
    await expect(page.locator(".component-card")).toHaveCount(29);

    await page.locator(".component-card").filter({ hasText: "Arduino Uno R3" }).click();
    await page.locator(".component-card").filter({ hasText: "Jumper Wire" }).click();

    await expect(page.locator(".component-count")).toHaveText("2");
    await expect(page.locator(".part-actions")).toContainText("Part selected");
  });

  test("waits three seconds before showing component help", async ({ page }) => {
    await page.getByRole("button", { name: /Components/ }).click();
    const card = page.locator(".component-card").first();
    const tooltip = card.locator(".component-tooltip");

    await card.hover();
    await expect(tooltip).toHaveCSS("opacity", "0");
    await page.waitForTimeout(3_150);
    await expect(tooltip).toHaveCSS("opacity", "1");
  });

  test("links to documentation and the public project", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    await expect(page.getByRole("link", { name: /View Laser Buddy live/ }))
      .toHaveAttribute("href", "https://laserbuddy.vercel.app/");
  });
});
