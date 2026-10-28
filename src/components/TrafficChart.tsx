import { useState } from "react";
import { Area, AreaChart, CartesianGrid, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Sample } from "@/hooks/useTunnels";
import { useI18n } from "@/i18n";
import { formatAxis, formatPackets, formatRate } from "@/lib/format";

type Metric = "bytes" | "packets";

export function TrafficChart({ history, id }: { history: Sample[]; id: number }) {
  const [metric, setMetric] = useState<Metric>("bytes");
  const { t } = useI18n();
  const config = {
    rx: { label: t("tunnel.received"), color: "var(--chart-1)" },
    tx: { label: t("tunnel.sent"), color: "var(--chart-2)" },
  } satisfies ChartConfig;
  const format = metric === "packets" ? formatPackets : formatRate;
  const data = history.map((s) =>
    metric === "packets" ? { t: s.t, rx: s.rxPackets, tx: s.txPackets } : { t: s.t, rx: s.rxBytes, tx: s.txBytes },
  );
  const now = data[data.length - 1];

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{t("chart.title")}</h3>
          <p className="text-xs text-muted-foreground">{t(metric === "bytes" ? "chart.bytesHelp" : "chart.packetsHelp")}</p>
        </div>
        <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)}>
          <TabsList className="h-7">
            <TabsTrigger value="bytes" className="px-2 text-xs">
              {t("chart.bytes")}
            </TabsTrigger>
            <TabsTrigger value="packets" className="px-2 text-xs">
              {t("chart.packets")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex gap-4">
        {(["rx", "tx"] as const).map((key) => (
          <div key={key} className="flex items-center gap-1.5 text-xs">
            <span className="size-2 rounded-full" style={{ background: config[key].color }} />
            <span className="text-muted-foreground">{config[key].label}</span>
            <span className="font-mono font-medium tabular-nums">{format(now?.[key] ?? 0)}</span>
          </div>
        ))}
      </div>

      <div>
        <ChartContainer config={config} className="aspect-auto h-32 w-full">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              {(["rx", "tx"] as const).map((key) => (
                <linearGradient key={key} id={`fill-${key}-${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={`var(--color-${key})`} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={`var(--color-${key})`} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <YAxis
              width={metric === "packets" ? 40 : 64}
              tickLine={false}
              axisLine={false}
              tickCount={3}
              // Idle tunnel: a sensible scale instead of "1 B, 2 B".
              domain={[0, (max: number) => Math.max(max, metric === "packets" ? 10 : 10 * 1024)]}
              tickFormatter={(v: number) => formatAxis(v, metric)}
              className="font-mono"
              fontSize={10}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  hideLabel
                  indicator="line"
                  formatter={(value, name) => (
                    <div className="flex w-full items-center justify-between gap-4">
                      <span className="text-muted-foreground">{config[name as keyof typeof config]?.label}</span>
                      <span className="font-mono font-medium tabular-nums">{format(Number(value))}</span>
                    </div>
                  )}
                />
              }
            />
            {(["rx", "tx"] as const).map((key) => (
              <Area
                key={key}
                dataKey={key}
                type="monotone"
                stroke={`var(--color-${key})`}
                strokeWidth={2}
                fill={`url(#fill-${key}-${id})`}
                isAnimationActive={false}
                dot={false}
              />
            ))}
          </AreaChart>
        </ChartContainer>
        <div
          className="flex justify-between text-[10px] text-muted-foreground"
          style={{ paddingLeft: metric === "packets" ? 44 : 68 }}
        >
          <span>{t("chart.ago")}</span>
          <span>{t("chart.now")}</span>
        </div>
      </div>
    </div>
  );
}
