import { describe, expect, test } from "bun:test";
import { fakeValhalla } from "./fixtures";
import type { PlanRequest } from "./types";
import { climb, costingOptions, toItinerary } from "./valhalla";

const origin = { name: "Valhalla (FOSSGIS)", host: "valhalla1.openstreetmap.de" };
const req: PlanRequest = {
  from: { lat: 48.1032, lng: -1.6727, name: "Gare" },
  to: { lat: 48.1214, lng: -1.711, name: "Kennedy" },
  mode: "bike",
};
const NOW = 1_000_000_000_000;

describe("climb", () => {
  test("adds the rises and the falls, ignoring wobbles under a metre", () => {
    expect(climb([30, 31, 36, 35.6, 41, 38, 30])).toEqual({ ascent: 11, descent: 11 });
  });

  test("flat or empty is no climb", () => {
    expect(climb([12, 12.4, 12])).toEqual({ ascent: 0, descent: 0 });
    expect(climb([])).toEqual({ ascent: 0, descent: 0 });
  });
});

describe("toItinerary", () => {
  test("one leg by bike, leaving now", () => {
    const it = toItinerary(fakeValhalla.trip, req, origin, 0, NOW);
    const leg = it?.legs[0];
    expect(it?.duration).toBe(912);
    expect(it?.start).toBe(NOW);
    expect(it?.end).toBe(NOW + 912_000);
    expect(leg?.kind).toBe("bike");
    expect(leg?.distance).toBe(4410);
    expect(leg?.from.name).toBe("Gare");
    expect(leg?.to.name).toBe("Kennedy");
    expect(leg?.path).toEqual([
      [-1.6727, 48.1032],
      [-1.711, 48.1214],
    ]);
    expect(leg?.steps).toEqual([
      { text: "Bike north on Rue de l'Alma.", distance: 300, turn: "depart" },
      { text: "Turn left onto Boulevard de la Liberté.", distance: 4110, turn: "left" },
    ]);
    expect(leg?.ascent).toBe(11);
    expect(leg?.elevation).toHaveLength(7);
  });

  test("arriving by a time counts back from it", () => {
    const it = toItinerary(fakeValhalla.trip, { ...req, time: NOW, arriveBy: true }, origin, 0, 0);
    expect(it?.end).toBe(NOW);
    expect(it?.start).toBe(NOW - 912_000);
  });

  test("on foot, and without terrain", () => {
    const alt = fakeValhalla.alternates[0]?.trip;
    const it = alt ? toItinerary(alt, { ...req, mode: "walk" }, origin, 1, NOW) : null;
    expect(it?.legs[0]?.kind).toBe("walk");
    expect(it?.legs[0]?.ascent).toBeUndefined();
    expect(it?.id).toBe("valhalla1.openstreetmap.de:walk:1");
  });

  test("by car, one drive leg", () => {
    const it = toItinerary(fakeValhalla.trip, { ...req, mode: "car" }, origin, 0, NOW);
    expect(it?.legs[0]?.kind).toBe("car");
    expect(it?.legs[0]?.vehicle).toBe("car");
    expect(it?.id).toBe("valhalla1.openstreetmap.de:car:0");
  });

  test("an answer without a route is nothing", () => {
    expect(toItinerary({}, req, origin, 0, NOW)).toBeNull();
    expect(toItinerary({ summary: { time: 10 }, legs: [] }, req, origin, 0, NOW)).toBeNull();
  });
});

describe("costingOptions", () => {
  test("by bike, avoiding hills lowers the appetite for them", () => {
    expect(costingOptions(req)).toEqual({ use_hills: 0.5 });
    expect(costingOptions({ ...req, avoidHills: true })).toEqual({ use_hills: 0.1 });
  });

  test("by car, tolls and motorways can be avoided", () => {
    const car: PlanRequest = { ...req, mode: "car" };
    expect(costingOptions(car)).toEqual({});
    expect(costingOptions({ ...car, avoidTolls: true, avoidMotorways: true })).toEqual({
      use_tolls: 0,
      use_highways: 0,
    });
  });

  test("on foot, pace and step-free", () => {
    expect(costingOptions({ ...req, mode: "walk", pace: "slow" })).toEqual({ walking_speed: 3.6 });
    expect(costingOptions({ ...req, mode: "walk", stepFree: true })).toMatchObject({
      walking_speed: 5.1,
      step_penalty: 600,
    });
  });
});
