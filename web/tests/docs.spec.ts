import { expect, test } from "playwright/test";

test.describe("documentation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/docs");
  });

  test("renders the beginner documentation layout", async ({ page }) => {
    await expect(page).toHaveTitle("Documentation · Laser Buddy Cam");
    await expect(page.getByRole("heading", { name: "Laser Buddy Cam", level: 1 })).toBeVisible();
    await expect(page.locator(".docs-sidebar nav a")).toHaveCount(14);
    await expect(page.locator("#installation")).toContainText("npm run dev");
    await expect(page.locator("#workspace")).toContainText("Connect jumper wires");
  });

  test("includes credits, privacy, terms, and live project links", async ({ page }) => {
    await expect(page.locator("#privacy")).toBeAttached();
    await expect(page.locator("#terms")).toBeAttached();
    await expect(page.locator(".site-footer-meta")).toContainText("Sriman Panchangam");
    await expect(page.locator(".site-footer-meta")).toContainText("Shivang Patel");
    await expect(page.locator(".site-footer-meta")).toContainText("Advait Chandrakar");
    await expect(page.locator(".site-footer-meta")).toContainText("Abhinav Ramireddy");
    await expect(page.locator('a[href="https://laserbuddy.vercel.app/"]')).toHaveCount(3);
  });

  test("keeps the live project action in the lower-left docs rail", async ({ page }) => {
    const liveLink = page.locator(".docs-sidebar-live");
    await expect(liveLink).toBeVisible();
    await expect(liveLink).toHaveCSS("position", "fixed");
    await expect(liveLink).toHaveAttribute("href", "https://laserbuddy.vercel.app/");
  });
});
