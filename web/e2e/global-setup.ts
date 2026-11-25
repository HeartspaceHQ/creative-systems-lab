import { mkdirSync, rmSync } from "node:fs";
import { RUNS_DIR, SHOTS_DIR, STUDIO_DIR } from "../playwright.config";

export default function globalSetup(): void {
  rmSync(RUNS_DIR, { recursive: true, force: true });
  rmSync(STUDIO_DIR, { recursive: true, force: true });
  mkdirSync(RUNS_DIR, { recursive: true });
  mkdirSync(SHOTS_DIR, { recursive: true });
}
