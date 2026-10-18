import { expect, test } from "playwright/test";
import { ledResistor } from "../src/lib/bench";

test("chooses the next E12 resistor without exceeding target current", () => {
  expect(ledResistor(5, 2, 10)?.resistance).toBe(330);
  expect(ledResistor(5, 2, 10)?.actualMa).toBeLessThan(10);
  expect(ledResistor(5, 2, 1)?.resistance).toBe(3300);
  expect(ledResistor(3.3, 3.3, 10)).toBeNull();
  expect(ledResistor(5, 2, 0)).toBeNull();
  expect(ledResistor(NaN, 2, 10)).toBeNull();
});

test("decodes colors, calculates an LED resistor, and handles invalid input", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Bench companion/ }).click();
  const dialog = page.getByRole("dialog", { name: "Bench companion" });
  await expect(dialog.locator(".resistor-reading")).toHaveText("220 Ω ±5%");
  await dialog.getByLabel("1st digit").selectOption("4");
  await dialog.getByLabel("2nd digit").selectOption("7");
  await dialog.getByLabel("Multiplier").selectOption("2");
  await expect(dialog.locator(".resistor-reading")).toHaveText("4.7 kΩ ±5%");
  await page.screenshot({ path: "/tmp/laser-buddy-bench-desktop.png" });
  await dialog.getByRole("tab", { name: "LED calculator" }).click();
  await expect(dialog.locator(".led-result")).toContainText("330 Ω");
  await dialog.getByLabel("Supply voltage (V)").fill("2");
  await expect(dialog.getByRole("status")).toContainText("Enter positive values");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Bench companion/ })).toBeFocused();
});

test("persists checks and isolates them between projects", async ({ page }) => {
  await page.goto("/?challenge=backwards-led");
  await page.getByRole("button", { name: /Bench companion/ }).click();
  await page.getByRole("tab", { name: "Power checklist" }).click();
  await page.getByRole("checkbox", { name: /Power is disconnected/ }).check();
  await page.reload();
  await page.getByRole("button", { name: /Bench companion/ }).click();
  await page.getByRole("tab", { name: "Power checklist" }).click();
  await expect(page.getByRole("checkbox", { name: /Power is disconnected/ })).toBeChecked();
  await page.goto("/?challenge=missing-resistor");
  await page.getByRole("button", { name: /Bench companion/ }).click();
  await page.getByRole("tab", { name: "Power checklist" }).click();
  await expect(page.getByRole("checkbox", { name: /Power is disconnected/ })).not.toBeChecked();
  await page.getByRole("checkbox", { name: /Power is disconnected/ }).check();
  await page.getByRole("button", { name: "Reset checks" }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "0");
});

test("fits a phone screen and supports keyboard tab selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Bench companion/ }).click();
  const dialog = page.getByRole("dialog", { name: "Bench companion" });
  const tab = page.getByRole("tab", { name: "Resistor decoder" });
  await tab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "LED calculator" })).toHaveAttribute("aria-selected", "true");
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/laser-buddy-bench-mobile.png" });
});
