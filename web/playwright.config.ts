import { defineConfig } from "@playwright/test";
import path from "node:path";

const PORT = 8799;
export const RUNS_DIR = path.resolve("test-results/e2e-runs");
export const STUDIO_DIR = path.resolve("test-results/e2e-studio");
export const SHOTS_DIR = path.resolve("test-results/screenshots");

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${String(PORT)}`, viewport: { width: 1280, height: 900 } },
  webServer: {
    command: [
      "csl serve",
      `--runs-dir ${RUNS_DIR}`,
      `--studio ${STUDIO_DIR}`,
      "--brief ../examples/aster-lane/brief.json",
      "--brand ../examples/aster-lane/brand.json",
      "--references ../examples/aster-lane/references",
      `--validation ${path.resolve("test-results/no-validation")}`,
      "--static dist",
      `--port ${String(PORT)}`,
    ].join(" "),
    url: `http://127.0.0.1:${String(PORT)}/api/runs`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
