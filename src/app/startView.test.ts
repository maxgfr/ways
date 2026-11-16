import { describe, expect, test } from "bun:test";
import { homeZone, startView, viewForTimezone } from "./startView";

describe("homeZone", () => {
  const winter = new Date("2026-01-15T12:00:00Z");

  test("a French browser on a Mac set to Berlin opens on Paris: same hour, one zone", () => {
    expect(homeZone("Europe/Berlin", "fr-FR", winter)).toBe("Europe/Paris");
    expect(homeZone("Europe/Berlin", "fr", winter)).toBe("Europe/Paris");
  });

  test("the device's zone stays when the language's country is on another hour", () => {
    expect(homeZone("Europe/Berlin", "en-GB", winter)).toBe("Europe/Berlin");
    expect(homeZone("Asia/Tokyo", "fr-FR", winter)).toBe("Asia/Tokyo");
  });

  test("the device's zone stays when the language's country has several zones", () => {
    expect(homeZone("Europe/Berlin", "en-US", winter)).toBe("Europe/Berlin");
    expect(homeZone("Europe/Paris", "de-DE", winter)).toBe("Europe/Paris");
  });

  test("without a device zone, the language's country is used", () => {
    expect(homeZone(undefined, "fr-FR", winter)).toBe("Europe/Paris");
    expect(homeZone(undefined, undefined, winter)).toBeUndefined();
  });
});

describe("startView", () => {
  test("reopens where the user last looked", () => {
    const last = { lng: 2.35, lat: 48.85, zoom: 14 };
    expect(startView(last, "Europe/Berlin")).toEqual(last);
  });

  test("a last view of a continent or more gives way to the user's city", () => {
    const world = { lng: 45.6, lat: 29, zoom: 2.4 };
    expect(startView(world, "Europe/Paris")).toEqual(viewForTimezone("Europe/Paris"));
    expect(startView(null, "Europe/Paris")).toEqual(viewForTimezone("Europe/Paris"));
  });
});

describe("viewForTimezone", () => {
  test("a listed zone opens on its city", () => {
    expect(viewForTimezone("Europe/Berlin")).toEqual({ lng: 13.405, lat: 52.52, zoom: 11 });
    expect(viewForTimezone("America/Montreal").lat).toBeCloseTo(45.5, 1);
  });

  test("an unlisted zone opens on its part of the world", () => {
    expect(viewForTimezone("Europe/Andorra")).toEqual({ lng: 10, lat: 50, zoom: 3.6 });
    expect(viewForTimezone("America/Boise").lng).toBe(-90);
  });

  test("no zone, or a strange one, opens on the world", () => {
    expect(viewForTimezone(undefined).zoom).toBe(1.6);
    expect(viewForTimezone("UTC").zoom).toBe(1.6);
    expect(viewForTimezone("Etc/GMT+3").zoom).toBe(1.6);
  });
});
