import { Loader2, Minus, Plus, Share2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, MAX_PEERS, type Proto } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n";
import { errorText } from "@/lib/status";

const LAST_KEY = "pinhole.lastShare";
const MAX_LIMIT = MAX_PEERS;

const clampLimit = (n: number) => Math.min(MAX_LIMIT, Math.max(1, Math.round(n) || 1));

function loadLast(): { proto: Proto; port: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null");
    if (saved && (saved.proto === "tcp" || saved.proto === "udp")) return { proto: saved.proto, port: String(saved.port ?? "") };
  } catch {
    // Nothing saved or storage unavailable.
  }
  return { proto: "tcp", port: "" };
}

export function ShareForm({ onDone }: { onDone: () => void }) {
  const [last] = useState(loadLast);
  const [proto, setProto] = useState<Proto>(last.proto);
  const [port, setPort] = useState(last.port);
  // Deliberately not remembered: every share starts at the safest setting.
  const [maxPeers, setMaxPeers] = useState(1);
  // What the field shows while typing; committed (clamped) on blur and on submit.
  const [limitText, setLimitText] = useState("1");

  function commitLimit(n: number) {
    const limit = clampLimit(n);
    setMaxPeers(limit);
    setLimitText(String(limit));
    return limit;
  }
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();

  async function submit() {
    const p = Number(port);
    if (!(Number.isInteger(p) && p >= 1 && p <= 65535)) {
      toast.error(t("port.invalid"), { description: t("port.invalidText") });
      return;
    }
    // Never share with a limit the form didn't show: an out-of-range entry is corrected first.
    const limit = Number(limitText);
    if (!(Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT)) {
      commitLimit(limit);
      toast.error(t("share.limitInvalid", { max: MAX_LIMIT }));
      return;
    }
    setBusy(true);
    try {
      await api.share(proto, p, commitLimit(limit));
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify({ proto, port: p }));
      } catch {
        // Only a convenience.
      }
      toast.success(t("share.ready"), { description: t("share.readyText") });
      onDone();
    } catch (e) {
      toast.error(t("share.failed"), { description: errorText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="share-port">{t("share.port")}</Label>
        <div className="flex gap-2">
          <Input
            id="share-port"
            type="number"
            inputMode="numeric"
            min={1}
            max={65535}
            placeholder={t("share.portPlaceholder")}
            className="font-mono"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
          <Tabs value={proto} onValueChange={(v) => setProto(v as Proto)} aria-label={t("share.protocol")}>
            <TabsList className="h-9">
              <TabsTrigger value="tcp" className="px-2.5 font-mono text-xs">
                TCP
              </TabsTrigger>
              <TabsTrigger value="udp" className="px-2.5 font-mono text-xs">
                UDP
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <p className="text-xs text-muted-foreground">{t("share.portHint")}</p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="share-limit">{t("share.limit")}</Label>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t("share.limitLess")}
              disabled={maxPeers <= 1}
              onClick={() => commitLimit(maxPeers - 1)}
            >
              <Minus />
            </Button>
            <Input
              id="share-limit"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_LIMIT}
              className="h-8 w-12 text-center font-mono [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              value={limitText}
              onChange={(e) => {
                setLimitText(e.target.value);
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 1 && n <= MAX_LIMIT) setMaxPeers(n);
              }}
              onBlur={() => commitLimit(Number(limitText))}
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t("share.limitMore")}
              disabled={maxPeers >= MAX_LIMIT}
              onClick={() => commitLimit(maxPeers + 1)}
            >
              <Plus />
            </Button>
          </div>
        </div>
        {maxPeers === 1 ? (
          <p className="text-xs text-muted-foreground">{t("share.limitOneHint", { max: MAX_LIMIT })}</p>
        ) : (
          <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-1">
              <p className="font-medium">{t("share.limitWarnTitle", { count: maxPeers })}</p>
              <p className="text-muted-foreground">{t("share.limitWarnText")}</p>
            </div>
          </div>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Share2 />}
        {busy ? t("share.busy") : t("share.submit")}
      </Button>
    </form>
  );
}
