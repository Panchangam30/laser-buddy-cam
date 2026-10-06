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

  test("documents camera recovery and circuit safety guidance", async ({ page }) => {
    await expect(page.locator("#troubleshooting")).toContainText("Allow camera access");
    await expect(page.locator("#troubleshooting")).toContainText("Column 1 orientation button");
    await expect(page.locator("#limits")).toContainText("Always disconnect power before changing wiring");
    await expect(page.locator("#laser")).toContainText("Never look into the beam");
  });

  test("keeps the live project action in the lower-left docs rail", async ({ page }) => {
    const liveLink = page.locator(".docs-sidebar-live");
    await expect(liveLink).toBeVisible();
    await expect(liveLink).toHaveCSS("position", "fixed");
    await expect(liveLink).toHaveAttribute("href", "https://laserbuddy.vercel.app/");
  });

  test("navigates to a documentation section from the sidebar", async ({ page }) => {
    await page.getByRole("navigation", { name: "Documentation" })
      .getByRole("link", { name: "Live board tracking" }).click();

    await expect(page).toHaveURL(/#tracking$/);
    await expect(page.locator("#tracking").getByRole("heading", { name: "Check the real breadboard" }))
      .toBeVisible();
  });

  test("explains the local services and keeping API keys on the server", async ({ page }) => {
    const installation = page.locator("#installation");
    await expect(installation.locator("tbody tr")).toHaveCount(3);
    await expect(installation).toContainText(":5173");
    await expect(installation).toContainText(":8787");
    await expect(installation).toContainText(":8788");
    await expect(installation).toContainText("Never place API keys in web/src");
  });

  test("presents the first-circuit workflow in five steps", async ({ page }) => {
    const steps = page.locator("#first-circuit .docs-steps > li");
    await expect(steps).toHaveCount(5);
    await expect(steps.nth(0)).toContainText("Arrange the parts");
    await expect(steps.nth(1)).toContainText("Allow camera access");
    await expect(steps.nth(2)).toContainText("Scan the bench");
    await expect(steps.nth(4)).toContainText("Check before power");
  });

  test("lists the documented configuration variables and required key", async ({ page }) => {
    const configuration = page.locator("#configuration");
    await expect(configuration.locator("tbody tr")).toHaveCount(7);
    await expect(configuration).toContainText("OPENAI_API_KEY");
    await expect(configuration.locator("tbody tr").first()).toContainText("Yes");
    await expect(configuration).toContainText("VOICE_PROVIDER");
    await expect(configuration).toContainText("VISION_PORT");
  });

  test("expands the vision-service troubleshooting instructions", async ({ page }) => {
    const details = page.locator("#troubleshooting details")
      .filter({ has: page.getByText("Vision service is not running", { exact: true }) });
    await details.locator("summary").click();
    await expect(details).toHaveAttribute("open", "");
    await expect(details).toContainText("python -m vision.service");
  });
});
