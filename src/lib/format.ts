let decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
let integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
let compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
let BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];
let PACKETS_UNIT = "pkt/s";
let DURATION_UNITS = ["h", "min", "s"];

/** Called by I18nProvider whenever the language changes (units come from the locale file). */
export function setFormatLocale(locale: string, units: { bytes: string[]; packetsPerSec: string; duration: string[] }) {
  decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  BYTE_UNITS = units.bytes;
  PACKETS_UNIT = units.packetsPerSec;
  DURATION_UNITS = units.duration;
}

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? integer.format(value) : decimal.format(value)} ${BYTE_UNITS[unit]}`;
}

export const formatRate = (bytesPerSec: number) => `${formatBytes(bytesPerSec)}/s`;

export const formatPackets = (perSec: number) => `${decimal.format(perSec)} ${PACKETS_UNIT}`;

/** Short axis labels: "120", "1.2K", "56 KB". */
export function formatAxis(value: number, metric: "packets" | "bytes"): string {
  return metric === "packets" ? compact.format(value) : formatBytes(value).replace(/[.,]0 /, " ");
}

export function formatDuration(totalSecs: number): string {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const [hours, minutes, seconds] = DURATION_UNITS;
  if (h > 0) return `${h} ${hours} ${String(m).padStart(2, "0")}`;
  if (m > 0) return `${m} ${minutes} ${String(s).padStart(2, "0")}`;
  return `${s} ${seconds}`;
}

export type Region = "eu" | "usw" | "us" | "ap";

/** "https://euc1-1.relay.n0.iroh.link./" → host + region code (translated as `region.<code>`). */
export function describeRelay(url: string | null): { host: string; region: Region | null } | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.replace(/\.$/, "");
  } catch {
    return { host: url, region: null };
  }
  const prefix = host.split(".")[0] ?? "";
  const region = (["eu", "usw", "us", "ap"] as const).find((r) => prefix.startsWith(r)) ?? null;
  return { host, region };
}
