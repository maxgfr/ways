import { describe, expect, test } from "bun:test";
import {
  boundsOf,
  decodePolyline,
  distance,
  encodePolyline,
  pathLength,
  pointAlong,
} from "./polyline";

describe("polyline", () => {
  test("decodes Google's reference string at precision 5", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5)).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  test("round-trips at precision 6, negative coordinates included", () => {
    const path: [number, number][] = [
      [-1.68, 48.1113],
      [-1.680398, 48.114502],
      [-1.710943, 48.121296],
    ];
    expect(decodePolyline(encodePolyline(path, 6), 6)).toEqual(path);
  });

  test("an empty string is an empty path", () => {
    expect(decodePolyline("")).toEqual([]);
  });
});

describe("path geometry", () => {
  const line: [number, number][] = [
    [0, 0],
    [0, 1],
    [0, 2],
  ];

  test("distance: one degree of latitude is about 111 km", () => {
    expect(Math.round(distance([0, 0], [0, 1]) / 1000)).toBe(111);
  });

  test("pathLength adds the segments", () => {
    expect(pathLength(line)).toBeCloseTo(2 * distance([0, 0], [0, 1]), 3);
  });

  test("pointAlong: halfway is the middle point, heading north", () => {
    const mid = pointAlong(line, 0.5);
    expect(mid?.at[1]).toBeCloseTo(1, 6);
    expect(mid?.bearing).toBeCloseTo(0, 6);
  });

  test("pointAlong clamps and survives short paths", () => {
    expect(pointAlong(line, 4)?.at).toEqual([0, 2]);
    expect(pointAlong([[3, 4]], 0.5)?.at).toEqual([3, 4]);
    expect(pointAlong([], 0.5)).toBeNull();
  });

  test("boundsOf spans every path", () => {
    expect(boundsOf([line, [[-2, 5]]])).toEqual([-2, 0, 0, 5]);
    expect(boundsOf([[]])).toBeNull();
  });
});
