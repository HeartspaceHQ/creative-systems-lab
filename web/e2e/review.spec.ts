import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { RUNS_DIR, SHOTS_DIR } from "../playwright.config";

function verify(run: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync("csl", ["verify", run], { encoding: "utf8", stdio: "pipe" });
    return { ok: true, output };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

test("start a run, approve in the UI, verify passes, tampering is caught", async ({ page }) => {
  await page.goto("/#/runs");
  await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, "01-runs-empty.png") });

  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page.getByRole("link", { name: /^open / })).toBeVisible({ timeout: 90_000 });
  await page.screenshot({ path: path.join(SHOTS_DIR, "02-runs-started.png") });

  await page.getByRole("link", { name: /^open / }).click();
  await expect(page.getByRole("heading", { name: "Record intact" })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, "03-run-detail.png"), fullPage: true });

  await page.getByLabel("Reviewer").fill("Test Designer");
  await page.getByRole("textbox", { name: "Comment" }).fill("Procedural stand-in, accepted for the e2e run.");
  await page.getByRole("checkbox", { name: /Approve anyway/ }).check();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText(/Approved by Test Designer \(override\)/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Record intact" })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, "04-after-approval.png"), fullPage: true });

  const [runId] = readdirSync(RUNS_DIR);
  expect(runId).toBeDefined();
  const runDir = path.join(RUNS_DIR, runId ?? "");
  const decisions = path.join(runDir, "decisions.jsonl");
  expect(readFileSync(decisions, "utf8").trim().split("\n")).toHaveLength(1);
  const clean = verify(runDir);
  expect(clean.ok, clean.output).toBe(true);

  const row = JSON.parse(readFileSync(decisions, "utf8").trim()) as Record<string, unknown>;
  row["reviewer"] = "Someone Else";
  writeFileSync(decisions, `${JSON.stringify(row)}\n`);
  const tampered = verify(runDir);
  expect(tampered.ok).toBe(false);
  expect(tampered.output).toMatch(/decision|chain|seal/i);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Record altered" })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, "05-tampered.png"), fullPage: true });
  appendFileSync(path.join(SHOTS_DIR, "result.txt"), `verify after tamper: ${tampered.output}\n`);
});

test("keyboard: candidates are a radio group reachable by arrow keys", async ({ page }) => {
  await page.goto("/#/runs");
  await page.getByRole("link", { name: /tea leaf/ }).first().click();
  const radios = page.getByRole("radio");
  await radios.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(radios.nth(1)).toBeFocused();
});
