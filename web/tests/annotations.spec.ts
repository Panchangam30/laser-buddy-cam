import { expect, test, type Page } from "playwright/test";
import { annotationKey, nearestAnnotationTarget, parseAnnotations, removePlanNote, type PlanAnnotations } from "../src/lib/annotations";

async function openPlan(page: Page, challenge = "backwards-led") {
  await page.addInitScript(() => localStorage.setItem("laser-buddy:track-mode:v1", "board"));
  await page.goto(`/?challenge=${challenge}`);
  await expect(page.getByRole("toolbar", { name: "Plan annotations" })).toBeVisible();
}
async function placeNote(page: Page, text: string, x = .08, y = .28) {
  await page.getByRole("button", { name: "Add sticky note", exact: true }).click();
  const capture = page.getByTestId("annotation-capture");
  const box = (await capture.boundingBox())!;
  await capture.click({ position: { x: box.width * x, y: box.height * y } });
  await page.getByRole("textbox", { name: /Note \d+ text/ }).last().fill(text);
}

test("validates local annotation data and deletes note-linked arrows together", () => {
  const doc: PlanAnnotations = { version: 1, visible: false, notes: [{ id: "n1", text: "Check polarity", color: "yellow", x: .2, y: .3, step: 2 }], arrows: [{ id: "a1", start: { x: .2, y: .3, noteId: "n1" }, end: { x: .6, y: .4, targetId: "part:led", label: "LED" } }] };
  expect(parseAnnotations(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  expect(removePlanNote(doc, "n1")).toMatchObject({ notes: [], arrows: [] });
  expect(parseAnnotations({ ...doc, notes: [{ ...doc.notes[0], x: Infinity }] }).notes).toEqual([]);
  expect(parseAnnotations({ ...doc, notes: [{ ...doc.notes[0], x: 5, y: -5 }] }).notes[0]).toMatchObject({ x: 1, y: 0 });
  expect(parseAnnotations({ ...doc, notes: [] }).arrows).toEqual([]);
  expect(nearestAnnotationTarget({ x: .5, y: .5 }, [{ id: "led", label: "LED", x: .51, y: .5 }], { width: 900, height: 700 })?.id).toBe("led");
  expect(nearestAnnotationTarget({ x: .1, y: .1 }, [{ id: "led", label: "LED", x: .51, y: .5 }], { width: 900, height: 700 })).toBeNull();
  expect(annotationKey("my-project")).toBe("laser-buddy:annotations:v1:my-project");
});

test("creates local notes, persists visibility, and restores notes after reload", async ({ page }) => {
  const leaked: string[] = [];
  page.on("request", (request) => { if (request.postData()?.includes("My private circuit thought")) leaked.push(request.url()); });
  await openPlan(page);
  await placeNote(page, "My private circuit thought");
  await expect(page.getByTestId("plan-sticky")).toHaveCount(1);
  await page.getByRole("button", { name: "Hide notes", exact: true }).click();
  await expect(page.getByTestId("plan-sticky")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show notes", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Show notes", exact: true }).click();
  await expect(page.getByLabel("Note 1 text")).toHaveValue("My private circuit thought");
  await page.getByRole("button", { name: "My board", exact: true }).click();
  await expect(page.getByRole("toolbar", { name: "Plan annotations" })).toHaveCount(0);
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.getByLabel("Note 1 text")).toHaveValue("My private circuit thought");
  expect(leaked).toEqual([]);
});

test("drags and colors notes, draws a connected arrow, and undoes double-click deletion", async ({ page }) => {
  await openPlan(page);
  await placeNote(page, "Check this wire");
  const note = page.getByTestId("plan-sticky");
  const before = (await note.boundingBox())!;
  const header = (await note.locator(".plan-sticky-header").boundingBox())!;
  await page.mouse.move(header.x + 36, header.y + 12);
  await page.mouse.down();
  await page.mouse.move(header.x + 95, header.y + 50, { steps: 5 });
  await page.mouse.up();
  const after = (await note.boundingBox())!;
  expect(after.x).toBeGreaterThan(before.x + 30);
  await page.getByRole("button", { name: "Change note 1 color" }).click();
  await expect(note).toHaveClass(/blue/);
  await page.getByRole("button", { name: "Connect note 1 with an arrow" }).click();
  const capture = page.getByTestId("annotation-capture");
  const box = (await capture.boundingBox())!;
  await capture.click({ position: { x: box.width * .74, y: box.height * .42 } });
  await expect(page.getByTestId("annotation-arrow")).toHaveCount(1);
  await page.screenshot({ path: "/tmp/laser-buddy-plan-notes.png" });
  await note.locator(".plan-sticky-header").dblclick({ position: { x: 40, y: 12 } });
  await expect(note).toHaveCount(0);
  await expect(page.getByTestId("annotation-arrow")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo annotation change" }).click();
  await expect(page.getByLabel("Note 1 text")).toHaveValue("Check this wire");
  await expect(page.getByTestId("annotation-arrow")).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel("Note 1 text")).toHaveValue("Check this wire");
  await expect(page.getByTestId("annotation-arrow")).toHaveCount(1);
});

test("snaps an arrow to a rendered part and keeps it attached while rotating", async ({ page }) => {
  test.setTimeout(60000);
  await openPlan(page);
  await page.getByRole("button", { name: "Draw arrow", exact: true }).click();
  const target = page.locator('[data-testid="annotation-target"][data-target-id="part:led"]');
  await expect(target).toBeVisible({ timeout: 20000 });
  const at = (await target.boundingBox())!;
  const surface = (await page.getByTestId("annotation-capture").boundingBox())!;
  await page.mouse.move(surface.x + surface.width * .15, surface.y + surface.height * .35);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2, { steps: 6 });
  await page.mouse.up();
  const arrow = page.getByTestId("annotation-arrow");
  await expect(arrow).toHaveAttribute("data-target-id", "part:led");
  const line = arrow.locator(".arrow-line");
  const initial = (await line.getAttribute("d"))!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  await page.mouse.move(surface.x + surface.width * .76, surface.y + surface.height * .62);
  await page.mouse.down();
  await page.mouse.move(surface.x + surface.width * .88, surface.y + surface.height * .66, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => {
    const current = (await line.getAttribute("d"))?.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
    return current ? Math.hypot(current[2] - initial[2], current[3] - initial[3]) : 0;
  }).toBeGreaterThan(8);
  await page.screenshot({ path: "/tmp/laser-buddy-anchored-arrow.png" });
  await page.reload();
  await expect(page.getByTestId("annotation-arrow")).toHaveAttribute("data-target-id", "part:led");
});

test("keeps annotations separate for each project and cancels drawing with Escape", async ({ page }) => {
  await openPlan(page);
  await placeNote(page, "Only on this project");
  await page.goto("/?challenge=missing-resistor");
  await expect(page.getByTestId("plan-sticky")).toHaveCount(0);
  await page.getByRole("button", { name: "Draw arrow", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("annotation-capture")).toHaveCount(0);
  await page.goto("/?challenge=backwards-led");
  await expect(page.getByLabel("Note 1 text")).toHaveValue("Only on this project");
});

test("handles unavailable storage and leaves notes editable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key.startsWith("laser-buddy:annotations:")) throw new Error("storage blocked"); original.call(this, key, value); };
  });
  await openPlan(page);
  await placeNote(page, "Still editable");
  await expect(page.getByRole("status")).toContainText("session only");
  await expect(page.getByLabel("Note 1 text")).toHaveValue("Still editable");
});

test("keeps the visibility control usable on a phone and notes within the stage", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlan(page);
  await placeNote(page, "Remember the ground", .55, .46);
  const note = (await page.getByTestId("plan-sticky").boundingBox())!;
  const stage = (await page.getByTestId("plan-annotations").boundingBox())!;
  expect(note.x + note.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
  expect(note.y + note.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
  await page.screenshot({ path: "/tmp/laser-buddy-notes-mobile.png" });
  await page.getByRole("button", { name: "Hide notes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show notes", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
