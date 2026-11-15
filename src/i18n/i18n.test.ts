import { afterEach, describe, expect, test } from "bun:test";
import { en } from "./en";
import { fr } from "./fr";
import { detectLang, formatDistance, formatDuration, lang, minutesUntil, plural, t } from "./index";

afterEach(() => {
  lang.value = "en";
});

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
}

describe("catalogues", () => {
  test("French carries exactly the English keys", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  test("every translation keeps the placeholders of its source", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect([key, placeholders(fr[key])]).toEqual([key, placeholders(en[key])]);
    }
  });

  test("no message is empty", () => {
    for (const [key, value] of [...Object.entries(en), ...Object.entries(fr)]) {
      expect([key, value.trim().length > 0]).toEqual([key, true]);
    }
  });
});

describe("t", () => {
  test("follows the language", () => {
    expect(t("action.back")).toBe("Back");
    lang.value = "fr";
    expect(t("action.back")).toBe("Retour");
  });

  test("fills placeholders and leaves unknown ones alone", () => {
    expect(t("unit.min", { n: 8 })).toBe("8 min");
    expect(t("unit.min")).toBe("{n} min");
  });
});

describe("plural", () => {
  test("English: one only for 1; French: 0 and 1", () => {
    expect(plural(0, "dir.transfers.one", "dir.transfers.other")).toBe("0 changes");
    expect(plural(1, "dir.transfers.one", "dir.transfers.other")).toBe("1 change");
    lang.value = "fr";
    expect(plural(0, "dir.transfers.one", "dir.transfers.other")).toBe("0 correspondance");
    expect(plural(2, "dir.transfers.one", "dir.transfers.other")).toBe("2 correspondances");
  });
});

describe("formats", () => {
  test("detectLang takes the first language ways speaks", () => {
    expect(detectLang(["de-DE", "fr-CA", "en"])).toBe("fr");
    expect(detectLang(["de", "es"])).toBe("en");
  });

  test("distances", () => {
    expect(formatDistance(4)).toBe("10 m");
    expect(formatDistance(348)).toBe("350 m");
    expect(formatDistance(1234)).toBe("1.2 km");
    lang.value = "fr";
    expect(formatDistance(1234)).toBe("1,2 km");
  });

  test("durations", () => {
    expect(formatDuration(20)).toBe("1 min");
    expect(formatDuration(8 * 60)).toBe("8 min");
    expect(formatDuration(65 * 60)).toBe("1 h 05");
  });

  test("minutesUntil rounds to whole minutes", () => {
    expect(minutesUntil(1000 + 4 * 60000, 1000)).toBe(4);
    expect(minutesUntil(0, 90000)).toBe(-1);
  });
});
