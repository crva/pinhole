import { useI18n } from "@/i18n";

const STEPS = ["empty.step1", "empty.step2", "empty.step3"] as const;

export function EmptyState() {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-dashed p-4">
      <p className="text-sm font-medium">{t("empty.title")}</p>
      <ol className="mt-3 space-y-2.5">
        {STEPS.map((step, i) => (
          <li key={step} className="flex gap-2.5 text-xs text-muted-foreground">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[10px] font-bold text-primary">
              {i + 1}
            </span>
            <span className="pt-0.5">{t(step)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
