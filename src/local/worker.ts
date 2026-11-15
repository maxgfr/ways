/**
 * The worker that computes trips on the device. It reads a region's files from
 * the browser's cache storage, keeps them in memory, and answers the page's
 * questions. It never calls the network: a file that is not in the cache is an
 * error, not a download.
 */
import { Router, StopsIndex, Timetable } from "minotor";
import { type Lang, lang } from "../i18n";
import type { Itinerary, PlanRequest } from "../providers/types";
import { decodeGraph, emptyGraph, indexGraph } from "./graph";
import { fileUrl, PACKS_CACHE, type RegionInfo } from "./packs";
import { type LineColours, plan, type RegionData } from "./plan";

export type Ask =
  | { n: number; type: "plan"; base: string; region: RegionInfo; req: PlanRequest; lang: Lang }
  | { n: number; type: "stops"; base: string; region: RegionInfo; text: string };

export interface FoundStop {
  name: string;
  lat: number;
  lng: number;
}

export type Answer =
  | { n: number; ok: true; itineraries?: Itinerary[]; stops?: FoundStop[] }
  | { n: number; ok: false; error: string };

async function read(url: string): Promise<Response> {
  const cache = await caches.open(PACKS_CACHE);
  const hit = await cache.match(url);
  if (!hit) throw new Error(`missing ${url}`);
  return hit;
}

async function unzipped(url: string): Promise<Uint8Array> {
  const res = await read(url);
  if (!res.body) throw new Error(`empty ${url}`);
  const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface Loaded {
  built: string;
  data: RegionData;
}

const regions = new Map<string, Promise<Loaded>>();

async function load(base: string, region: RegionInfo): Promise<Loaded> {
  const url = (file: string) => fileUrl(base, region.id, file);
  // A region may come without its streets for a while: walks are then estimated in a straight line.
  const hasStreets = region.files.includes("streets.bin.gz");
  const [streets, stopsBytes, lines] = await Promise.all([
    hasStreets ? unzipped(url("streets.bin.gz")) : Promise.resolve(null),
    unzipped(url("stops.bin.gz")),
    read(url("lines.json")).then((r) => r.json() as Promise<Record<string, LineColours>>),
  ]);
  const graph = streets ? decodeGraph(streets) : emptyGraph();
  const stops = StopsIndex.fromData(stopsBytes);
  // Timetables are read when a day is first asked for, then kept.
  const routers = new Map<string, Router | null>();
  const pending = new Map<string, Promise<void>>();
  const prepare = (date: string): Promise<void> => {
    let p = pending.get(date);
    if (!p) {
      p = region.days.includes(date)
        ? unzipped(url(`timetable-${date}.bin.gz`))
            .then((bytes) => {
              routers.set(date, new Router(Timetable.fromData(bytes), stops));
            })
            .catch(() => {
              routers.set(date, null);
            })
        : Promise.resolve().then(() => {
            routers.set(date, null);
          });
      pending.set(date, p);
    }
    return p;
  };
  await Promise.all(region.days.map(prepare));
  return {
    built: region.built,
    data: {
      timezone: region.timezone,
      graph,
      index: indexGraph(graph),
      stops,
      lines,
      router: (date) => routers.get(date) ?? null,
    },
  };
}

async function dataFor(base: string, region: RegionInfo): Promise<RegionData> {
  let loading = regions.get(region.id);
  // An updated region replaces the copy in memory.
  if (loading && (await loading.catch(() => null))?.built !== region.built) loading = undefined;
  if (!loading) {
    loading = load(base, region);
    regions.set(region.id, loading);
    loading.catch(() => regions.delete(region.id));
  }
  return (await loading).data;
}

async function answer(ask: Ask): Promise<Answer> {
  const data = await dataFor(ask.base, ask.region);
  if (ask.type === "plan") {
    lang.value = ask.lang;
    return { n: ask.n, ok: true, itineraries: plan(data, ask.req, Date.now()) };
  }
  const seen = new Set<string>();
  const stops: FoundStop[] = [];
  for (const s of data.stops.findStopsByName(ask.text, 12)) {
    if (s.lat === undefined || s.lon === undefined || seen.has(s.name)) continue;
    seen.add(s.name);
    stops.push({ name: s.name, lat: s.lat, lng: s.lon });
    if (stops.length === 5) break;
  }
  return { n: ask.n, ok: true, stops };
}

self.addEventListener("message", (e: MessageEvent<Ask>) => {
  const ask = e.data;
  answer(ask)
    .catch(
      (err): Answer => ({
        n: ask.n,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    .then((reply) => self.postMessage(reply));
});
