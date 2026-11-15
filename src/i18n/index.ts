/**
 * Translations. Every user-facing string lives in a catalogue, one file per
 * language: `en.ts` is the source (its keys are the type) and the fallback,
 * `fr.ts` must carry the same keys. `t()` reads the current language; the
 * language follows the browser and a choice made in the settings is remembered.
 */
import { effect, signal } from "@preact/signals";
import { en, type MessageKey } from "./en";
import { fr } from "./fr";

export type { MessageKey } from "./en";
export type Lang = "en" | "fr";

export const LANGS: { id: Lang; name: string; locale: string }[] = [
  { id: "en", name: "English", locale: "en-GB" },
  { id: "fr", name: "Français", locale: "fr-FR" },
];

const CATALOGUES: Record<Lang, Record<MessageKey, string>> = { en, fr };
const KEY = "ways:lang";

function isLang(v: unknown): v is Lang {
  return LANGS.some((x) => x.id === v);
}

/** The first of the browser's preferred languages that ways speaks, or English. */
export function detectLang(preferred: readonly string[]): Lang {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (isLang(base)) return base;
  }
  return "en";
}

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch {}
  if (typeof navigator === "undefined") return "en";
  return detectLang(navigator.languages?.length ? navigator.languages : [navigator.language ?? ""]);
}

export const lang = signal<Lang>(typeof window === "undefined" ? "en" : initial());

if (typeof document !== "undefined") {
  effect(() => {
    document.documentElement.lang = lang.value;
  });
}

/** Switches language and remembers the choice. */
export function setLang(next: Lang): void {
  lang.value = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
}

/** The current language's version of a message, with its `{name}` placeholders filled. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const text = CATALOGUES[lang.value][key] ?? en[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Picks the singular or plural message for a count, by the language's own rule. */
export function plural(
  n: number,
  one: MessageKey,
  other: MessageKey,
  vars: Record<string, string | number> = {},
): string {
  const single = new Intl.PluralRules(locale()).select(n) === "one";
  return t(single ? one : other, { n, ...vars });
}

/** The BCP 47 locale of the current language, for Intl formatting. */
export function locale(): string {
  const id = lang.value;
  return LANGS.find((x) => x.id === id)?.locale ?? "en-GB";
}

/** A distance in metres, as the current language writes it ("350 m", "1.2 km" / "1,2 km"). */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `${km.toLocaleString(locale(), { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}

/** A duration in seconds as "8 min" or "1 h 05". Anything under a minute is one minute. */
export function formatDuration(seconds: number): string {
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return t("unit.min", { n: min });
  return t("unit.hmin", { h: Math.floor(min / 60), m: String(min % 60).padStart(2, "0") });
}

/** A clock time ("14:05"), in the time zone of the place when it is known. */
export function formatTime(ms: number, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat(locale(), {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      ...(timeZone ? { timeZone } : {}),
    }).format(ms);
  } catch {
    return new Intl.DateTimeFormat(locale(), {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(ms);
  }
}

/** How far away a moment is, in whole minutes from `now` (negative when it has passed). */
export function minutesUntil(ms: number, now = Date.now()): number {
  return Math.round((ms - now) / 60000);
}
