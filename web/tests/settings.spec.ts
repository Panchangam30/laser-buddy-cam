import { expect, test } from "playwright/test";

test.use({ hasTouch: true });

test("persists appearance and functional preferences, then restores defaults", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Settings", exact: true }).press("Enter");
  const settings = page.getByRole("dialog", { name: "Workbench settings" });
  await settings.getByRole("button", { name: "Light", exact: true }).click();
  await settings.getByLabel("Orbit sensitivity", { exact: true }).selectOption("slow");
  await settings.getByLabel("3D rendering", { exact: true }).selectOption("low");
  await settings.getByRole("switch", { name: "Reduce motion" }).check();
  await settings.getByRole("switch", { name: "Drag to place" }).check();
  await settings.getByRole("switch", { name: "Step narration" }).check();
  await settings.getByRole("switch", { name: "Board labels" }).uncheck();
  await settings.getByRole("switch", { name: "Swipe to orbit" }).uncheck();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "true");
  await page.getByRole("button", { name: "Settings", exact: true }).press("Enter");
  await expect(settings.getByLabel("Orbit sensitivity", { exact: true })).toHaveValue("slow");
  await expect(settings.getByLabel("3D rendering", { exact: true })).toHaveValue("low");
  await expect(settings.getByRole("switch", { name: "Drag to place" })).toBeChecked();
  await expect(settings.getByRole("switch", { name: "Step narration" })).toBeChecked();
  await expect(settings.getByRole("switch", { name: "Board labels" })).not.toBeChecked();
  await expect(settings.getByRole("switch", { name: "Swipe to orbit" })).not.toBeChecked();
  await settings.getByRole("button", { name: "Reset settings" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(settings.getByLabel("Orbit sensitivity", { exact: true })).toHaveValue("normal");
  await expect(settings.getByLabel("3D rendering", { exact: true })).toHaveValue("standard");
  await expect(settings.getByRole("switch", { name: "Drag to place" })).not.toBeChecked();
  await expect(settings.getByRole("switch", { name: "Swipe to orbit" })).toBeChecked();
  await settings.getByText("WORKBENCH", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/settings-dark.png" });
});

test("mobile library scrolls, adds by tap, and provides separate shop links", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Components/ }).press("Enter");
  const first = page.getByRole("button", { name: "Add Arduino Uno R3", exact: true });
  await expect(first).toHaveAttribute("draggable", "false");
  await expect(page.locator(".component-grid")).toHaveCSS("touch-action", "pan-y");
  await expect(page.getByRole("link", { name: "Shop for Arduino Uno R3", exact: true })).toHaveAttribute("href", "https://www.adafruit.com/search?q=Arduino%20Uno%20R3");
  await first.tap();
  await expect(page.locator(".component-count")).toHaveText("1");
  const grid = page.locator(".component-grid");
  await grid.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/components-mobile-dark.png" });
});

test("ignores malformed preferences and works when storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("laser-buddy:preferences:v1", '{"theme":"unknown","labels":"false"}');
    Storage.prototype.setItem = () => { throw new DOMException("Blocked", "SecurityError"); };
  });
  await page.goto("/docs");
  await page.getByRole("button", { name: "Settings", exact: true }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Browser storage unavailable");
  await expect(page.getByRole("switch", { name: "Board labels" })).toBeChecked();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});


test("applies board preferences and keeps mobile settings usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/hub/challenges/backwards-led");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Workbench settings" });
  await settings.getByLabel("3D rendering", { exact: true }).selectOption("low");
  await settings.getByLabel("Orbit sensitivity", { exact: true }).selectOption("fast");
  await expect(page.getByTestId("assembly-scene")).toHaveAttribute("data-render-quality", "low");
  await expect(page.getByTestId("assembly-scene")).toHaveAttribute("data-orbit-sensitivity", "fast");
  await settings.getByRole("switch", { name: "Reduce motion" }).check();
  await expect(settings.getByRole("button", { name: "Reset settings" })).toBeInViewport();
  const bounds = await settings.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: "test-results/settings-mobile.png" });
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByTestId("assembly-scene")).toHaveAttribute("data-render-quality", "low");
  await expect(page.getByTestId("assembly-scene")).toHaveAttribute("data-orbit-sensitivity", "fast");
});
