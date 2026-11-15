import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { Router, StopsIndex, Timetable } from "minotor";
import { lang } from "../src/i18n";
import { decodeGraph, indexGraph } from "../src/local/graph";
import { parseRegion, regionFor } from "../src/local/packs";
import { pareto, plan, type RegionData, stopsNear } from "../src/local/plan";
import { fromServiceTime, toServiceTime } from "../src/local/time";
import type { PlanRequest } from "../src/providers/types";
import type { Published } from "./build";
import { buildFixture, PLACES, TESTVILLE } from "./fixture";

/** A Tuesday at 08:00 in Testville. */
const NOW = fromServiceTime("2026-11-17", 8 * 60, "Europe/Paris");
let dir = "";
let info: Published;
let data: RegionData;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ways-plan-test-"));
  info = await buildFixture(dir, NOW);
  const read = async (file: string) => gunzipSync(await readFile(join(dir, "testville", file)));
  const graph = decodeGraph(new Uint8Array(await read("streets.bin.gz")));
  const stops = StopsIndex.fromData(new Uint8Array(await read("stops.bin.gz")));
  const routers = new Map<string, Router>();
  for (const day of info.days) {
    const bytes = new Uint8Array(await read(`timetable-${day}.bin.gz`));
    routers.set(day, new Router(Timetable.fromData(bytes), stops));
  }
  data = {
    timezone: info.timezone,
    graph,
    index: indexGraph(graph),
    stops,
    lines: JSON.parse(await readFile(join(dir, "testville", "lines.json"), "utf8")),
    router: (date) => routers.get(date) ?? null,
  };
});

afterAll(async () => {
  lang.value = "en";
  await rm(dir, { recursive: true, force: true });
});

const req = (over: Partial<PlanRequest> = {}): PlanRequest => ({
  from: PLACES.gare,
  to: PLACES.plage,
  mode: "transit",
  ...over,
});
const clock = (ms: number) => toServiceTime(ms, "Europe/Paris").minutes;

describe("the region files", () => {
  test("describe themselves the way the app expects", () => {
    expect(parseRegion(info)).toMatchObject({ id: "testville", timezone: "Europe/Paris" });
    expect(info.days).toHaveLength(3);
    expect(info.days[0]).toBe("2026-11-17");
    expect(info.files).toContain("streets.bin.gz");
    expect(info.files).toContain("timetable-2026-11-17.bin.gz");
    expect(info.sources.map((s) => s.name)).toContain("OpenStreetMap contributors");
  });

  test("cover a trip inside their box, and no other", () => {
    expect(regionFor(req(), [info])?.id).toBe("testville");
    expect(regionFor(req({ to: { lat: 48.5, lng: -1, name: "far" } }), [info])).toBeNull();
    expect(TESTVILLE.bbox).toEqual(info.bbox);
  });
});

describe("a feed that no longer runs", () => {
  test("is not built: its timetables would be empty", async () => {
    const out = await mkdtemp(join(tmpdir(), "ways-expired-"));
    try {
      const lastYear = NOW - 400 * 24 * 3600 * 1000;
      await expect(buildFixture(out, NOW, lastYear)).rejects.toThrow(
        "no service in the coming days",
      );
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});

describe("planTransit", () => {
  test("bus, then tram, with the change at Mairie", () => {
    const [first] = plan(data, req(), NOW);
    const rides = first?.legs.filter((l) => l.kind === "transit") ?? [];
    expect(rides.map((l) => [l.line?.name, l.vehicle, l.from.name, l.to.name])).toEqual([
      ["1", "bus", "Gare", "Mairie"],
      ["T", "tram", "Mairie", "Plage"],
    ]);
    expect(first?.transfers).toBe(1);
    // 08:00 bus, at Mairie 08:06; 08:09 tram, at Plage 08:17.
    expect(clock(rides[0]?.start ?? 0)).toBe(8 * 60);
    expect(clock(rides[1]?.start ?? 0)).toBe(8 * 60 + 9);
    expect(clock(first?.end ?? 0)).toBe(8 * 60 + 17);
    expect(first?.origin.host).toBe("device");
  });

  test("lines carry the operator's colours, and nothing is called live", () => {
    const [first] = plan(data, req(), NOW);
    const bus = first?.legs.find((l) => l.line?.name === "1");
    expect(bus?.line).toEqual({ name: "1", color: "#004f9e", textColor: "#ffffff" });
    expect(first?.legs.every((l) => !l.realTime)).toBe(true);
  });

  test("offers the next departures too, earliest arrival first", () => {
    const list = plan(data, req(), NOW);
    expect(list.length).toBeGreaterThan(2);
    const ends = list.map((it) => it.end);
    expect(ends).toEqual([...ends].sort((a, b) => a - b));
    expect(clock(list[1]?.end ?? 0)).toBe(8 * 60 + 27);
  });

  test("a start away from the stop begins with the walk to it", () => {
    const from = { lat: 48.0, lng: -1.0214, name: "Home" };
    const [first] = plan(data, req({ from }), NOW);
    expect(first?.legs[0]?.kind).toBe("walk");
    expect(first?.legs[0]?.from.name).toBe("Home");
    expect(first?.legs[0]?.to.name).toBe("Gare");
    // About 105 m: two minutes, so the 08:00 bus is missed and the 08:10 taken.
    expect(clock(first?.legs[1]?.start ?? 0)).toBe(8 * 60 + 10);
    expect(first?.legs[0]?.end).toBeLessThanOrEqual(first?.legs[1]?.start ?? 0);
  });

  test("arrive by: the last trip that gets there in time", () => {
    const by = fromServiceTime("2026-11-17", 9 * 60, "Europe/Paris");
    const [first] = plan(data, req({ time: by, arriveBy: true }), NOW);
    expect(clock(first?.end ?? 0)).toBe(8 * 60 + 57);
    expect(first?.end).toBeLessThanOrEqual(by);
  });

  test("a day the region does not cover, or a place with no stop near, is no trip", () => {
    const later = fromServiceTime("2027-03-01", 8 * 60, "Europe/Paris");
    expect(plan(data, req({ time: later }), NOW)).toEqual([]);
    expect(plan(data, req({ to: { lat: 48.028, lng: -0.992, name: "Dunes" } }), NOW)).toEqual([]);
  });
});

describe("planStreet", () => {
  test("by bike, along the cycle track", () => {
    const [ride] = plan(data, req({ mode: "bike" }), NOW);
    const leg = ride?.legs[0];
    expect(ride?.legs).toHaveLength(1);
    expect(leg?.kind).toBe("bike");
    expect(leg?.steps[0]?.text).toBe("Start onto Voie verte");
    // About 2.7 km at 16 km/h.
    expect(leg?.distance).toBeGreaterThan(2600);
    expect(leg?.distance).toBeLessThan(2800);
    expect(Math.round((ride?.duration ?? 0) / 60)).toBe(10);
    expect(ride?.start).toBe(NOW);
  });

  test("on foot, slower, and the pace is the user's", () => {
    const [walk] = plan(data, req({ mode: "walk" }), NOW);
    const [slow] = plan(data, req({ mode: "walk", pace: "slow" }), NOW);
    expect(walk?.legs[0]?.kind).toBe("walk");
    expect((slow?.duration ?? 0) > (walk?.duration ?? 0)).toBe(true);
  });

  test("instructions follow the language", () => {
    lang.value = "fr";
    const [ride] = plan(data, req({ mode: "bike" }), NOW);
    expect(ride?.legs[0]?.steps[0]?.text).toBe("Pars sur Voie verte");
    lang.value = "en";
  });

  test("arrive by counts back from the time", () => {
    const by = NOW + 3600_000;
    const [ride] = plan(data, req({ mode: "bike", time: by, arriveBy: true }), NOW);
    expect(ride?.end).toBe(by);
  });

  test("far from any street, the straight line stands in", () => {
    const to = { lat: 48.5, lng: -1.5, name: "Elsewhere" };
    const [walk] = plan(data, req({ mode: "walk", to }), NOW);
    expect(walk?.legs[0]?.path).toHaveLength(2);
    expect(walk?.legs[0]?.steps).toEqual([]);
  });
});

describe("helpers", () => {
  test("stopsNear lists the stops in reach with the minutes to walk there", () => {
    const near = stopsNear(data.stops, { lat: 48.0, lng: -1.0214, name: "x" }, 1.42, 4);
    expect(near[0]?.stop.name).toBe("Gare");
    expect(near[0]?.minutes).toBe(2);
    expect(near.map((n) => n.stop.name)).not.toContain("Plage");
  });

  test("pareto drops a trip that leaves earlier and arrives later than another", () => {
    const a = { leave: 10, arrive: 30 };
    const b = { leave: 12, arrive: 28 };
    const c = { leave: 20, arrive: 40 };
    expect(pareto([a, b, c])).toEqual([b, c]);
    expect(pareto([a, { ...a }])).toHaveLength(1);
  });
});
