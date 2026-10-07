import { expect, test } from "playwright/test";

test("exports and imports code, parts, and progress as a new local project", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { exportProject, importProject, projectShareLink, projectFromLink } = await import("/src/lib/sharing.ts");
    const { createProject, normalizePlan } = await import("/src/lib/plans.ts");
    const { MOCK_PLAN } = await import("/src/lib/mockPlan.ts");
    const project = createProject(normalizePlan(MOCK_PLAN), "A learner's LED — 🌟");
    project.progress.currentStep = 3;
    project.progress.currentStepId = "step-3";
    project.progress.manuallyCompletedStepIds = ["step-1"];
    project.plan.artifacts = [{ id: "sketch", kind: "code", title: "Blink", content: "void setup() {}", language: "cpp" }];
    const imported = importProject(exportProject(project));
    const link = await projectShareLink(project);
    const linked = await projectFromLink(new URL(link).hash);
    let rejected = false;
    try { importProject('{"format":"laser-buddy-project","version":2}'); } catch { rejected = true; }
    return { project, imported, linked, link, rejected };
  });
  expect(result.imported.id).not.toBe(result.project.id);
  expect(result.imported.plan.artifacts).toEqual(result.project.plan.artifacts);
  expect(result.imported.plan.requirements).toEqual(result.project.plan.requirements);
  expect(result.imported.progress).toEqual(result.project.progress);
  expect(result.linked?.name).toBe(result.project.name);
  expect(result.linked?.progress).toEqual(result.project.progress);
  expect(result.rejected).toBe(true);
  await page.goto(result.link);
  await expect(page.getByRole("heading", { name: "LED blink circuit" })).toBeVisible();
  await expect(page.locator(".progress")).toHaveText("3 / 4");
  await expect(page).not.toHaveURL(/#project=/);
});

test("rejects invalid imports without replacing the active project", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByLabel("Import project JSON").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from("not json") });
  await expect(page.getByRole("alert")).toHaveText("This file is not valid JSON.");
  await expect(page.getByRole("heading", { name: "LED blink circuit" })).toBeVisible();
});
