import { describe, expect, test } from "bun:test";
import type { Path } from "./polyline";
import { bearingOf, snap } from "./progress";

// About 111 m per 0.001 degree of latitude; at 48° N a 0.001 degree of longitude is about 74 m.
const north: Path = [
  [2, 48],
  [2, 48.001],
  [2, 48.002],
];

describe("bearingOf", () => {
  test("north is 0, east 90, south 180, west 270", () => {
    expect(bearingOf([2, 48], [2, 48.001])).toBeCloseTo(0, 5);
    expect(bearingOf([2, 48], [2.001, 48])).toBeCloseTo(90, 5);
    expect(bearingOf([2, 48.001], [2, 48])).toBeCloseTo(180, 5);
    expect(bearingOf([2.001, 48], [2, 48])).toBeCloseTo(270, 5);
  });
});

describe("snap", () => {
  test("a position on the path is that far along it, and not off it", () => {
    const on = snap(north, [2, 48.0015]);
    expect(on?.along).toBeCloseTo(166.8, 0);
    expect(on?.offset).toBeLessThan(0.5);
    expect(on?.bearing).toBeCloseTo(0, 3);
  });

  test("a position beside the path is as far off it as it is", () => {
    const on = snap(north, [2.0004, 48.001]);
    expect(on?.along).toBeCloseTo(111.2, 0);
    expect(on?.offset).toBeCloseTo(29.8, 0);
  });

  test("before the start or past the end, it is the end nearest", () => {
    expect(snap(north, [2, 47.999])?.along).toBe(0);
    expect(snap(north, [2, 48.003])?.along).toBeCloseTo(222.4, 0);
  });

  test("on a street taken there and back, the pass nearest the last progress wins", () => {
    const outAndBack: Path = [
      [2, 48],
      [2, 48.001],
      [2.00001, 48],
    ];
    expect(snap(outAndBack, [2, 48.0002], 10)?.along).toBeLessThan(40);
    expect(snap(outAndBack, [2, 48.0002], 180)?.along).toBeGreaterThan(180);
  });

  test("an empty path has no answer; a point is where it is", () => {
    expect(snap([], [2, 48])).toBeNull();
    expect(snap([[2, 48]], [2, 48.001])?.offset).toBeCloseTo(111.2, 0);
  });
});
