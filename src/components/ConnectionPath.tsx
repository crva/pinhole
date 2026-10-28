import { Check, ChevronRight, Loader2, Lock, Monitor, RadioTower, Users } from "lucide-react";
import { useState } from "react";
import type { TunnelInfo } from "@/api";
import { useI18n } from "@/i18n";
import { describeRelay, formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Explains how the two computers are linked: the relay only introduced them
 * (step 1), the data then flows directly (step 2).
 */
export function ConnectionPath({ info }: { info: TunnelInfo }) {
  const { t } = useI18n();
  const [showRelay, setShowRelay] = useState(false);

  // The relay that brought both sides together: the host's home relay.
  const relay = describeRelay(info.role === "share" ? info.home_relay : (info.connections[0]?.relay ?? null));
  const relayBytes = info.connections.reduce((sum, c) => sum + c.relay_bytes, 0);
  const met = info.connections.length > 0;
  const direct = met && info.path === "direct";
  const relayName = relay ? (relay.region ? `${relay.host} (${t(`region.${relay.region}`)})` : relay.host) : "—";
  const other = info.role === "share" ? t("path.joiners") : t("path.host");

  const introText = met
    ? t("path.introDone", { relay: relayName })
    : info.role === "share"
      ? t("path.introWaiting", { relay: relayName })
      : t("path.introJoining", { relay: relayName });

  return (
    <div className="space-y-4 rounded-lg border p-3">
      <h3 className="text-sm font-semibold">{t("path.title")}</h3>

      <Diagram direct={direct} met={met} rtt={info.rtt_ms} other={other} />

      <ol className="space-y-3">
        <Step state={met ? "done" : "active"} title={t("path.introTitle")} badge={met ? t("path.introBadge") : undefined}>
          {introText}
        </Step>
        <Step state={direct ? "active" : "pending"} title={t("path.directTitle")} badge={direct ? t("path.directBadge") : undefined}>
          {direct ? t("path.directActive") : t("path.directPending")}
        </Step>
      </ol>

      {met && (
        <div className="rounded-md bg-muted/40 text-xs">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 p-2 text-left font-medium"
            aria-expanded={showRelay}
            onClick={() => setShowRelay((v) => !v)}
          >
            <ChevronRight className={cn("size-3.5 transition-transform", showRelay && "rotate-90")} />
            {t("path.relayWhat")}
            <span className="ml-auto font-mono font-normal text-muted-foreground">{formatBytes(relayBytes)}</span>
          </button>
          {showRelay && (
            <div className="space-y-2 px-2 pb-2.5 pl-7">
              <p className="flex gap-1.5 font-medium">
                <Lock className="mt-0.5 size-3 shrink-0 text-primary" />
                {t("path.relayEncrypted")}
              </p>
              <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                <li>{t("path.relaySetup")}</li>
                <li>{t("path.relayKeepalive")}</li>
                <li>{t("path.relayData")}</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Step({
  state,
  title,
  badge,
  children,
}: {
  state: "done" | "active" | "pending";
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <li className={cn("flex gap-2.5", state === "pending" && "opacity-60")}>
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
          state === "done" && "bg-muted text-muted-foreground",
          state === "active" && "bg-primary text-primary-foreground",
          state === "pending" && "border border-dashed",
        )}
      >
        {state === "done" ? <Check className="size-3" /> : state === "active" && !badge ? <Loader2 className="size-3 animate-spin" /> : null}
        {state === "active" && badge && <span className="size-1.5 rounded-full bg-primary-foreground" />}
      </span>
      <div className="min-w-0 text-xs">
        <div className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
          {title}
          {badge && <span className="text-[11px] font-normal text-muted-foreground">· {badge}</span>}
        </div>
        <p className="mt-0.5 text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

/** You ↔ other side, with the relay above: faded once the direct link is up. */
function Diagram({ direct, met, rtt, other }: { direct: boolean; met: boolean; rtt: number | null; other: string }) {
  const { t } = useI18n();
  return (
    <div className="relative h-28 select-none" aria-hidden="true">
      <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="absolute inset-0 size-full">
        <path
          d="M40 70 L150 24 L260 70"
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={1.5}
          strokeDasharray="3 4"
          opacity={met ? 0.35 : 0.8}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={40}
          y1={70}
          x2={260}
          y2={70}
          stroke={direct ? "var(--primary)" : "var(--border)"}
          strokeWidth={direct ? 3 : 1.5}
          strokeDasharray={direct ? undefined : "3 4"}
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <Node x="50%" y="24%" icon={RadioTower} label={met ? t("path.relayStandby") : t("path.relay")} faded={met} small />
      <Node x="13.33%" y="70%" icon={Monitor} label={t("path.you")} />
      <Node x="86.67%" y="70%" icon={Users} label={other} faded={!met} />

      <div className="absolute top-[70%] left-1/2 -translate-x-1/2 -translate-y-1/2">
        <span
          className={cn(
            "flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[11px] whitespace-nowrap",
            direct ? "border-primary/40 text-foreground" : "text-muted-foreground",
          )}
        >
          {direct && <Lock className="size-3 text-primary" />}
          {direct ? t("path.directLabel") : t("path.notYet")}
          {direct && rtt != null && <span className="font-mono text-muted-foreground">· {rtt} ms</span>}
        </span>
      </div>
    </div>
  );
}

function Node({
  x,
  y,
  icon: Icon,
  label,
  faded = false,
  small = false,
}: {
  x: string;
  y: string;
  icon: typeof Monitor;
  label: string;
  faded?: boolean;
  small?: boolean;
}) {
  return (
    <div
      className={cn("absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center", faded && "opacity-50")}
      style={{ left: x, top: y }}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-full border bg-card",
          small ? "size-7 text-muted-foreground" : "size-9 text-primary",
        )}
      >
        <Icon className={small ? "size-3.5" : "size-4"} />
      </span>
      <span className={cn("absolute top-full mt-0.5 rounded bg-card px-1 text-[10px] whitespace-nowrap", small ? "text-muted-foreground" : "font-medium")}>
        {label}
      </span>
    </div>
  );
}
