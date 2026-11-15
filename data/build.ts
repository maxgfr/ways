/**
 * Builds the regions the app can download and route on without a network:
 * for each entry of regions.json, a week of timetables and the stops (from the
 * operator's GTFS feed), the colours of the lines, and the street network
 * (from OpenStreetMap, through Overpass). The files land beside the site and
 * are published with it.
 *
 *   bun data/build.ts dist/packs
 *
 * A region that cannot be built today keeps the files already published, and
 * the street network is only asked of Overpass once a week: this script never
 * fails the deployment of the app, and is light on the services it reads.
 */
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { GtfsParser, StraightLineTransferGenerator, standardGtfsProfile } from "minotor/parser";
import { encodeGraph } from "../src/local/graph";
import type { RegionInfo } from "../src/local/packs";
import { addDays, toServiceTime } from "../src/local/time";
import { lineColours } from "./gtfs";
import { buildGraph, type OsmElement } from "./osm";
import regions from "./regions.json";

export interface RegionSpec {
  id: string;
  name: string;
  timezone: string;
  bbox: number[];
  gtfs: { name: string; licence: string; url: string; page: string };
}

/** What is published, with what only this script needs to know about it. */
export interface Published extends RegionInfo {
  streetsBuilt?: string;
}

const SITE = process.env.WAYS_SITE ?? "https://maxgfr.github.io/ways/";
const AGENT = "ways-data (https://github.com/maxgfr/ways)";
const DAYS = 7;
const STREETS_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
/** Ways that are never walked or ridden are left out of the answer. */
const SKIPPED =
  "motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway|bus_guideway|corridor|elevator|platform|rest_area|services|escape";

const log = (text: string): void => console.log(`[regions] ${text}`);

async function download(url: string, to: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": AGENT } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  await Bun.write(to, res);
}

async function previousIndex(): Promise<Published[]> {
  try {
    const res = await fetch(`${SITE}packs/index.json`, { headers: { "User-Agent": AGENT } });
    return res.ok ? ((await res.json()) as Published[]) : [];
  } catch {
    return [];
  }
}

/** Copies files already published for a region. Returns false when one is missing. */
async function reuse(id: string, files: string[], dir: string): Promise<boolean> {
  try {
    for (const file of files) await download(`${SITE}packs/${id}/${file}`, join(dir, file));
    return true;
  } catch {
    return false;
  }
}

async function streets(spec: RegionSpec): Promise<Uint8Array> {
  const [w, s, e, n] = spec.bbox;
  const query = `[out:json][timeout:180];way["highway"]["highway"!~"^(${SKIPPED})$"]["area"!="yes"](${s},${w},${n},${e});out body;>;out skel qt;`;
  let lastError: unknown;
  for (const endpoint of OVERPASS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "User-Agent": AGENT, "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
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

/**
 * Writes a region's files into `dir` from a GTFS feed on disk. `writeStreets`
 * puts streets.bin.gz there and says when that street network was built.
 */
export async function packRegion(
  spec: RegionSpec,
  dir: string,
  zip: string,
  now: number,
  writeStreets: (dir: string) => Promise<string>,
): Promise<Published> {
  const files: string[] = [];
  const put = async (name: string, bytes: Uint8Array | string): Promise<void> => {
    await writeFile(join(dir, name), bytes);
    files.push(name);
  };

  const parser = new GtfsParser(
    zip,
    standardGtfsProfile,
    new StraightLineTransferGenerator({ maxDistanceMeters: 300 }),
  );
  const stops = await parser.parseStops();
  await put("stops.bin.gz", gzipSync(stops.serialize()));
  await put("lines.json", JSON.stringify(lineColours(await unzipText(zip, "routes.txt"))));

  const today = toServiceTime(now, spec.timezone).date;
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
  files.push("streets.bin.gz");

  let bytes = 0;
  for (const file of files) bytes += (await stat(join(dir, file))).size;
  return {
    id: spec.id,
    name: spec.name,
    timezone: spec.timezone,
    bbox: spec.bbox as [number, number, number, number],
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
    streetsBuilt,
  };
}

/** A region from the network: the operator's feed, and the streets from Overpass or the last copy. */
async function buildRegion(
  spec: RegionSpec,
  dir: string,
  tmp: string,
  previous: Published | undefined,
): Promise<Published> {
  const now = Date.now();
  const zip = join(tmp, `${spec.id}.zip`);
  await download(spec.gtfs.url, zip);
  return packRegion(spec, dir, zip, now, async () => {
    // The streets change slowly: the published copy is kept for a week.
    const fresh =
      previous?.streetsBuilt !== undefined &&
      now - Date.parse(previous.streetsBuilt) < STREETS_MAX_AGE_MS;
    if (fresh && (await reuse(spec.id, ["streets.bin.gz"], dir))) {
      log(`${spec.id}: streets kept from ${previous.streetsBuilt}`);
      return previous.streetsBuilt as string;
    }
    try {
      await writeFile(join(dir, "streets.bin.gz"), gzipSync(await streets(spec)));
      return new Date(now).toISOString();
    } catch (err) {
      // Overpass is down: yesterday's streets are as good as today's.
      if (!previous || !(await reuse(spec.id, ["streets.bin.gz"], dir))) throw err;
      const built = previous.streetsBuilt ?? previous.built;
      log(`${spec.id}: Overpass did not answer, streets kept from ${built}`);
      return built;
    }
  });
}

export async function buildAll(outdir: string): Promise<Published[]> {
  await mkdir(outdir, { recursive: true });
  const tmp = await mkdtemp(join(tmpdir(), "ways-regions-"));
  const before = await previousIndex();
  const index: Published[] = [];
  try {
    for (const spec of regions as RegionSpec[]) {
      const dir = join(outdir, spec.id);
      const previous = before.find((r) => r.id === spec.id);
      await mkdir(dir, { recursive: true });
      try {
        index.push(await buildRegion(spec, dir, tmp, previous));
      } catch (err) {
        log(`${spec.id}: could not be built (${err instanceof Error ? err.message : err})`);
        await rm(dir, { recursive: true, force: true });
        await mkdir(dir, { recursive: true });
        if (previous && (await reuse(spec.id, previous.files, dir))) {
          index.push(previous);
          log(`${spec.id}: published files kept, built ${previous.built}`);
        } else {
          await rm(dir, { recursive: true, force: true });
          log(`${spec.id}: left out`);
        }
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  await writeFile(join(outdir, "index.json"), JSON.stringify(index));
  return index;
}

if (import.meta.main) {
  const outdir = resolve(process.argv[2] ?? "dist/packs");
  const index = await buildAll(outdir);
  for (const r of index) {
    log(`${r.id}: ${(r.bytes / 1024 / 1024).toFixed(1)} MiB in ${r.files.length} files`);
  }
  log(`${index.length} of ${regions.length} regions in ${outdir}`);
}
