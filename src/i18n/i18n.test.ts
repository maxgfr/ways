import { afterEach, describe, expect, test } from "bun:test";
import {
  detectLang,
  formatDistance,
  formatDuration,
  LANGS,
  lang,
  minutesUntil,
  plural,
  t,
} from "./index";
import de from "./locales/de.json";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

afterEach(() => {
  lang.value = "en";
});

const TRANSLATIONS: [string, Record<string, string>][] = [
  ["fr", fr],
  ["de", de],
];

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
}

describe("catalogues", () => {
  test("every language ways offers has a catalogue, and every catalogue a language", () => {
    expect(LANGS.map((l) => l.id).sort()).toEqual(["de", "en", "fr"]);
  });

  for (const [name, catalogue] of TRANSLATIONS) {
    test(`${name} carries exactly the English keys`, () => {
      expect(Object.keys(catalogue).sort()).toEqual(Object.keys(en).sort());
    });

    test(`${name} keeps the placeholders of every source message`, () => {
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect([key, placeholders(catalogue[key] ?? "")]).toEqual([key, placeholders(en[key])]);
      }
    });

    test(`${name} has no empty message`, () => {
      for (const [key, value] of Object.entries(catalogue)) {
        expect([key, value.trim().length > 0]).toEqual([key, true]);
      }
    });
  }
});

describe("t", () => {
  test("follows the language", () => {
    expect(t("action.back")).toBe("Back");
    lang.value = "fr";
    expect(t("action.back")).toBe("Retour");
    lang.value = "de";
    expect(t("action.back")).toBe("Zurück");
  });

  test("fills placeholders and leaves unknown ones alone", () => {
    expect(t("unit.min", { n: 8 })).toBe("8 min");
    expect(t("unit.min")).toBe("{n} min");
  });
});

describe("plural", () => {
  test("English and German: one only for 1; French: 0 and 1", () => {
    expect(plural(0, "dir.transfers.one", "dir.transfers.other")).toBe("0 changes");
    expect(plural(1, "dir.transfers.one", "dir.transfers.other")).toBe("1 change");
    lang.value = "fr";
    expect(plural(0, "dir.transfers.one", "dir.transfers.other")).toBe("0 correspondance");
    expect(plural(2, "dir.transfers.one", "dir.transfers.other")).toBe("2 correspondances");
    lang.value = "de";
    expect(plural(0, "dir.transfers.one", "dir.transfers.other")).toBe("0 Umstiege");
    expect(plural(1, "dir.transfers.one", "dir.transfers.other")).toBe("1 Umstieg");
  });
});

describe("formats", () => {
  test("detectLang takes the first language ways speaks", () => {
    expect(detectLang(["it-IT", "de-AT", "fr", "en"])).toBe("de");
    expect(detectLang(["es", "fr-CA"])).toBe("fr");
    expect(detectLang(["ja", "es"])).toBe("en");
  });

  test("distances", () => {
    expect(formatDistance(4)).toBe("10 m");
    expect(formatDistance(348)).toBe("350 m");
    expect(formatDistance(1234)).toBe("1.2 km");
    lang.value = "fr";
    expect(formatDistance(1234)).toBe("1,2 km");
    lang.value = "de";
    expect(formatDistance(1234)).toBe("1,2 km");
  });

  test("durations", () => {
    expect(formatDuration(20)).toBe("1 min");
    expect(formatDuration(8 * 60)).toBe("8 min");
    expect(formatDuration(65 * 60)).toBe("1 h 05");
    lang.value = "de";
    expect(formatDuration(65 * 60)).toBe("1 Std. 05");
  });

  test("minutesUntil rounds to whole minutes", () => {
    expect(minutesUntil(1000 + 4 * 60000, 1000)).toBe(4);
    expect(minutesUntil(0, 90000)).toBe(-1);
  });
});
