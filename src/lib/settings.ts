const RELAY_KEY = "pinhole.relay";
const CLOSE_KEY = "pinhole.onClose";

/** What closing the window does: ask each time, keep running in the tray, or quit. */
export type CloseAction = "ask" | "tray" | "quit";

export function getCloseAction(): CloseAction {
  try {
    const saved = localStorage.getItem(CLOSE_KEY);
    if (saved === "tray" || saved === "quit") return saved;
  } catch {
    // Storage unavailable: ask.
  }
  return "ask";
}

export function setCloseAction(action: CloseAction) {
  try {
    if (action === "ask") localStorage.removeItem(CLOSE_KEY);
    else localStorage.setItem(CLOSE_KEY, action);
  } catch {
    // Not persisted: the dialog will ask again next time.
  }
}

/** The self-hosted relay URL, or null for iroh's default (n0) relays. */
export function getRelay(): string | null {
  try {
    return localStorage.getItem(RELAY_KEY) || null;
  } catch {
    return null;
  }
}

export function setRelay(url: string | null) {
  try {
    if (url) localStorage.setItem(RELAY_KEY, url);
    else localStorage.removeItem(RELAY_KEY);
  } catch {
    // Storage unavailable: the setting won't survive a restart.
  }
}

/** Same rule as `parse_relay` on the Rust side: http(s), a host and maybe a port, nothing else. */
export function isValidRelay(url: string): boolean {
  const trimmed = url.trim();
  try {
    const u = new URL(trimmed);
    return (
      (u.protocol === "https:" || u.protocol === "http:") &&
      u.hostname !== "" &&
      u.username === "" &&
      u.password === "" &&
      u.pathname === "/" &&
      !/[?#]/.test(trimmed)
    );
  } catch {
    return false;
  }
}

/** Plain http: the relay connection itself isn't encrypted (the tunnel still is). */
export const isPlainHttp = (url: string) => url.trim().toLowerCase().startsWith("http://");
