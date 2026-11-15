/**
 * Regions: what the site offers to download, and what this browser holds. A
 * region is a handful of files built from open data (a week of timetables, the
 * stops, the street network), kept in the browser's cache storage so that
 * trips can be computed with no network at all.
 *
 * Downloading comes from this site itself, on the user's request, never from a
 * third party.
 */
import { signal } from "@preact/signals";
import type { PlanRequest } from "../providers/types";

export interface RegionSource {
  name: string;
  licence: string;
  url: string;
}

export interface RegionInfo {
  id: string;
  name: string;
  /** IANA time zone of the timetables. */
  timezone: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  /** When the files were built, as an ISO date and time. */
  built: string;
  /** The service days the timetables cover, as "YYYY-MM-DD". */
  days: string[];
  /** Download size of all the files, in bytes. */
  bytes: number;
  files: string[];
  sources: RegionSource[];
}

/** The cache the files live in. The service worker never clears it. */
export const PACKS_CACHE = "ways-packs";
const INSTALLED_KEY = "ways:regions";

/** Where the region files are served from: beside the page. */
export function packsBase(): string {
  return new URL("./packs/", document.baseURI).href;
}

export function fileUrl(base: string, region: string, file: string): string {
  return `${base}${region}/${file}`;
}

function isBox(v: unknown): v is [number, number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 4 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/** A region description, or null when a field is missing or of the wrong kind. */
export function parseRegion(raw: unknown): RegionInfo | null {
  const r = raw as Partial<RegionInfo> | null;
  if (!r || typeof r !== "object") return null;
  if (typeof r.id !== "string" || !/^[a-z0-9-]+$/.test(r.id)) return null;
  if (typeof r.name !== "string" || typeof r.timezone !== "string" || typeof r.built !== "string")
    return null;
  if (!isBox(r.bbox) || typeof r.bytes !== "number") return null;
  const strings = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((s) => typeof s === "string");
  if (!strings(r.days) || !strings(r.files)) return null;
  // A file name is a plain name: never a path that could reach outside the region's folder.
  if (!r.files.every((f) => /^[A-Za-z0-9._-]+$/.test(f))) return null;
  const sources = (Array.isArray(r.sources) ? r.sources : []).filter(
    (s): s is RegionSource =>
      !!s &&
      typeof s.name === "string" &&
      typeof s.licence === "string" &&
      typeof s.url === "string",
  );
  return {
    id: r.id,
    name: r.name,
    timezone: r.timezone,
    bbox: r.bbox,
    built: r.built,
    days: r.days,
    bytes: r.bytes,
    files: r.files,
    sources,
  };
}

export function parseRegions(raw: unknown): RegionInfo[] {
  return (Array.isArray(raw) ? raw : [])
    .map(parseRegion)
    .filter((r): r is RegionInfo => r !== null);
}

function readInstalled(): RegionInfo[] {
  try {
    return parseRegions(JSON.parse(localStorage.getItem(INSTALLED_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

/** The regions held in this browser. */
export const installed = signal<RegionInfo[]>(typeof window === "undefined" ? [] : readInstalled());

function writeInstalled(list: RegionInfo[]): void {
  installed.value = list;
  try {
    localStorage.setItem(INSTALLED_KEY, JSON.stringify(list));
  } catch {}
}

export function contains(region: Pick<RegionInfo, "bbox">, lat: number, lng: number): boolean {
  const [w, s, e, n] = region.bbox;
  return lng >= w && lng <= e && lat >= s && lat <= n;
}

/** The held region that covers both ends of a trip, if any. */
export function regionFor(
  req: Pick<PlanRequest, "from" | "to">,
  regions: RegionInfo[] = installed.value,
): RegionInfo | null {
  return (
    regions.find(
      (r) => contains(r, req.from.lat, req.from.lng) && contains(r, req.to.lat, req.to.lng),
    ) ?? null
  );
}

/** True when the timetables no longer reach the given day: the region should be updated. */
export function isStale(region: Pick<RegionInfo, "days">, today: string): boolean {
  const last = region.days[region.days.length - 1];
  return last === undefined || last < today;
}

/** The regions this site offers, read from its own files. */
export async function fetchCatalog(signal?: AbortSignal): Promise<RegionInfo[]> {
  const res = await fetch(`${packsBase()}index.json`, {
    cache: "no-cache",
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`regions: ${res.status}`);
  return parseRegions(await res.json());
}

/** Downloads a region's files into the browser, replacing an older copy of it. */
export async function install(
  region: RegionInfo,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  const base = packsBase();
  const cache = await caches.open(PACKS_CACHE);
  let done = 0;
  onProgress(0, region.files.length);
  for (const file of region.files) {
    const url = fileUrl(base, region.id, file);
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${file}: ${res.status}`);
    await cache.put(url, res);
    onProgress(++done, region.files.length);
  }
  // Files of the copy this one replaces, such as timetables for days now past.
  const prefix = fileUrl(base, region.id, "");
  const wanted = new Set(region.files.map((f) => fileUrl(base, region.id, f)));
  for (const request of await cache.keys()) {
    if (request.url.startsWith(prefix) && !wanted.has(request.url)) await cache.delete(request);
  }
  writeInstalled([...installed.value.filter((r) => r.id !== region.id), region]);
}

export async function remove(id: string): Promise<void> {
  const prefix = fileUrl(packsBase(), id, "");
  const cache = await caches.open(PACKS_CACHE);
  for (const request of await cache.keys()) {
    if (request.url.startsWith(prefix)) await cache.delete(request);
  }
  writeInstalled(installed.value.filter((r) => r.id !== id));
}
