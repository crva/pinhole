import { ChevronRight, ClipboardPaste, Loader2, Plug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { errorText } from "@/lib/status";
import { cn } from "@/lib/utils";

export function JoinForm({ onDone }: { onDone: () => void }) {
  const [ticket, setTicket] = useState("");
  const [port, setPort] = useState("");
  const [showPort, setShowPort] = useState(false);
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();

  async function paste() {
    try {
      setTicket((await navigator.clipboard.readText()).trim());
    } catch {
      toast.error(t("join.pasteFailed"), { description: t("join.pasteFailedText") });
    }
  }

  async function submit() {
    const code = ticket.trim();
    if (!code) {
      toast.error(t("join.noCode"));
      return;
    }
    const localPort = port.trim() ? Number(port) : null;
    if (localPort !== null && !(Number.isInteger(localPort) && localPort >= 1 && localPort <= 65535)) {
      toast.error(t("port.invalid"), { description: t("port.invalidOptionalText") });
      return;
    }
    setBusy(true);
    try {
      const info = await api.join(code, localPort);
      setTicket("");
      toast.success(t("join.started"), { description: t("join.startedText", { port: info.port }) });
      onDone();
    } catch (e) {
      toast.error(t("join.failed"), { description: errorText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="join-ticket">{t("join.code")}</Label>
          <Button variant="ghost" size="xs" onClick={paste}>
            <ClipboardPaste />
            {t("join.paste")}
          </Button>
        </div>
        <Textarea
          id="join-ticket"
          placeholder="ph1_…"
          className="min-h-16 resize-none font-mono text-xs break-all"
          rows={2}
          value={ticket}
          onChange={(e) => setTicket(e.target.value)}
        />
      </div>

      <div>
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          aria-expanded={showPort}
          onClick={() => setShowPort((v) => !v)}
        >
          <ChevronRight className={cn("size-3.5 transition-transform", showPort && "rotate-90")} />
          {t("join.advanced")}
        </button>
        {showPort && (
          <div className="mt-2 space-y-1.5">
            <Label htmlFor="join-port">{t("join.localPort")}</Label>
            <Input
              id="join-port"
              type="number"
              inputMode="numeric"
              min={1}
              max={65535}
              placeholder={t("join.localPortPlaceholder")}
              className="font-mono"
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("join.localPortHint")}</p>
          </div>
        )}
      </div>

      <Button className="w-full" disabled={busy} onClick={submit}>
        {busy ? <Loader2 className="animate-spin" /> : <Plug />}
        {busy ? t("join.busy") : t("join.submit")}
      </Button>
    </div>
  );
}
