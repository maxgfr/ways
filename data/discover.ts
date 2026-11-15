/**
 * Which regions to build, decided from open catalogues rather than written by
 * hand. The Mobility Database lists the world's public transport feeds with
 * the area each covers and a keyless copy of the latest version. From it, the
 * urban networks are kept (an area a city spans, not a country), ranked by
 * the size of their feed (a fair stand-in for the size of the network), and
 * one network per city is chosen.
 */
import { parseCsv } from "./gtfs";

export const CATALOG_URL = "https://files.mobilitydatabase.org/feeds_v2.csv";

export interface Candidate {
  id: string;
  name: string;
  provider: string;
  country: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  url: string;
  licence: string;
  page: string;
  /** Size of the feed in bytes, once known. */
  bytes?: number;
}

export interface DiscoverOptions {
  /** Kept when the diagonal of their area is between these, in kilometres. */
  minKm: number;
  maxKm: number;
}

export const DEFAULTS: DiscoverOptions = { minKm: 4, maxKm: 90 };

/** The diagonal of a box, in kilometres. */
export function diagonalKm([w, s, e, n]: [number, number, number, number]): number {
  const dy = (n - s) * 111.2;
  const dx = (e - w) * 111.2 * Math.cos((((n + s) / 2) * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

const num = (v: string | undefined): number =>
  v === undefined || v === "" ? Number.NaN : Number(v);

/** The feeds of the catalogue that could make a region, in catalogue order. */
export function candidates(csv: string, opts: DiscoverOptions = DEFAULTS): Candidate[] {
  const out: Candidate[] = [];
  for (const r of parseCsv(csv)) {
    if (r.data_type !== "gtfs" || r["redirect.id"]) continue;
    if (r.status !== "active" && r.status !== "") continue;
    // Feeds behind a key or a login cannot be fetched by a nightly job.
    if (r["urls.authentication_type"] && r["urls.authentication_type"] !== "0") continue;
    const url = r["urls.latest"];
    const bbox: [number, number, number, number] = [
      num(r["location.bounding_box.minimum_longitude"]),
      num(r["location.bounding_box.minimum_latitude"]),
      num(r["location.bounding_box.maximum_longitude"]),
      num(r["location.bounding_box.maximum_latitude"]),
    ];
    if (!url || !r.id || !bbox.every(Number.isFinite)) continue;
    const km = diagonalKm(bbox);
    if (km < opts.minKm || km > opts.maxKm) continue;
    const provider = (r.provider ?? "").trim();
    // The catalogue's municipality is often the first town of the network in alphabetical order,
    // so an area is named by its network, and by its region to tell two networks apart.
    const region = (r["location.subdivision_name"] ?? "").trim();
    const town = (r["location.municipality"] ?? "").trim();
    out.push({
      id: r.id.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      name: !provider
        ? town || region
        : region && !provider.includes(region)
          ? `${provider} · ${region}`
          : provider,
      provider,
      country: r["location.country_code"] ?? "",
      bbox,
      url,
      licence: r["urls.license"] || "see the publisher",
      page: `https://mobilitydatabase.org/feeds/gtfs/${r.id}`,
    });
  }
  return out;
}

function centre(b: [number, number, number, number]): [number, number] {
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

function inside(p: [number, number], b: [number, number, number, number]): boolean {
  return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
}

/**
 * The biggest networks first, one per city: a feed whose centre lies inside a
 * network already chosen (a second operator of the same city) is left out.
 */
export function choose(list: Candidate[], limit: number): Candidate[] {
  const ranked = [...list].sort(
    (a, b) => (b.bytes ?? 0) - (a.bytes ?? 0) || a.id.localeCompare(b.id),
  );
  const chosen: Candidate[] = [];
  for (const c of ranked) {
    if (chosen.length >= limit) break;
    if (!c.bytes) continue;
    const mid = centre(c.bbox);
    if (chosen.some((k) => inside(mid, k.bbox) || inside(centre(k.bbox), c.bbox))) continue;
    chosen.push(c);
  }
  return chosen;
}

/** Asks the size of each feed, a few at a time. Feeds that do not answer stay without one. */
export async function measure(
  list: Candidate[],
  head: (url: string) => Promise<number | undefined>,
  parallel = 16,
): Promise<Candidate[]> {
  const queue = [...list];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      try {
        const bytes = await head(c.url);
        if (bytes !== undefined) c.bytes = bytes;
      } catch {}
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  return list;
}
