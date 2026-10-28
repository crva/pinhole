import { Lock, Plug, Share2 } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { CloseDialog } from "@/components/CloseDialog";
import { EmptyState } from "@/components/EmptyState";
import { JoinForm } from "@/components/JoinForm";
import { LanguageSelect } from "@/components/LanguageSelect";
import { SettingsDialog } from "@/components/SettingsDialog";
import { ShareForm } from "@/components/ShareForm";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TunnelCard } from "@/components/TunnelCard";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/api";
import { useTunnels } from "@/hooks/useTunnels";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { fitDetails } from "@/lib/window";

// The details panel carries the chart library: loaded on first use, out of the main bundle.
const TunnelDetails = lazy(() => import("@/components/TunnelDetails").then((m) => ({ default: m.TunnelDetails })));

function App() {
  const { tunnels, refresh } = useTunnels();
  const { t } = useI18n();
  const [detailsId, setDetailsId] = useState<number | null>(null);
  // A failed tunnel has no details button, so its panel closes too.
  const details = tunnels.find((v) => v.info.id === detailsId && v.info.phase !== "failed");
  const open = details !== undefined;

  async function toggleDetails(id: number) {
    if (detailsId === id) return closeDetails();
    // Widen first so the panel opens beside the list rather than over it.
    if (!open) await fitDetails(true);
    setDetailsId(id);
  }

  function closeDetails() {
    setDetailsId(null);
  }

  // The tray menu (built in Rust) follows the UI language.
  useEffect(() => {
    api.trayLabels(t("tray.show"), t("tray.quit")).catch(() => {});
  }, [t]);

  // The window follows the panel, however it was closed (button, tunnel stopped or failed).
  useEffect(() => {
    if (!open && detailsId !== null) setDetailsId(null);
    fitDetails(open);
  }, [open, detailsId]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex shrink-0 items-center gap-2.5 border-b px-4 py-2">
        <img src="/icon.svg" alt="" className="size-7" />
        <div className="min-w-0 flex-1">
          <h1 className="text-sm leading-tight font-bold tracking-tight">Pinhole</h1>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="flex w-fit cursor-help items-center gap-1 text-[11px] whitespace-nowrap text-muted-foreground">
                <Lock className="size-3 shrink-0 text-primary" />
                {t("app.tagline")}
              </p>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{t("app.taglineLong")}</TooltipContent>
          </Tooltip>
        </div>
        <LanguageSelect />
        <ThemeToggle />
        <SettingsDialog />
      </header>

      <div className="flex min-h-0 flex-1">
        <main
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            details && "max-[819px]:hidden min-[820px]:w-[440px] min-[820px]:flex-none",
          )}
        >
          <div className="mx-auto max-w-md space-y-5 p-4">
            <Tabs defaultValue="share" className="gap-3">
              <TabsList className="w-full">
                <TabsTrigger value="share">
                  <Share2 />
                  {t("app.tabShare")}
                </TabsTrigger>
                <TabsTrigger value="join">
                  <Plug />
                  {t("app.tabJoin")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="share">
                <ShareForm onDone={refresh} />
              </TabsContent>
              <TabsContent value="join">
                <JoinForm onDone={refresh} />
              </TabsContent>
            </Tabs>

            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {t("app.activeTunnels")}
                </h2>
                {tunnels.length > 0 && <Badge variant="secondary">{tunnels.length}</Badge>}
              </div>
              {tunnels.length === 0 ? (
                <EmptyState />
              ) : (
                tunnels.map((view) => (
                  <TunnelCard
                    key={view.info.id}
                    view={view}
                    selected={view.info.id === detailsId}
                    onDetails={() => toggleDetails(view.info.id)}
                    onStop={() => api.stop(view.info.id).then(refresh)}
                  />
                ))
              )}
            </section>
          </div>
        </main>

        {details && (
          <aside className="min-h-0 flex-1 overflow-y-auto bg-muted/20 min-[820px]:border-l">
            <Suspense fallback={null}>
              <TunnelDetails view={details} onClose={closeDetails} />
            </Suspense>
          </aside>
        )}
      </div>

      <CloseDialog active={tunnels.length} />
    </div>
  );
}

export default App;
