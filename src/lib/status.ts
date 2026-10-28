import { MAX_PEERS, type Problem, type SetupErrorKind, type TunnelInfo } from "@/api";
import type { Translate } from "@/i18n";

/** The tunnel's one-line status, from the phase and problem Rust reports. */
export function statusText(info: TunnelInfo, t: Translate): string {
  const failure = info.problem && t(`failure.${info.problem.kind}`);
  switch (info.phase) {
    case "waiting":
      return failure ? t("status.waitingLast", { error: failure }) : t("status.waiting");
    case "connecting":
      return t("status.connecting");
    case "connected":
      return info.role === "share" ? t("status.peers", { count: info.peers }) : t("status.connected");
    case "reconnecting":
      return failure ? t("status.reconnectingWhy", { error: failure }) : t("status.reconnecting");
    case "failed":
      return failure ?? t("badge.failed");
  }
}

function isProblem(e: unknown): e is Problem<SetupErrorKind> {
  return typeof e === "object" && e !== null && typeof (e as Problem).kind === "string";
}

/** A rejected `share` / `join`, translated; anything unexpected is shown as is. */
export function errorText(e: unknown, t: Translate): string {
  if (!isProblem(e)) return String(e);
  return t(`error.${e.kind}`, { detail: e.detail ?? "", max: MAX_PEERS });
}
