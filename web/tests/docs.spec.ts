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

test("finds topics and highlights the current section", async ({ page }) => {
  await page.goto("/docs");
  const nav = page.getByRole("navigation", { name: "Documentation", exact: true });
  await page.getByRole("searchbox", { name: "Find a documentation topic" }).fill("laser");
  await expect(nav.getByRole("link")).toHaveCount(1);
  await nav.getByRole("link", { name: "Laser pointer" }).click();
  await expect(page).toHaveURL(/#laser$/);
  await expect(nav.getByRole("link", { name: "Laser pointer" })).toHaveAttribute("aria-current", "location");
  await expect(nav.getByRole("link")).toHaveCount(14);
});

test("copies installation commands", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/docs#installation");
  await page.locator("#installation").getByRole("button", { name: "Copy terminal code" }).click();
  await expect(page.locator("#installation").getByRole("button")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("npm run dev");
});

for (const theme of ["dark", "light"] as const) {
  test(`${theme} documentation has readable text and contained content`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem("laser-buddy:preferences:v1", JSON.stringify({ theme: value })), theme);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/docs");
    const contrast = await page.locator(".docs-lead").evaluate((paragraph) => {
      const rgb = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      const text = rgb(getComputedStyle(paragraph).color);
      const background = rgb(getComputedStyle(document.querySelector(".docs-site")!).backgroundColor);
      return (Math.max(text, background) + .05) / (Math.min(text, background) + .05);
    });
    expect(contrast).toBeGreaterThan(4.5);
    await expect(page.locator(".docs-toc")).toBeVisible();
    await page.screenshot({ path: `test-results/docs-${theme}.png` });
    await page.goto("/docs#installation");
    await page.locator("#installation").evaluate((element) => element.scrollIntoView({ behavior: "instant" }));
    await expect(page.locator("#installation .docs-code")).toBeVisible();
    await page.screenshot({ path: `test-results/docs-installation-${theme}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("mobile menu opens, navigates and closes without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs");
  await page.screenshot({ path: "test-results/docs-mobile.png" });
  const menu = page.getByRole("button", { name: "Documentation", exact: true });
  await expect(page.locator(".docs-sidebar")).toBeHidden();
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("navigation", { name: "Documentation", exact: true }).getByRole("link", { name: "Configuration", exact: true }).click();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(page).toHaveURL(/#configuration$/);
  await expect(page.locator(".docs-sidebar")).toBeHidden();
  await expect(page.locator("#configuration h2")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#configuration").evaluate((element) => element.scrollIntoView({ behavior: "instant" }));
  await page.screenshot({ path: "test-results/docs-mobile-configuration.png" });
});
