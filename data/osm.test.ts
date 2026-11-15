import { describe, expect, test } from "bun:test";
import {
  decodeGraph,
  encodeGraph,
  indexGraph,
  nearestNode,
  route,
  turnOf,
} from "../src/local/graph";
import { buildGraph, type OsmElement, wayUse } from "./osm";

describe("wayUse", () => {
  test("a residential street is for everyone, both ways", () => {
    expect(wayUse({ highway: "residential" })).toMatchObject({
      foot: true,
      bikeForward: true,
      bikeBackward: true,
      lane: false,
    });
  });

  test("a one-way street is one-way for bikes only, unless it says otherwise", () => {
    expect(wayUse({ highway: "residential", oneway: "yes" })).toMatchObject({
      foot: true,
      bikeForward: true,
      bikeBackward: false,
    });
    expect(wayUse({ highway: "residential", oneway: "-1" })).toMatchObject({
      bikeForward: false,
      bikeBackward: true,
    });
    expect(wayUse({ highway: "residential", oneway: "yes", "oneway:bicycle": "no" })).toMatchObject(
      { bikeBackward: true },
    );
    expect(
      wayUse({ highway: "residential", oneway: "yes", cycleway: "opposite_lane" }),
    ).toMatchObject({ bikeBackward: true, lane: true });
    expect(wayUse({ highway: "tertiary", junction: "roundabout" })).toMatchObject({
      bikeBackward: false,
    });
  });

  test("footways and stairs are walked, not ridden, unless bikes are allowed", () => {
    expect(wayUse({ highway: "footway" })).toMatchObject({ foot: true, bikeForward: false });
    expect(wayUse({ highway: "footway", bicycle: "yes" })).toMatchObject({ bikeForward: true });
    expect(wayUse({ highway: "steps", bicycle: "yes" })).toMatchObject({ bikeForward: false });
  });

  test("cycle tracks and lanes are marked", () => {
    expect(wayUse({ highway: "cycleway" })).toMatchObject({ lane: true, bikeForward: true });
    expect(wayUse({ highway: "secondary", "cycleway:right": "lane" })).toMatchObject({
      lane: true,
    });
    expect(wayUse({ highway: "secondary", cycleway: "no" })).toMatchObject({ lane: false });
  });

  test("what is closed, or not a street, is left out", () => {
    expect(wayUse({ highway: "residential", access: "private" })).toBeNull();
    expect(wayUse({ highway: "motorway" })).toBeNull();
    expect(wayUse({ highway: "pedestrian", area: "yes" })).toBeNull();
    expect(wayUse({ highway: "primary", foot: "no", bicycle: "no" })).toBeNull();
    expect(wayUse({})).toBeNull();
  });

  test("a private road open to walkers stays walkable", () => {
    expect(wayUse({ highway: "service", access: "private", foot: "yes" })).toMatchObject({
      foot: true,
      bikeForward: false,
    });
  });
});

/**
 * A made-up block of streets:
 *
 *   1 --A-- 2 --A-- 3        A: Rue A (residential)
 *           |       |        B: Rue B, one-way from 3 down to 6
 *           S       B        S: stairs between 2 and 5
 *           |       |        C: a cycle track along the bottom
 *   4 --C-- 5 --C-- 6
 *
 *   8 -- 9   an island, cut off from the rest
 */
const node = (id: number, lat: number, lon: number): OsmElement => ({ type: "node", id, lat, lon });
const BLOCK: OsmElement[] = [
  node(1, 48.002, -1.004),
  node(2, 48.002, -1.002),
  node(3, 48.002, -1.0),
  node(4, 48.0, -1.004),
  node(5, 48.0, -1.002),
  node(6, 48.0, -1.0),
  node(8, 48.1, -1.1),
  node(9, 48.1, -1.101),
  { type: "way", id: 10, nodes: [1, 2, 3], tags: { highway: "residential", name: "Rue A" } },
  {
    type: "way",
    id: 11,
    nodes: [3, 6],
    tags: { highway: "residential", name: "Rue B", oneway: "yes" },
  },
  { type: "way", id: 12, nodes: [2, 5], tags: { highway: "steps" } },
  {
    type: "way",
    id: 13,
    nodes: [4, 5, 6],
    tags: { highway: "cycleway", name: "Voie C", foot: "yes" },
  },
  { type: "way", id: 14, nodes: [8, 9], tags: { highway: "residential", name: "Island" } },
  { type: "way", id: 15, nodes: [1, 4], tags: { highway: "motorway" } },
  { type: "relation" },
];

describe("buildGraph", () => {
  const g = buildGraph(BLOCK);
  const index = indexGraph(g);
  const at = (lat: number, lng: number, mode: "walk" | "bike" = "walk") =>
    nearestNode(g, index, lat, lng, mode);

  test("keeps the connected streets and drops the island", () => {
    expect(g.nodeCount).toBe(6);
    expect(g.names).toEqual(["", "Rue A", "Rue B", "Voie C", "Island"]);
    // 6 stretches on foot, the stairs included, each in both directions.
    expect(g.edgeCount).toBe(12);
  });

  test("survives being written and read back", () => {
    const back = decodeGraph(encodeGraph(g));
    expect(back.nodeCount).toBe(g.nodeCount);
    expect([...back.to]).toEqual([...g.to]);
    expect([...back.flags]).toEqual([...g.flags]);
    expect([...back.lat]).toEqual([...g.lat]);
    expect(back.names).toEqual(g.names);
  });

  test("refuses a file that is not a street file", () => {
    expect(() => decodeGraph(new Uint8Array(40))).toThrow("not a ways street file");
    expect(() => decodeGraph(encodeGraph(g).slice(0, 60))).toThrow("cut short");
    expect(() => decodeGraph(new Uint8Array(3))).toThrow("too short");
  });

  test("on foot, the stairs are the short way down", () => {
    const r = route(g, at(48.002, -1.002), at(48.0, -1.002), "walk");
    expect(r?.path).toEqual([
      [-1.002, 48.002],
      [-1.002, 48.0],
    ]);
    expect(Math.round(r?.distance ?? 0)).toBe(222);
    expect(r?.manoeuvres[0]?.turn).toBe("depart");
  });

  test("step-free goes round the stairs", () => {
    const r = route(g, at(48.002, -1.002), at(48.0, -1.002), "walk", { stepFree: true });
    expect(r?.path).toHaveLength(4);
    expect(r?.manoeuvres.map((m) => [m.turn, m.street])).toEqual([
      ["depart", "Rue A"],
      ["right", "Rue B"],
      ["right", "Voie C"],
    ]);
  });

  test("by bike, a one-way street is not ridden against, and stairs are not ridden", () => {
    const down = route(g, at(48.002, -1.002, "bike"), at(48.0, -1.002, "bike"), "bike");
    expect(down?.path.map((p) => p[0])).toEqual([-1.002, -1.0, -1.0, -1.002]);
    expect(route(g, at(48.0, -1.002, "bike"), at(48.002, -1.002, "bike"), "bike")).toBeNull();
  });

  test("on foot the one-way street is walked both ways", () => {
    const up = route(g, at(48.0, -1.0), at(48.002, -1.0), "walk");
    expect(up?.path).toHaveLength(2);
  });

  test("a walk is slower than a ride over the same stretch", () => {
    const walk = route(g, at(48.0, -1.004), at(48.0, -1.0), "walk");
    const ride = route(g, at(48.0, -1.004, "bike"), at(48.0, -1.0, "bike"), "bike");
    expect(walk?.distance).toBeCloseTo(ride?.distance ?? 0, 3);
    expect((walk?.duration ?? 0) > (ride?.duration ?? 0) * 2).toBe(true);
  });

  test("nearestNode snaps to the closest node, and gives up far away", () => {
    expect(at(48.0021, -1.0041)).toBe(at(48.002, -1.004));
    expect(nearestNode(g, index, 49, 2, "walk")).toBe(-1);
  });

  test("a start that is the destination is a route of no length", () => {
    const n = at(48.002, -1.004);
    expect(route(g, n, n, "walk")).toMatchObject({ distance: 0, manoeuvres: [] });
    expect(route(g, -1, n, "walk")).toBeNull();
  });
});

describe("turnOf", () => {
  test("names a change of heading", () => {
    expect(turnOf(0)).toBe("continue");
    expect(turnOf(90)).toBe("right");
    expect(turnOf(-90)).toBe("left");
    expect(turnOf(40)).toBe("slightRight");
    expect(turnOf(-150)).toBe("hardLeft");
    expect(turnOf(180)).toBe("uturn");
    expect(turnOf(270)).toBe("left");
    expect(turnOf(-350)).toBe("continue");
  });
});
