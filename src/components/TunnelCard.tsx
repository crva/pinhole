import { ArrowDown, ArrowUp, Check, ChartSpline, Copy, Loader2, Plug, Share2, ShieldAlert, Users, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TunnelView } from "@/hooks/useTunnels";
import { useI18n } from "@/i18n";
import { formatRate } from "@/lib/format";
import { statusText } from "@/lib/status";
import { cn } from "@/lib/utils";

export function TunnelCard({
  view,
  selected,
  onDetails,
  onStop,
}: {
  view: TunnelView;
  selected: boolean;
  onDetails: () => void;
  onStop: () => void;
}) {
  const { info, rate } = view;
  const { t } = useI18n();
  const share = info.role === "share";
  const Icon = share ? Share2 : Plug;
  const failed = info.phase === "failed";
  const connecting = info.phase === "connecting" || info.phase === "reconnecting";

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border bg-card p-3 text-card-foreground transition-shadow",
        failed && "border-destructive/50",
        selected && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            failed ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
            {share ? t("tunnel.share") : t("tunnel.join")}
            <span className="font-mono text-xs font-normal text-muted-foreground">
              {info.proto.toUpperCase()} {info.port}
            </span>
          </div>
          <p className={cn("truncate text-xs text-muted-foreground", failed && "text-destructive")}>
            {statusText(info, t)}
          </p>
        </div>
        <StatusBadge view={view} connecting={connecting} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="-mt-0.5 -mr-1" onClick={onStop} aria-label={t("tunnel.stop")}>
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{failed ? t("tunnel.close") : share ? t("tunnel.stopShare") : t("tunnel.disconnect")}</TooltipContent>
        </Tooltip>
      </div>

      {share && info.ticket && (
        <CopyField label={t("tunnel.sendCode")} value={info.ticket} toastText={t("tunnel.codeCopied")} truncate />
      )}
      {!share && !failed && (
        <CopyField label={t("tunnel.connectTo")} value={`localhost:${info.port}`} toastText={t("tunnel.addressCopied")} />
      )}

      {failed && info.problem && (
        <div className="space-y-1 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
          <p>{t(`help.${info.problem.kind}`)}</p>
          {info.problem.detail && <p className="font-mono text-[11px] break-all text-destructive/70">{info.problem.detail}</p>}
        </div>
      )}

      {share && info.refused > 0 && (
        <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <div className="space-y-1">
            <p className="font-medium text-destructive">{t("tunnel.refused", { count: info.refused })}</p>
            <p className="text-muted-foreground">{t("tunnel.refusedHelp")}</p>
          </div>
        </div>
      )}

      {!failed && (
        <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground tabular-nums">
          <span className="flex items-center gap-0.5" title={t("tunnel.received")}>
            <ArrowDown className="size-3" style={{ color: "var(--chart-1)" }} />
            {formatRate(rate.rxBytes)}
          </span>
          <span className="flex items-center gap-0.5" title={t("tunnel.sent")}>
            <ArrowUp className="size-3" style={{ color: "var(--chart-2)" }} />
            {formatRate(rate.txBytes)}
          </span>
          {share && (
            <span className="flex items-center gap-1 font-sans">
              <Users className="size-3" />
              {info.peers}/{info.max_peers}
            </span>
          )}
          <Button variant={selected ? "secondary" : "ghost"} size="xs" className="ml-auto font-sans" onClick={onDetails} aria-pressed={selected}>
            <ChartSpline />
            {selected ? t("details.hide") : t("details.show")}
          </Button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ view, connecting }: { view: TunnelView; connecting: boolean }) {
  const { info } = view;
  const { t } = useI18n();
  if (info.phase === "failed") return <Badge variant="destructive">{t("badge.failed")}</Badge>;
  if (connecting) {
    return (
      <Badge variant="outline">
        <Loader2 className="animate-spin" />
        {t("badge.connecting")}
      </Badge>
    );
  }
  if (info.path === "direct") {
    return (
      <Badge>
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary-foreground opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-primary-foreground" />
        </span>
        {t("badge.direct")}
      </Badge>
    );
  }
  return <Badge variant="secondary">{t("badge.waiting")}</Badge>;
}

function CopyField({
  label,
  value,
  toastText,
  truncate = false,
}: {
  label: string;
  value: string;
  toastText: string;
  truncate?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      toast.error(t("tunnel.copyFailed"));
      return;
    }
    setCopied(true);
    toast.success(toastText);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-1 pl-2.5">
        <code className={cn("min-w-0 flex-1 font-mono text-xs", truncate && "truncate")}>{value}</code>
        <Button size="xs" variant={copied ? "secondary" : "default"} onClick={copy}>
          {copied ? <Check /> : <Copy />}
          {copied ? t("tunnel.copied") : t("tunnel.copy")}
        </Button>
      </div>
    </div>
  );
}
