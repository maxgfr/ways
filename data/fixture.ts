/**
 * Testville: a made-up town with two lines and a dozen streets, built through
 * the same steps as a real region. The tests route on it, in the browser and
 * out of it, without any network. None of it is real data.
 *
 *   Plage ●  (48.020, -1.000)        line T (tram): Mairie → Parc → Plage
 *         │ ╲                        line 1 (bus):  Gare → Marché → Mairie
 *    Parc ●  ╲  Voie verte           both every 10 minutes, both ways;
 *         │   ╲ (cycle track)        the tram leaves Mairie 3 minutes after
 *  Mairie ●────●────● Gare           the bus from Gare gets there
 *            Marché   (48.000, -1.020)
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { encodeGraph } from "../src/local/graph";
import { addDays, toServiceTime } from "../src/local/time";
import { type Published, packRegion, type RegionSpec } from "./build";
import { buildGraph, type OsmElement } from "./osm";

export const TESTVILLE: RegionSpec = {
  id: "testville",
  name: "Testville",
  timezone: "Europe/Paris",
  bbox: [-1.03, 47.99, -0.99, 48.03],
  gtfs: {
    name: "Testville Transit (made up)",
    licence: "none",
    url: "",
    page: "https://example.org/",
  },
};

export const PLACES = {
  gare: { lat: 48.0, lng: -1.02, name: "Gare" },
  marche: { lat: 48.0, lng: -1.01, name: "Marché" },
  mairie: { lat: 48.0, lng: -1.0, name: "Mairie" },
  parc: { lat: 48.01, lng: -1.0, name: "Parc" },
  plage: { lat: 48.02, lng: -1.0, name: "Plage" },
} as const;

const node = (id: number, lat: number, lon: number): OsmElement => ({ type: "node", id, lat, lon });

export const STREETS: OsmElement[] = [
  node(1, 48.0, -1.02),
  node(2, 48.0, -1.01),
  node(3, 48.0, -1.0),
  node(4, 48.01, -1.0),
  node(5, 48.02, -1.0),
  node(6, 48.01, -1.01),
  { type: "way", id: 10, nodes: [1, 2, 3], tags: { highway: "residential", name: "Rue Longue" } },
  { type: "way", id: 11, nodes: [3, 4, 5], tags: { highway: "tertiary", name: "Avenue du Parc" } },
  {
    type: "way",
    id: 12,
    nodes: [1, 6, 5],
    tags: { highway: "cycleway", name: "Voie verte", foot: "yes" },
  },
];

const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`;

/** The feed's text files, valid from the day before `now` for a month. */
export function gtfsFiles(now: number): Record<string, string> {
  const today = toServiceTime(now, TESTVILLE.timezone).date;
  const compact = (d: string) => d.replaceAll("-", "");
  const stops = Object.entries(PLACES)
    .map(([id, p]) => `${id},${p.name},${p.lat},${p.lng}`)
    .join("\n");
  const trips: string[] = [];
  const times: string[] = [];
  const run = (route: string, dir: number, start: number, calls: [string, number][]): void => {
    const id = `${route}-${dir}-${start}`;
    trips.push(`${route},daily,${id},${dir}`);
    calls.forEach(([stop, offset], i) => {
      const at = hhmm(start + offset);
      times.push(`${id},${at},${at},${stop},${i + 1}`);
    });
  };
  for (let start = 5 * 60; start < 24 * 60; start += 10) {
    run("1", 0, start, [
      ["gare", 0],
      ["marche", 3],
      ["mairie", 6],
    ]);
    run("1", 1, start, [
      ["mairie", 0],
      ["marche", 3],
      ["gare", 6],
    ]);
    run("T", 0, start + 9, [
      ["mairie", 0],
      ["parc", 4],
      ["plage", 8],
    ]);
    run("T", 1, start + 1, [
      ["plage", 0],
      ["parc", 4],
      ["mairie", 8],
    ]);
  }
  return {
    "agency.txt":
      "agency_id,agency_name,agency_url,agency_timezone\ntt,Testville Transit,https://example.org,Europe/Paris\n",
    "stops.txt": `stop_id,stop_name,stop_lat,stop_lon\n${stops}\n`,
    "routes.txt":
      "route_id,agency_id,route_short_name,route_long_name,route_type,route_color,route_text_color\n" +
      "1,tt,1,Gare - Mairie,3,004f9e,ffffff\nT,tt,T,Mairie - Plage,0,ee1d23,ffffff\n",
    "calendar.txt":
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
      `daily,1,1,1,1,1,1,1,${compact(addDays(today, -1))},${compact(addDays(today, 30))}\n`,
    "trips.txt": `route_id,service_id,trip_id,direction_id\n${trips.join("\n")}\n`,
    "stop_times.txt": `trip_id,arrival_time,departure_time,stop_id,stop_sequence\n${times.join("\n")}\n`,
  };
}

/** Writes Testville's region files under `outdir/testville`, and the index beside them. */
export async function buildFixture(outdir: string, now = Date.now()): Promise<Published> {
  const tmp = await mkdtemp(join(tmpdir(), "ways-testville-"));
  try {
    const names: string[] = [];
    for (const [name, text] of Object.entries(gtfsFiles(now))) {
      await writeFile(join(tmp, name), text);
      names.push(name);
    }
    const zip = join(tmp, "feed.zip");
    const proc = Bun.spawn(["zip", "-j", "-q", zip, ...names.map((n) => join(tmp, n))], {
      stdout: "ignore",
      stderr: "inherit",
    });
    if ((await proc.exited) !== 0) throw new Error("zip failed");
    const dir = join(outdir, TESTVILLE.id);
    await mkdir(dir, { recursive: true });
    const info = await packRegion(TESTVILLE, dir, zip, now, async (to) => {
      await writeFile(join(to, "streets.bin.gz"), gzipSync(encodeGraph(buildGraph(STREETS))));
      return new Date(now).toISOString();
    });
    await writeFile(join(outdir, "index.json"), JSON.stringify([info]));
    return info;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const info = await buildFixture(process.argv[2] ?? "dist/packs");
  console.log(`testville: ${info.files.length} files, ${info.bytes} bytes`);
}
