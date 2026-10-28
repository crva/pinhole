import { Settings } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { type CloseAction, getCloseAction, getRelay, isPlainHttp, isValidRelay, setCloseAction, setRelay } from "@/lib/settings";

type Mode = "default" | "custom";

export function SettingsDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("default");
  const [url, setUrl] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [closeAction, setCloseActionState] = useState<CloseAction>("ask");

  function onOpenChange(next: boolean) {
    if (next) {
      // Start from what is saved, dropping unsaved edits from last time.
      const saved = getRelay();
      setMode(saved ? "custom" : "default");
      setUrl(saved ?? "");
      setInvalid(false);
      setCloseActionState(getCloseAction());
    }
    setOpen(next);
  }

  function save() {
    if (mode === "custom" && !isValidRelay(url)) {
      setInvalid(true);
      return;
    }
    setRelay(mode === "custom" ? url.trim() : null);
    setCloseAction(closeAction);
    toast.success(t("settings.saved"), { description: t("settings.appliesNext") });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("settings.title")}>
              <Settings />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("settings.title")}</TooltipContent>
      </Tooltip>

      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.relayHelp")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label className="text-sm font-semibold">{t("settings.relay")}</Label>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="gap-2">
            <Option value="default" title={t("settings.relayDefault")} text={t("settings.relayDefaultText")} />
            <Option value="custom" title={t("settings.relayCustom")} text={t("settings.relayCustomText")} />
          </RadioGroup>

          {mode === "custom" && (
            <div className="space-y-1.5">
              <Input
                autoFocus
                placeholder="https://relay.example.com"
                className="font-mono text-xs"
                aria-label={t("settings.relayUrl")}
                aria-invalid={invalid}
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setInvalid(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
              {invalid && <p className="text-xs text-destructive">{t("settings.relayInvalid")}</p>}
              {!invalid && isPlainHttp(url) && <p className="text-xs text-amber-600 dark:text-amber-400">{t("settings.relayHttpWarn")}</p>}
              <p className="text-xs text-muted-foreground">
                {t("settings.relayHowTo")} <span className="font-mono">docs.iroh.computer/add-a-relay</span>
              </p>
            </div>
          )}

          <p className="text-xs text-muted-foreground">{t("settings.relayOtherSide")}</p>
          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <Label htmlFor="settings-on-close" className="text-sm font-semibold">
              {t("settings.onClose")}
            </Label>
            <Select value={closeAction} onValueChange={(v) => setCloseActionState(v as CloseAction)}>
              <SelectTrigger id="settings-on-close" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                <SelectItem value="ask">{t("settings.onCloseAsk")}</SelectItem>
                <SelectItem value="tray">{t("settings.onCloseTray")}</SelectItem>
                <SelectItem value="quit">{t("settings.onCloseQuit")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <p className="border-t pt-3 text-[11px] text-muted-foreground">{t("settings.credits")}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("settings.cancel")}
          </Button>
          <Button onClick={save}>{t("settings.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Option({ value, title, text }: { value: Mode; title: string; text: string }) {
  return (
    <Label
      htmlFor={`relay-${value}`}
      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
    >
      <RadioGroupItem id={`relay-${value}`} value={value} className="mt-0.5" />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{text}</span>
      </span>
    </Label>
  );
}
