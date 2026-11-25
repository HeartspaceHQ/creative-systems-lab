import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { SHOTS_DIR } from "../playwright.config";

/**
 * The whole studio in one real flow against `csl serve`: a designer makes a project and a brand,
 * writes the brief, generates with the built-in drawing model (free, no key), approves an image,
 * puts it in the design, and downloads the finished file. No paid call is possible here.
 */
test("brief to download in one workspace", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  await page.getByLabel("Project name").fill("Winter tea");
  await page.getByLabel("Brand", { exact: true }).selectOption({ label: "Create a new brand…" });
  await page.getByLabel("New brand name").fill("Aster Lane");
  await page.getByRole("button", { name: "Create project" }).click();

  // Brief and brand: autosaved, nothing to submit.
  await expect(page.getByRole("heading", { name: "Brief" })).toBeVisible();
  await page.getByLabel("What should the image show?").fill("A glass cup of tea in low morning light");
  await page.getByRole("radio", { name: /Illustration/ }).check();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, "10-brief.png"), fullPage: true });

  // A half-typed colour is explained at the field and never saved.
  const hex = page.getByLabel("Accent", { exact: true });
  await hex.fill("#12");
  await expect(page.getByText("Use a colour like #1d2a3a.")).toBeVisible();
  await hex.fill("#b5542c");

  // Fonts: a bundled serif for headlines, a font of the designer's own for body text.
  await page.getByLabel("Headlines", { exact: true }).selectOption("Newsreader");
  await page.getByText("Upload your own font").click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Choose a font file" }).click()]);
  await chooser.setFiles(path.resolve("../poc/composition/fonts/Inter-latin-var.woff2"));
  await expect(page.getByLabel("Name in the font list")).toHaveValue("Inter");
  await page.getByRole("button", { name: "Upload font" }).click();
  await expect(page.getByText("Confirm that you may use this font in what you make.")).toBeVisible();
  await page.getByLabel("Name in the font list").fill("House Sans");
  await page.getByRole("checkbox", { name: /licence to use this font/ }).check();
  await page.getByRole("button", { name: "Upload font" }).click();
  await expect(page.getByText("House Sans is in the font list now.")).toBeVisible();
  await page.getByRole("button", { name: "Use for body text" }).click();
  await expect(page.getByLabel("Body text", { exact: true })).toHaveValue("House Sans");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, "10b-fonts.png"), fullPage: true });

  // Images: generate with the free model, review in place, approve.
  await page.getByRole("link", { name: /^Images/ }).click();
  await expect(page.getByText(/Free: everything runs on this computer/)).toBeVisible();
  // Where a pasted key lives, and how to keep it in the terminal instead.
  await expect(page.getByText(/kept only by the studio program running on this computer/)).toBeVisible();
  await page.getByText("Keep the key in your terminal instead").click();
  await page.getByLabel("Commands for").selectOption({ label: "Google Gemini" });
  await expect(page.getByText("csl serve --ask-key GEMINI_API_KEY")).toBeVisible();
  // The Keychain prompt keeps 128 characters and cuts longer keys, so the key comes from the clipboard.
  await expect(page.getByText('security add-generic-password -U -a "$USER" -s GEMINI_API_KEY -w "$(pbpaste)"')).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, "10c-keys.png"), fullPage: true });
  await page.getByRole("button", { name: /^Generate \d+ images?$/ }).click();
  await page.getByRole("button", { name: "Review them" }).click({ timeout: 90_000 });
  await page.getByLabel("Your name").fill("Test Designer");
  const anyway = page.getByRole("checkbox", { name: /Approve anyway/ });
  if (await anyway.isVisible()) {
    await anyway.check();
    await page.getByLabel("Comment (optional)").fill("Built-in drawing, accepted for the test.");
  }
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.screenshot({ path: path.join(SHOTS_DIR, "11-images-approved.png"), fullPage: true });

  // Use in design: the preview shows the engine's own layout.
  await page.getByRole("button", { name: "Use in design" }).click();
  await expect(page.getByRole("heading", { name: "Brief" })).toBeHidden();
  await expect(page.getByTitle("Live preview of your design")).toBeVisible();
  await page.getByRole("textbox", { name: "Headline" }).fill("Slow mornings,\nwarm hands");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, "12-design.png"), fullPage: true });

  // Going back loses nothing.
  await page.getByRole("link", { name: /^Brief/ }).click();
  await expect(page.getByLabel("What should the image show?")).toHaveValue("A glass cup of tea in low morning light");
  await page.getByRole("link", { name: /^Design/ }).click();
  await expect(page.getByRole("textbox", { name: "Headline" })).toHaveValue("Slow mornings,\nwarm hands");

  // Deliver: the default size, no extras, then a real download.
  await page.getByRole("link", { name: /^Deliver/ }).click();
  await page.getByRole("button", { name: "Create files" }).click();
  const download = page.getByRole("link", { name: "Download", exact: true }).first();
  await expect(download).toBeVisible({ timeout: 120_000 });
  await page.screenshot({ path: path.join(SHOTS_DIR, "13-deliver.png"), fullPage: true });
  const [saved] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(saved.suggestedFilename()).toBe("linkedin-portrait.png");
  // The file itself: a real PNG at the LinkedIn portrait size, with a picture in it rather than a blank.
  const bytes = await readFile(await saved.path());
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.toString("latin1", 12, 16)).toBe("IHDR");
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1080, 1350]);
  expect(bytes.length).toBeGreaterThan(20_000);
});

/** Opens the project the first test made, which has an approved image and a design. */
async function openWinterTea(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: /Winter tea/ }).first().click();
  await expect(page.getByRole("link", { name: /^Deliver/ })).toBeVisible();
}

/** A design the server refused to save must never be delivered as the older version it still holds. */
test("a change the server refused stops the files from being made", async ({ page }) => {
  await openWinterTea(page);
  await page.getByRole("link", { name: /^Design/ }).click();
  let started = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/deliveries")) started += 1;
  });
  await page.route("**/api/projects/*/design", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "The disk is full." }) });
  });
  await page.getByRole("textbox", { name: "Headline" }).fill("Words the server never got");
  await expect(page.getByRole("status").filter({ hasText: "Could not save" })).toBeVisible();

  await page.getByRole("link", { name: /^Deliver/ }).click();
  await page.getByRole("button", { name: "Create files" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The disk is full." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create files" })).toBeEnabled();
  expect(started).toBe(0);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  /** Every area fits the width of the screen: nothing is cut off or needs scrolling sideways. */
  test("each area fits the screen", async ({ page }) => {
    await openWinterTea(page);
    for (const area of ["Brief", "Images", "Design", "Deliver"]) {
      await page.getByRole("link", { name: new RegExp(`^${area}`) }).click();
      await expect(page.getByRole("link", { name: new RegExp(`^${area}`) })).toHaveAttribute("aria-current", "page");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${area} is wider than the screen`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: path.join(SHOTS_DIR, `20-phone-${area.toLowerCase()}.png`), fullPage: true });
    }
    await expect(page.getByRole("button", { name: "Create files" })).toBeVisible();
  });
});

/** Rejecting the last image to review leads straight back to generating, with the reason said. */
test("rejecting every image returns to generating", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/");
  // Another test may have made a project already; then the form opens from its button.
  const newProject = page.getByRole("button", { name: "New project" });
  await expect(page.getByLabel("Project name").or(newProject)).toBeVisible();
  if (await newProject.isVisible()) await newProject.click();
  await page.getByLabel("Project name").fill("Rejected tea");
  await page.getByLabel("Brand", { exact: true }).selectOption({ label: "Create a new brand…" });
  await page.getByLabel("New brand name").fill("Reject Lane");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByLabel("What should the image show?").fill("A glass cup of tea");
  await page.getByRole("radio", { name: /Illustration/ }).check();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  await page.getByRole("link", { name: /^Images/ }).click();
  await page.getByRole("button", { name: /^Generate \d+ images?$/ }).click();
  await page.getByRole("button", { name: "Review them" }).click({ timeout: 90_000 });
  await page.getByLabel("Your name").fill("Test Designer");

  const toReview = Number((await page.getByRole("heading", { name: /^To review/ }).innerText()).replace(/\D/g, ""));
  for (let rejected = 1; rejected <= toReview; rejected += 1) {
    await page.getByLabel("Comment (optional)").fill("Not the right mood.");
    await page.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`^Rejected\\s*${String(rejected)}$`) })).toBeVisible();
  }
  await expect(page.getByRole("status").filter({ hasText: "None of the images were approved." })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Generate \d+ images?$/ })).toBeVisible();
});
