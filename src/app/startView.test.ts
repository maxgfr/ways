import { describe, expect, test } from "bun:test";
import { viewForTimezone } from "./startView";

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
