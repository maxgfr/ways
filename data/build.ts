/**
 * Builds the regions the app downloads to route without a network. Which
 * regions is not written down: they are discovered every night from the
 * Mobility Database (data/discover.ts), the biggest urban networks of the
 * world first. For each: the next days of timetables and the stops from the
 * operator's GTFS feed, the colours of its lines, and the street network of
 * its core from OpenStreetMap, through Overpass.
 *
 *   bun data/build.ts <outdir>
 *
 * The output is a site of its own (index.json and one folder per region),
 * published beside the app on the same origin. The nightly job is gentle with
 * the services it reads and never fails as a whole: a region that cannot be
 * built today keeps its published files, the street networks are rebuilt a few
 * per night in rotation, and the run stops starting new work when its time is
 * up.
 *
 * Settings, from the environment: WAYS_DATA_SITE (where the last run was
 * published), WAYS_REGIONS (how many), WAYS_MAX_FEED_MB, WAYS_STREETS_PER_RUN, WAYS_BUDGET_MIN.
 */
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { GtfsParser, StraightLineTransferGenerator, standardGtfsProfile } from "minotor/parser";
import { encodeGraph } from "../src/local/graph";
import type { RegionInfo } from "../src/local/packs";
import { addDays, toServiceTime } from "../src/local/time";
import { CATALOG_URL, type Candidate, candidates, choose, measure } from "./discover";
import { lineColours, parseCsv } from "./gtfs";
import { buildGraph, type OsmElement } from "./osm";

export interface RegionSpec {
  id: string;
  name: string;
  /** Read from the feed when not given. */
  timezone?: string;
  bbox: [number, number, number, number];
  gtfs: { name: string; licence: string; url: string; page: string };
}

/** What is published, with what only this script needs to know about it. */
export interface Published extends RegionInfo {
  streetsBuilt?: string;
}

const env = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const SITE = process.env.WAYS_DATA_SITE ?? "https://maxgfr.github.io/ways-data/";
const AGENT = "ways-data (https://github.com/maxgfr/ways)";
/** Days of timetables per region. Rebuilt every night, so a few are enough. */
const DAYS = 3;
const STREETS_MAX_AGE_MS = 28 * 24 * 3600 * 1000;
/**
 * A feed bigger than this is not downloaded, a region bigger than this is not published. The
 * biggest feeds take longer to read than a night allows; the online services cover those cities.
 */
const MAX_FEED_BYTES = env("WAYS_MAX_FEED_MB", 40) * 1024 * 1024;
const MAX_REGION_BYTES = 60 * 1024 * 1024;
/** The street network covers at most this many degrees around the centre of the network. */
const STREETS_HALF_SPAN = 0.08;
/** How long one download may take before it is given up for tonight. */
const FEED_TIMEOUT_MS = 5 * 60_000;
const OVERPASS_TIMEOUT_MS = 4 * 60_000;
const HEAD_TIMEOUT_MS = 20_000;
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
/** Ways that are never walked or ridden are left out of the answer. */
const SKIPPED =
  "motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway|bus_guideway|corridor|elevator|platform|rest_area|services|escape";

const log = (text: string): void => console.log(`[regions] ${text}`);

async function download(url: string, to: string): Promise<void> {
  const res = await fetch(url, {
    headers: { "User-Agent": AGENT },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  await Bun.write(to, res);
}

async function previousIndex(): Promise<Published[]> {
  try {
    const res = await fetch(`${SITE}index.json`, { headers: { "User-Agent": AGENT } });
    return res.ok ? ((await res.json()) as Published[]) : [];
  } catch {
    return [];
  }
}

/** Copies files already published for a region. Returns false when one is missing. */
async function reuse(id: string, files: string[], dir: string): Promise<boolean> {
  try {
    for (const file of files) await download(`${SITE}${id}/${file}`, join(dir, file));
    return true;
  } catch {
    return false;
  }
}

/** The part of a region whose streets are kept: its whole area, or its core when it is large. */
export function streetsBox(
  bbox: [number, number, number, number],
): [number, number, number, number] {
  const [w, s, e, n] = bbox;
  const x = (w + e) / 2;
  const y = (s + n) / 2;
  const half = STREETS_HALF_SPAN;
  const dx = half / Math.cos((y * Math.PI) / 180);
  return [Math.max(w, x - dx), Math.max(s, y - half), Math.min(e, x + dx), Math.min(n, y + half)];
}

async function streets(spec: RegionSpec): Promise<Uint8Array> {
  const [w, s, e, n] = streetsBox(spec.bbox);
  const query = `[out:json][timeout:180];way["highway"]["highway"!~"^(${SKIPPED})$"]["area"!="yes"](${s},${w},${n},${e});out body;>;out skel qt;`;
  let lastError: unknown;
  for (const endpoint of OVERPASS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "User-Agent": AGENT, "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`${endpoint}: ${res.status}`);
      const json = (await res.json()) as { elements?: OsmElement[] };
      const graph = buildGraph(json.elements ?? []);
      if (graph.nodeCount < 100) throw new Error(`${endpoint}: only ${graph.nodeCount} nodes`);
      log(`${spec.id}: streets, ${graph.nodeCount} nodes and ${graph.edgeCount} edges`);
      return encodeGraph(graph);
    } catch (err) {
      lastError = err;
      log(`${spec.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw lastError;
}

async function unzipText(zip: string, file: string): Promise<string> {
  const proc = Bun.spawn(["unzip", "-p", zip, file], { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`${file} not found in the feed`);
  return text;
}

/** The time zone of a feed: the one its first agency declares. */
export function feedTimezone(agencyTxt: string): string | null {
  const zone = parseCsv(agencyTxt)[0]?.agency_timezone;
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/**
 * Writes a region's files into `dir` from a GTFS feed on disk. `writeStreets`
 * puts streets.bin.gz there and says when that street network was built, or
 * returns null when the region goes without streets this time.
 */
export async function packRegion(
  spec: RegionSpec,
  dir: string,
  zip: string,
  now: number,
  writeStreets: (dir: string) => Promise<string | null>,
): Promise<Published> {
  const files: string[] = [];
  const put = async (name: string, bytes: Uint8Array | string): Promise<void> => {
    await writeFile(join(dir, name), bytes);
    files.push(name);
  };

  const timezone = spec.timezone ?? feedTimezone(await unzipText(zip, "agency.txt"));
  if (!timezone) throw new Error("the feed names no valid time zone");

  const parser = new GtfsParser(
    zip,
    standardGtfsProfile,
    new StraightLineTransferGenerator({ maxDistanceMeters: 300 }),
  );
  const stops = await parser.parseStops();
  await put("stops.bin.gz", gzipSync(stops.serialize()));
  await put("lines.json", JSON.stringify(lineColours(await unzipText(zip, "routes.txt"))));

  const today = toServiceTime(now, timezone).date;
  const days: string[] = [];
  for (let i = 0; i < DAYS; i++) {
    const date = addDays(today, i);
    const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
    // Noon UTC is the same calendar day wherever this script runs.
    const timetable = await parser.parseTimetable(new Date(Date.UTC(y, m - 1, d, 12)));
    await put(`timetable-${date}.bin.gz`, gzipSync(timetable.serialize()));
    days.push(date);
  }
  log(`${spec.id}: ${stops.size()} stops, timetables for ${days[0]} to ${days[days.length - 1]}`);

  const streetsBuilt = await writeStreets(dir);
  if (streetsBuilt) files.push("streets.bin.gz");

  let bytes = 0;
  for (const file of files) bytes += (await stat(join(dir, file))).size;
  return {
    id: spec.id,
    name: spec.name,
    timezone,
    bbox: spec.bbox,
    built: new Date(now).toISOString(),
    days,
    bytes,
    files,
    sources: [
      { name: spec.gtfs.name, licence: spec.gtfs.licence, url: spec.gtfs.page },
      {
        name: "OpenStreetMap contributors",
        licence: "ODbL",
        url: "https://www.openstreetmap.org/copyright",
      },
    ],
    ...(streetsBuilt ? { streetsBuilt } : {}),
  };
}

interface Budget {
  /** Street networks that may still be asked of Overpass in this run. */
  streets: number;
  deadline: number;
}

/** A region from the network: the operator's feed, and the streets kept, rebuilt or skipped. */
async function buildRegion(
  spec: RegionSpec,
  dir: string,
  tmp: string,
  previous: Published | undefined,
  budget: Budget,
): Promise<Published> {
  const now = Date.now();
  const zip = join(tmp, `${spec.id}.zip`);
  await download(spec.gtfs.url, zip);
  try {
    return await packRegion(spec, dir, zip, now, async () => {
      const had = previous?.files.includes("streets.bin.gz") ? previous.streetsBuilt : undefined;
      const fresh = had !== undefined && now - Date.parse(had) < STREETS_MAX_AGE_MS;
      if (had && (fresh || budget.streets <= 0) && (await reuse(spec.id, ["streets.bin.gz"], dir)))
        return had;
      if (budget.streets <= 0) return null;
      budget.streets--;
      try {
        await writeFile(join(dir, "streets.bin.gz"), gzipSync(await streets(spec)));
        return new Date(now).toISOString();
      } catch {
        // Overpass is busy: the last copy, or none until another night.
        if (had && (await reuse(spec.id, ["streets.bin.gz"], dir))) return had;
        return null;
      }
    });
  } finally {
    await rm(zip, { force: true });
  }
}

export async function buildAll(outdir: string, specs: RegionSpec[]): Promise<Published[]> {
  await mkdir(outdir, { recursive: true });
  const tmp = await mkdtemp(join(tmpdir(), "ways-regions-"));
  const before = await previousIndex();
  const budget: Budget = {
    streets: env("WAYS_STREETS_PER_RUN", 8),
    deadline: Date.now() + env("WAYS_BUDGET_MIN", 150) * 60_000,
  };
  const index: Published[] = [];
  try {
    for (const spec of specs) {
      const dir = join(outdir, spec.id);
      const previous = before.find((r) => r.id === spec.id);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      try {
        if (Date.now() > budget.deadline) throw new Error("out of time for this run");
        const built = await buildRegion(spec, dir, tmp, previous, budget);
        if (built.bytes > MAX_REGION_BYTES) throw new Error(`${built.bytes} bytes, too big`);
        index.push(built);
      } catch (err) {
        log(`${spec.id}: not built (${err instanceof Error ? err.message : err})`);
        await rm(dir, { recursive: true, force: true });
        await mkdir(dir, { recursive: true });
        if (previous && (await reuse(spec.id, previous.files, dir))) {
          index.push(previous);
          log(`${spec.id}: published files kept, built ${previous.built}`);
        } else {
          await rm(dir, { recursive: true, force: true });
        }
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  await writeFile(join(outdir, "index.json"), JSON.stringify(index));
  return index;
}

function toSpec(c: Candidate): RegionSpec {
  return {
    id: c.id,
    name: c.name,
    bbox: c.bbox,
    gtfs: { name: c.provider || c.name, licence: c.licence, url: c.url, page: c.page },
  };
}

/** The regions of this run: the biggest urban networks the catalogue lists. */
export async function discover(limit: number): Promise<RegionSpec[]> {
  const res = await fetch(CATALOG_URL, { headers: { "User-Agent": AGENT } });
  if (!res.ok) throw new Error(`${CATALOG_URL}: ${res.status}`);
  const list = await measure(candidates(await res.text()), async (url) => {
    const head = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": AGENT },
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    });
    const size = Number(head.headers.get("content-length"));
    return head.ok && size > 0 ? size : undefined;
  });
  const small = list.filter((c) => (c.bytes ?? 0) <= MAX_FEED_BYTES);
  log(`${list.length} urban feeds in the catalogue, ${small.length} small enough`);
  return choose(small, limit).map(toSpec);
}

if (import.meta.main) {
  const outdir = resolve(process.argv[2] ?? "dist/data");
  const specs = await discover(env("WAYS_REGIONS", 40));
  const index = await buildAll(outdir, specs);
  let total = 0;
  for (const r of index) total += r.bytes;
  log(
    `${index.length} of ${specs.length} regions, ${(total / 1024 / 1024).toFixed(0)} MiB, in ${outdir}`,
  );
}
