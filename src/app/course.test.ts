import { describe, expect, test } from "bun:test";
import type { Itinerary, Leg } from "../providers/types";
import { courseOf, guide } from "./course";

const T0 = 1_700_000_000_000;

function leg(partial: Partial<Leg> & Pick<Leg, "kind" | "path">): Leg {
  const first = partial.path[0] ?? [0, 0];
  const last = partial.path[partial.path.length - 1] ?? first;
  return {
    vehicle: "foot",
    from: { name: "A", lat: first[1], lng: first[0] },
    to: { name: "B", lat: last[1], lng: last[0] },
    start: T0,
    end: T0 + 600_000,
    scheduledStart: T0,
    scheduledEnd: T0 + 600_000,
    duration: 600,
    realTime: false,
    cancelled: false,
    stops: [],
    steps: [],
    alerts: [],
    ...partial,
  };
}

function trip(legs: Leg[]): Itinerary {
  const first = legs[0] as Leg;
  const last = legs[legs.length - 1] as Leg;
  return {
    id: "t",
    start: first.start,
    end: last.end,
    duration: (last.end - first.start) / 1000,
    transfers: 0,
    legs,
    origin: { name: "Test", host: "test" },
  };
}

// A drive north for 222 m, then east for about 148 m: two instructions and an arrival.
const drive = trip([
  leg({
    kind: "car",
    vehicle: "car",
    duration: 60,
    end: T0 + 60_000,
    path: [
      [2, 48],
      [2, 48.002],
      [2.002, 48.002],
    ],
    to: { name: "Home", lat: 48.002, lng: 2.002 },
    steps: [
      { text: "Drive north.", distance: 222, turn: "depart" },
      { text: "Turn right onto Rue Haute.", distance: 148, turn: "right" },
      { text: "You have arrived.", distance: 0, turn: "arrive" },
    ],
  }),
]);

describe("guide, on the street", () => {
  test("at the start, the first instruction; then the turn ahead and its distance", () => {
    const course = courseOf(drive);
    const start = guide(course, [2, 48], T0);
    expect(start?.next).toMatchObject({ kind: "step", text: "Drive north.", turn: "depart" });
    expect(start?.remaining).toBeCloseTo(370, -1);

    const halfway = guide(course, [2, 48.001], T0 + 30_000, start?.along);
    expect(halfway?.next).toMatchObject({ text: "Turn right onto Rue Haute.", turn: "right" });
    expect(halfway?.toNext).toBeCloseTo(111, -1);
    expect(halfway?.nextId).toBe("0:1");
    expect(halfway?.arrived).toBe(false);
    // Time left at the leg's own pace: 70 % of 60 s, give or take.
    expect(halfway ? (halfway.eta - (T0 + 30_000)) / 1000 : 0).toBeCloseTo(42, -1);
  });

  test("near the destination, arrived", () => {
    const course = courseOf(drive);
    expect(guide(course, [2.00199, 48.002], T0)?.arrived).toBe(true);
  });

  test("off the route, the offset says by how much", () => {
    const course = courseOf(drive);
    expect(guide(course, [2.001, 48.001], T0)?.offset).toBeGreaterThan(60);
  });
});

describe("guide, with a ride", () => {
  const walk = leg({
    kind: "walk",
    path: [
      [2, 48],
      [2, 48.001],
    ],
    to: { name: "République", lat: 48.001, lng: 2 },
    duration: 120,
    end: T0 + 120_000,
  });
  const ride = leg({
    kind: "transit",
    vehicle: "subway",
    line: { name: "a" },
    headsign: "Kennedy",
    start: T0 + 300_000,
    end: T0 + 900_000,
    duration: 600,
    path: [
      [2, 48.001],
      [2, 48.011],
    ],
    from: { name: "République", lat: 48.001, lng: 2 },
    to: { name: "Kennedy", lat: 48.011, lng: 2 },
    stops: [
      { name: "Sainte-Anne", lat: 48.004, lng: 2 },
      { name: "Anatole France", lat: 48.008, lng: 2 },
    ],
  });
  const it = trip([walk, ride]);

  test("walking to the stop, the next thing is to board the line", () => {
    const g = guide(courseOf(it), [2, 48.0005], T0);
    expect(g?.next).toMatchObject({ kind: "board", stop: "République", headsign: "Kennedy" });
    expect(g?.toNext).toBeCloseTo(56, -1);
    // A ride is ahead: the arrival is the timetable's, not sooner.
    expect(g?.eta).toBe(T0 + 900_000);
  });

  test("at the stop before the departure, still board; on board, where to get off", () => {
    const course = courseOf(it);
    expect(guide(course, [2, 48.001], T0 + 200_000)?.next.kind).toBe("board");
    const riding = guide(course, [2, 48.005], T0 + 500_000);
    expect(riding?.next).toMatchObject({ kind: "ride", getOff: "Kennedy", stopsLeft: 2 });
  });
});
