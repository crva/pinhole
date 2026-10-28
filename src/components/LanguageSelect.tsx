import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LANGUAGES, useI18n } from "@/i18n";

export function LanguageSelect() {
  const { lang, setLang, t } = useI18n();
  const current = LANGUAGES.find((l) => l.code === lang);
  return (
    <Select value={lang} onValueChange={setLang}>
      <SelectTrigger size="sm" aria-label={t("app.language")} className="border-none px-2 shadow-none">
        <SelectValue>
          <span className="flag text-lg leading-none">{current?.flag}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        {LANGUAGES.map((l) => (
          <SelectItem key={l.code} value={l.code}>
            <span className="flag text-base leading-none">{l.flag}</span>
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
