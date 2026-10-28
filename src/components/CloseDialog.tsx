import { listen } from "@tauri-apps/api/event";
import { LogOut, PanelBottomClose } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { getCloseAction, setCloseAction } from "@/lib/settings";
import { isTauri } from "@/lib/window";

/**
 * Closing the window (see src-tauri/src/tray.rs): keep running in the tray or quit,
 * as saved in Settings, or asked here.
 */
export function CloseDialog({ active }: { active: number }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen("close-requested", () => {
      const action = getCloseAction();
      if (action === "tray") api.hide();
      else if (action === "quit") api.quit();
      else {
        setRemember(false);
        setOpen(true);
      }
    });
    return () => {
      unlisten.then((stop) => stop());
    };
  }, []);

  function choose(action: "tray" | "quit") {
    if (remember) setCloseAction(action);
    setOpen(false);
    if (action === "tray") api.hide();
    else api.quit();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("close.title")}</DialogTitle>
          <DialogDescription>{active > 0 ? t("close.active", { count: active }) : t("close.none")}</DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 text-xs text-muted-foreground">
          <li>{t("close.trayText")}</li>
          <li>{t("close.quitText")}</li>
        </ul>

        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="size-3.5 accent-primary"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t("close.remember")}
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => choose("quit")}>
            <LogOut />
            {t("close.quit")}
          </Button>
          <Button autoFocus onClick={() => choose("tray")}>
            <PanelBottomClose />
            {t("close.tray")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
