import { describe, expect, test } from "bun:test";
import { chain, onlineRouters, planTrip, setDeviceLookup } from "./router";
import type { PlanRequest, Router } from "./types";

const req = (mode: PlanRequest["mode"]): PlanRequest => ({
  from: { lat: 0, lng: 0, name: "A" },
  to: { lat: 1, lng: 1, name: "B" },
  mode,
});
const device: Router = {
  origin: { name: "On device", host: "device" },
  modes: ["transit", "bike", "walk"],
  plan: async () => [],
};
const names = (routers: Router[]) => routers.map((r) => r.origin.name);

describe("onlineRouters", () => {
  test("transit goes to Transitous; bike and walk to Valhalla, then Transitous", () => {
    expect(names(onlineRouters("transit"))).toEqual(["Transitous"]);
    expect(names(onlineRouters("bike"))).toEqual(["Valhalla (FOSSGIS)", "Transitous"]);
    expect(names(onlineRouters("walk"))).toEqual(["Valhalla (FOSSGIS)", "Transitous"]);
    expect(names(onlineRouters("car"))).toEqual(["Valhalla (FOSSGIS)", "Transitous"]);
  });
});

describe("planTrip", () => {
  test("in local mode, a car trip says the device cannot drive", async () => {
    setDeviceLookup(() => device);
    const out = await planTrip(req("car"), "device");
    setDeviceLookup(() => null);
    expect(out).toEqual({ itineraries: [], failed: [], noRegion: false, noDeviceMode: true });
  });

  test("in local mode, a bike trip without a region says so", async () => {
    const out = await planTrip(req("bike"), "device");
    expect(out.noRegion).toBe(true);
    expect(out.noDeviceMode).toBe(false);
  });
});

describe("chain", () => {
  test("online never touches the device", () => {
    expect(names(chain("online", req("transit"), device))).toEqual(["Transitous"]);
  });

  test("device only asks the device, and nobody when no region covers the trip", () => {
    expect(names(chain("device", req("bike"), device))).toEqual(["On device"]);
    expect(chain("device", req("bike"), null)).toEqual([]);
  });

  test("auto asks the services first and keeps the device as the fallback", () => {
    expect(names(chain("auto", req("transit"), device))).toEqual(["Transitous", "On device"]);
    expect(names(chain("auto", req("transit"), null))).toEqual(["Transitous"]);
  });
});
