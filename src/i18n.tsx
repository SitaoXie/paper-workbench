import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { english } from "./locales";

export type Locale = "zh" | "en";
const LOCALE_KEY = "paper-workbench:locale";
const CHANGE_EVENT = "paper-workbench:locale-change";

/** Explicit paths take precedence over language subdomains and saved preferences.
 * Both paths work on localhost; no DNS or device-wide configuration is needed. */
export function resolveLocale(pathname: string, hostname: string, stored?: string | null): Locale {
  const pathLocale = pathname.match(/^\/(zh|en)(?:\/|$)/i)?.[1]?.toLowerCase();
  if (pathLocale === "zh" || pathLocale === "en") return pathLocale;
  const subdomain = hostname.split(".")[0]?.toLowerCase();
  if (subdomain === "zh" || subdomain === "en") return subdomain;
  return stored === "en" ? "en" : "zh";
}

export function getLocale(): Locale {
  if (typeof window === "undefined") return "zh";
  let stored: string | null = null;
  try { stored = window.localStorage.getItem(LOCALE_KEY); } catch { /* Session language works without storage. */ }
  return resolveLocale(window.location.pathname, window.location.hostname, stored);
}

/** Translate interface text only. Paper content, user notes, API names and model
 * output are never passed through this dictionary automatically. */
export function t(chinese: string, englishText?: string): string {
  return getLocale() === "en" ? (englishText ?? english[chinese] ?? chinese) : chinese;
}

function updateDocument(locale: Locale) {
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  document.title = locale === "zh" ? "Paper Workbench · 论文阅读与笔记" : "Paper Workbench · Read, annotate, research";
}

function changeLocale(locale: Locale) {
  if (typeof window === "undefined") return;
  const path = window.location.pathname.replace(/^\/(zh|en)(?=\/|$)/i, "");
  const nextPath = `/${locale}${path.startsWith("/") ? path : `/${path}`}`;
  window.history.replaceState(window.history.state, "", `${nextPath}${window.location.search}${window.location.hash}`);
  try { window.localStorage.setItem(LOCALE_KEY, locale); } catch { /* URL keeps the preference when storage is unavailable. */ }
  updateDocument(locale);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

type LocaleState = { locale: Locale; setLocale: (locale: Locale) => void; t: typeof t };
const LocaleContext = createContext<LocaleState | null>(null);
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState(getLocale);
  useEffect(() => {
    const sync = () => {
      const next = getLocale();
      setLocaleState(next);
      updateDocument(next);
    };
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return <LocaleContext.Provider value={{ locale, setLocale: changeLocale, t }}>{children}</LocaleContext.Provider>;
}
export function useLocale(): LocaleState {
  const context = useContext(LocaleContext);
  // Keep small standalone renderers usable outside the app shell.
  return context ?? { locale: getLocale(), setLocale: changeLocale, t };
}
