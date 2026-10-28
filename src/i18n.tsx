import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { setFormatLocale } from "@/lib/format";
import type en from "@/locales/en.json";

/**
 * Every src/locales/<code>.json file is a language: drop a new file in there
 * (copy en.json, translate the values) and it shows up in the language picker.
 * Missing keys fall back to English.
 */
type Messages = Record<string, string>;

const FALLBACK = "en";
const STORAGE_KEY = "pinhole.lang";

const LOCALES: Record<string, Messages> = Object.fromEntries(
  Object.entries(import.meta.glob<Messages>("./locales/*.json", { eager: true, import: "default" })).map(
    ([path, messages]) => [path.match(/([\w-]+)\.json$/)![1], messages],
  ),
);

export const LANGUAGES = Object.keys(LOCALES)
  .map((code) => ({ code, name: LOCALES[code]["meta.name"] ?? code, flag: LOCALES[code]["meta.flag"] ?? "🏳️" }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Keys of en.json, with plural suffixes folded: "tunnel.joiners_one" → "tunnel.joiners". */
export type MessageKey = keyof typeof en extends infer K ? (K extends `${infer B}_${"one" | "other"}` ? B : K) : never;
export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

function detect(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in LOCALES) return saved;
  } catch {
    // Storage unavailable: fall through to the system language.
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    if (tag in LOCALES) return tag;
    const base = tag.split("-")[0];
    if (base in LOCALES) return base;
  }
  return FALLBACK;
}

function lookup(lang: string, key: string): string | undefined {
  return LOCALES[lang]?.[key] ?? LOCALES[FALLBACK][key];
}

function makeTranslate(lang: string): Translate {
  const locale = lookup(lang, "meta.locale") ?? lang;
  const plurals = new Intl.PluralRules(locale);
  return (key, params) => {
    let text: string | undefined;
    if (typeof params?.count === "number") text = lookup(lang, `${key}_${plurals.select(params.count)}`) ?? lookup(lang, `${key}_other`);
    text ??= lookup(lang, key) ?? key;
    return params ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : text;
  };
}

interface I18n {
  lang: string;
  setLang: (lang: string) => void;
  t: Translate;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState(detect);

  const t = useMemo(() => {
    const translate = makeTranslate(lang);
    // Number/byte formatting is module-level: configure it before children render.
    setFormatLocale(translate("meta.locale"), {
      bytes: translate("units.bytes").split(" "),
      packetsPerSec: translate("units.packetsPerSec"),
      duration: translate("units.duration").split(" "),
    });
    return translate;
  }, [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: string) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisted, still applied for this session.
    }
  }, []);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
