/**
 * Dev-only demo mode for the README screenshots (scripts/screenshots.mjs): `npm run dev`,
 * then open `/?demo` (`?demo=details` opens the details panel, `&theme=light|dark`).
 * Sample tunnels stand in for the Rust side, and the page is framed like a desktop
 * window. Loaded from main.tsx behind `import.meta.env.DEV`, so never part of a build.
 */
import type { ConnInfo, Traffic, TunnelInfo } from "@/api";

/**
 * App content size: as in tauri.conf.json for the list; the details panel widens it (see
 * lib/window.ts), and that shot stops right under the traffic graph instead of mid-card.
 */
const SIZE = { list: [440, 680], details: [900, 584] } as const;

const EU_RELAY = "https://euc1-1.relay.n0.iroh.link./";
const US_RELAY = "https://use1-1.relay.n0.iroh.link./";

/** A made-up code with the right look (base64url after the prefix). */
const TICKET =
  "ph1_" +
  Array.from({ length: 148 }, (_, i) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[(i * 37 + 11) % 64]).join("");

/** Smooth, slightly irregular per-second rate around `base`. */
const wave = (n: number, base: number, phase: number) =>
  base * (1 + 0.4 * Math.sin(n / 7 + phase) + 0.12 * Math.sin(n / 2.6 + phase * 2) + 0.04 * Math.sin(n * 1.2));

function counter() {
  const total: Traffic = { tx_bytes: 0, rx_bytes: 0, tx_packets: 0, rx_packets: 0 };
  return (n: number, tx: number, rx: number, phase: number): Traffic => {
    const txBytes = wave(n, tx, phase);
    const rxBytes = wave(n, rx, phase + 1);
    total.tx_bytes += Math.round(txBytes);
    total.rx_bytes += Math.round(rxBytes);
    total.tx_packets += Math.round(txBytes / 820);
    total.rx_packets += Math.round(rxBytes / 640);
    return { ...total };
  };
}

/** The details shot shows the share alone, so its list ends cleanly too. */
function sampleTunnels(count: number) {
  const game = counter();
  const voice = counter();
  let n = 0;
  return (): TunnelInfo[] => {
    n++;
    const gameTraffic = game(n, 210_000, 64_000, 0);
    const voiceTraffic = voice(n, 18_000, 42_000, 2);
    const conn = (remote_id: string, rtt: number, addr: string, relay: string, traffic: Traffic): ConnInfo => ({
      remote_id,
      path: "direct",
      rtt_ms: rtt + Math.round(Math.sin(n / 4) * 2),
      direct_addr: addr,
      relay,
      relay_bytes: 49_300 + n * 22,
      traffic,
    });
    const base = { ticket: null, problem: null, refused: 0, path: "direct", max_peers: null } as const;
    const tunnels: TunnelInfo[] = [
      {
        ...base,
        id: 1,
        role: "share",
        proto: "tcp",
        port: 25565,
        ticket: TICKET,
        phase: "connected",
        peers: 1,
        max_peers: 1,
        rtt_ms: 18,
        home_relay: EU_RELAY,
        traffic: gameTraffic,
        uptime_secs: 8237 + n,
        connections: [conn("b7e41f09ac", 18, "203.0.113.24:51820", EU_RELAY, gameTraffic)],
      },
      {
        ...base,
        id: 2,
        role: "join",
        proto: "udp",
        port: 9987,
        phase: "connected",
        peers: 1,
        rtt_ms: 31,
        home_relay: EU_RELAY,
        traffic: voiceTraffic,
        uptime_secs: 1504 + n,
        connections: [conn("4d2c88e1f3", 31, "198.51.100.7:40213", US_RELAY, voiceTraffic)],
      },
    ];
    return tunnels.slice(0, count);
  };
}

const FRAME_CSS = `
  html, body { background: transparent !important; }
  body { padding: 24px 40px 56px; }
  .demo-window {
    width: var(--demo-w); border-radius: 12px; overflow: hidden; background: var(--background);
    box-shadow: 0 28px 56px -16px rgb(0 0 0 / 0.4), 0 0 0 1px rgb(0 0 0 / 0.1);
  }
  .dark .demo-window { box-shadow: 0 28px 56px -16px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(255 255 255 / 0.12); }
  .demo-titlebar {
    display: flex; align-items: center; gap: 8px; height: 32px; padding-left: 12px;
    font: 12px var(--font-sans); color: var(--muted-foreground); border-bottom: 1px solid var(--border);
  }
  .demo-titlebar img { width: 16px; height: 16px; }
  .demo-titlebar .controls { margin-left: auto; display: flex; }
  .demo-titlebar .controls svg { width: 46px; height: 32px; padding: 11px 18px; stroke: currentColor; fill: none; }
  #root { width: var(--demo-w); height: var(--demo-h); }
  #root > div { height: 100% !important; }
`;

const CONTROLS = [
  '<svg viewBox="0 0 10 10"><path d="M0 5h10"/></svg>',
  '<svg viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9"/></svg>',
  '<svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10"/></svg>',
].join("");

export function installDemo() {
  const params = new URLSearchParams(location.search);
  const view = params.get("demo") === "details" ? "details" : "list";
  const [width, height] = SIZE[view];

  // Settings the providers read on start: theme, language, the share form's last port.
  localStorage.setItem("theme", params.get("theme") === "dark" ? "dark" : "light");
  localStorage.setItem("pinhole.lang", params.get("lang") ?? "en");
  localStorage.setItem("pinhole.lastShare", JSON.stringify({ proto: "tcp", port: 25565 }));

  const list = sampleTunnels(view === "details" ? 1 : 2);
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string) => (cmd === "list" ? list() : null),
      transformCallback: () => 0,
    },
  });

  const style = document.createElement("style");
  style.textContent = FRAME_CSS;
  document.head.append(style);
  const root = document.getElementById("root")!;
  const frame = document.createElement("div");
  frame.className = "demo-window";
  frame.style.setProperty("--demo-w", `${width}px`);
  frame.style.setProperty("--demo-h", `${height}px`);
  frame.innerHTML = `<div class="demo-titlebar"><img src="/icon.svg" alt="">Pinhole<span class="controls">${CONTROLS}</span></div>`;
  root.replaceWith(frame);
  frame.append(root);

  if (view === "details") {
    const open = setInterval(() => {
      const details = document.querySelector<HTMLButtonElement>('button[aria-pressed="false"]');
      if (details) {
        details.click();
        clearInterval(open);
      }
    }, 100);
  }
}
