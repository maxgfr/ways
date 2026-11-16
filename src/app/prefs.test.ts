import { describe, expect, test } from "bun:test";
import { cleanEndpoint, DEFAULT_LAYERS, DEFAULT_TRAVEL, parsePrefs } from "./prefs";

describe("parsePrefs", () => {
  test("nothing stored gives the defaults", () => {
    expect(parsePrefs(null)).toEqual({
      theme: "system",
      view: null,
      layers: DEFAULT_LAYERS,
      engine: "auto",
      endpoints: { motis: "", valhalla: "" },
      travel: DEFAULT_TRAVEL,
      autoRegions: true,
    });
  });

  test("automatic regions can be turned off", () => {
    expect(parsePrefs({ autoRegions: false }).autoRegions).toBe(false);
    expect(parsePrefs({ autoRegions: "no" }).autoRegions).toBe(true);
  });

  test("remembers how the user likes to travel", () => {
    const p = parsePrefs({
      travel: { mode: "bike", avoidHills: true, pace: "sprint", stepFree: 1 },
    });
    expect(p.travel).toEqual({
      mode: "bike",
      avoidHills: true,
      pace: "normal",
      stepFree: false,
      avoidTolls: false,
      avoidMotorways: false,
    });
  });

  test("remembers car trips and their roads to avoid", () => {
    const p = parsePrefs({ travel: { mode: "car", avoidTolls: true, avoidMotorways: "yes" } });
    expect(p.travel.mode).toBe("car");
    expect(p.travel.avoidTolls).toBe(true);
    expect(p.travel.avoidMotorways).toBe(false);
    expect(parsePrefs({ travel: { mode: "plane" } }).travel.mode).toBe("transit");
  });

  test("keeps what is valid and drops what is not", () => {
    const p = parsePrefs({
      theme: "dark",
      view: { lng: 2.35, lat: 48.86, zoom: "far" },
      layers: { cycling: true, vehicles: "yes" },
      engine: "device",
      endpoints: { motis: "https://motis.example.org/", valhalla: "javascript:alert(1)" },
    });
    expect(p.theme).toBe("dark");
    expect(p.view).toBeNull();
    expect(p.layers).toEqual({ ...DEFAULT_LAYERS, cycling: true });
    expect(p.engine).toBe("device");
    expect(p.endpoints).toEqual({ motis: "https://motis.example.org", valhalla: "" });
  });
});

describe("cleanEndpoint", () => {
  test("accepts http and https, trims trailing slashes", () => {
    expect(cleanEndpoint(" http://localhost:8080// ")).toBe("http://localhost:8080");
    expect(cleanEndpoint("https://a.example/api/")).toBe("https://a.example/api");
  });

  test("anything else is the default", () => {
    expect(cleanEndpoint("ftp://a.example")).toBe("");
    expect(cleanEndpoint("not a url")).toBe("");
    expect(cleanEndpoint(42)).toBe("");
  });
});
