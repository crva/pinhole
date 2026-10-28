// Regenerates the README screenshots (docs/screenshots/*.png) from the dev server's demo
// mode (src/demo.ts), with a headless Edge or Chrome:
//
//   npm run dev -- --port 1431          (in another terminal)
//   node scripts/screenshots.mjs        (DEMO_URL / BROWSER override the defaults)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.env.DEMO_URL ?? "http://localhost:1431";
const browser =
  process.env.BROWSER ??
  [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find(existsSync);
if (!browser) throw new Error("no Edge or Chrome found: set BROWSER to one");

// App content size (src/demo.ts) + the page padding and title bar around it.
const shots = [
  { name: "details", view: "details", width: 900, height: 584 },
  { name: "list", view: "list", width: 440, height: 680 },
];
const out = path.resolve(import.meta.dirname, "../docs/screenshots");

/** Edge's launcher returns at once and the headless browser writes the file later: wait for it. */
async function waitForFile(file, timeoutMs = 120_000) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (const start = Date.now(); Date.now() - start < timeoutMs; await sleep(250)) {
    if (!existsSync(file)) continue;
    const size = statSync(file).size;
    await sleep(500);
    if (size > 0 && statSync(file).size === size) return;
  }
  throw new Error(`no screenshot after ${timeoutMs / 1000} s: ${file}`);
}
mkdirSync(out, { recursive: true });

for (const shot of shots) {
  for (const theme of ["light", "dark"]) {
    const file = path.join(out, `${shot.name}-${theme}.png`);
    // A throwaway profile per shot: otherwise a browser still open (yours, or the last shot's
    // winding down) takes the command and drops it.
    const profile = mkdtempSync(path.join(os.tmpdir(), "pinhole-shots-"));
    rmSync(file, { force: true });
    execFileSync(browser, [
      "--headless",
      `--user-data-dir=${profile}`,
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=2",
      "--default-background-color=00000000",
      `--window-size=${shot.width + 80},${shot.height + 32 + 80}`,
      // Fast-forwards the 1 s polling so the traffic graph has a full minute of history.
      "--virtual-time-budget=75000",
      `--screenshot=${file}`,
      `${url}/?demo=${shot.view}&theme=${theme}`,
    ]);
    await waitForFile(file);
    console.log("wrote", path.relative(process.cwd(), file));
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Still held by the browser's last processes (Windows): left to the OS's temp cleanup.
    }
  }
}
