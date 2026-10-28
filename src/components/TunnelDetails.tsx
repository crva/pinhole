import { ArrowDown, ArrowLeft, ArrowUp, Clock, Timer, X, type LucideIcon } from "lucide-react";
import type { ConnInfo } from "@/api";
import { ConnectionPath } from "@/components/ConnectionPath";
import { TrafficChart } from "@/components/TrafficChart";
import { Button } from "@/components/ui/button";
import type { PeerRate, TunnelView } from "@/hooks/useTunnels";
import { useI18n } from "@/i18n";
import { formatBytes, formatDuration, formatRate } from "@/lib/format";

/** Everything the average user doesn't need: live stats, graph, relay and per-peer info. */
export function TunnelDetails({ view, onClose }: { view: TunnelView; onClose: () => void }) {
  const { info, rate } = view;
  const { t } = useI18n();

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center gap-2">
        {/* Narrow window: the panel replaces the list, so offer a way back. */}
        <Button variant="ghost" size="icon-sm" className="min-[820px]:hidden" onClick={onClose} aria-label={t("details.hide")}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{t("details.title")}</h2>
          <p className="font-mono text-xs text-muted-foreground">
            {info.role === "share" ? t("tunnel.share") : t("tunnel.join")} · {info.proto.toUpperCase()} {info.port}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" className="max-[819px]:hidden" onClick={onClose} aria-label={t("details.hide")}>
          <X />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat icon={ArrowDown} label={t("tunnel.received")} value={formatRate(rate.rxBytes)} sub={formatBytes(info.traffic.rx_bytes)} accent="var(--chart-1)" />
        <Stat icon={ArrowUp} label={t("tunnel.sent")} value={formatRate(rate.txBytes)} sub={formatBytes(info.traffic.tx_bytes)} accent="var(--chart-2)" />
        <Stat icon={Timer} label={t("tunnel.latency")} value={info.rtt_ms != null ? `${info.rtt_ms} ms` : "—"} sub={t("tunnel.roundTrip")} />
        <Stat icon={Clock} label={t("tunnel.uptime")} value={formatDuration(info.uptime_secs)} sub={t("tunnel.joiners", { count: info.peers })} />
      </div>

      <TrafficChart history={view.history} id={info.id} />

      <ConnectionPath info={info} />

      {info.connections.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {info.role === "share" ? t("tunnel.connectedJoiners") : t("tunnel.host")}
          </div>
          {info.connections.map((c) => (
            <PeerRow key={c.remote_id} conn={c} rate={view.peerRates[c.remote_id]} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-2.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" style={accent ? { color: accent } : undefined} />
        {label}
      </div>
      <div className="mt-1 font-mono text-sm font-bold tabular-nums">{value}</div>
      <div className="font-mono text-[11px] text-muted-foreground tabular-nums">{sub}</div>
    </div>
  );
}

function PeerRow({ conn, rate }: { conn: ConnInfo; rate: PeerRate | undefined }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 rounded-lg border p-2.5 text-sm">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs font-bold uppercase">
        {conn.remote_id.slice(0, 2)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-xs">{conn.remote_id}…</span>
          {conn.rtt_ms != null && <span className="text-xs text-muted-foreground">{conn.rtt_ms} ms</span>}
        </div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">
          {conn.direct_addr ? t("tunnel.directAddr", { addr: conn.direct_addr }) : t("tunnel.searchingDirect")}
        </div>
      </div>
      <div className="text-right font-mono text-[11px] leading-tight tabular-nums">
        <div style={{ color: "var(--chart-1)" }}>↓ {formatRate(rate?.rx ?? 0)}</div>
        <div style={{ color: "var(--chart-2)" }}>↑ {formatRate(rate?.tx ?? 0)}</div>
      </div>
    </div>
  );
}
