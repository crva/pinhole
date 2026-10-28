import { currentMonitor, getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

/** False in a plain browser (`npm run dev`): no window or tray to drive. */
export const isTauri = "__TAURI_INTERNALS__" in window;

/** Width the details panel needs next to the main column (see App: min-[820px]). */
const WIDE_WIDTH = 900;

let restoreWidth: number | null = null;
let queue = Promise.resolve();

/**
 * Widens the window so the details panel fits beside the main column, and
 * gives the width back on close. No-op in a browser, a maximized window, or on a
 * screen too narrow for it (the panel then replaces the list, see App).
 * Calls run one after the other so an open and a close can't interleave.
 */
export function fitDetails(open: boolean): Promise<void> {
  queue = queue.then(() => resize(open));
  return queue;
}

async function resize(open: boolean) {
  if (!isTauri) return;
  try {
    const win = getCurrentWindow();
    if ((await win.isMaximized()) || (await win.isFullscreen())) return;
    const size = (await win.innerSize()).toLogical(await win.scaleFactor());
    if (open) {
      if (Math.round(size.width) >= WIDE_WIDTH) return;
      const monitor = await currentMonitor();
      if (monitor && monitor.size.toLogical(monitor.scaleFactor).width < WIDE_WIDTH) return;
      restoreWidth = size.width;
      await win.setSize(new LogicalSize(WIDE_WIDTH, size.height));
    } else if (restoreWidth !== null) {
      await win.setSize(new LogicalSize(restoreWidth, size.height));
      restoreWidth = null;
    }
  } catch (e) {
    console.error("window resize failed", e);
  }
}
