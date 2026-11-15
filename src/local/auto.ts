/**
 * Regions that download themselves. When the user opens a place, a stop or a
 * trip inside a region this site offers, or their position is inside one, the
 * region is fetched in the background, from this site only, so that trips
 * there keep working without a network. Regions already held are brought up
 * to date when their timetables run out or a newer build is published.
 *
 * Nothing is fetched on a connection the browser says should save data or is
 * very slow, and a setting turns all of it off.
 */
import { signal } from "@preact/signals";
import { contains, fetchCatalog, install, installed, isStale, type RegionInfo } from "./packs";
import { toServiceTime } from "./time";

/** What the browser says about the connection, where it says anything. */
export interface Connection {
  saveData?: boolean;
  effectiveType?: string;
}

/** True when a download of a few megabytes is reasonable on this connection. */
export function connectionAllows(c: Connection | undefined): boolean {
  if (!c) return true;
  if (c.saveData) return false;
  return c.effectiveType !== "slow-2g" && c.effectiveType !== "2g";
}

/** The offered region to download for a point: one that covers it and is missing or behind. */
export function regionToFetch(
  lat: number,
  lng: number,
  catalog: RegionInfo[],
  held: RegionInfo[],
  now: number,
): RegionInfo | null {
  for (const offered of catalog) {
    if (!contains(offered, lat, lng)) continue;
    const mine = held.find((r) => r.id === offered.id);
    if (!mine) return offered;
    return needsRefresh(offered, mine, now) ? offered : null;
  }
  return null;
}

/** A held copy is refreshed when a newer one exists and its timetables end within two days. */
function needsRefresh(offered: RegionInfo, mine: RegionInfo, now: number): boolean {
  if (offered.built <= mine.built) return false;
  return isStale(mine, toServiceTime(now + 2 * 24 * 3600 * 1000, offered.timezone).date);
}

/** Held regions to refresh now. */
export function regionsToRefresh(
  catalog: RegionInfo[],
  held: RegionInfo[],
  now: number,
): RegionInfo[] {
  return catalog.filter((offered) => {
    const mine = held.find((r) => r.id === offered.id);
    return mine !== undefined && needsRefresh(offered, mine, now);
  });
}

/** Region ids being downloaded right now, so the settings can show it. */
export const downloading = signal<ReadonlySet<string>>(new Set());

const CATALOG_MAX_AGE = 6 * 3600 * 1000;
let catalog: { at: number; list: Promise<RegionInfo[]> } | null = null;

function offered(): Promise<RegionInfo[]> {
  if (!catalog || Date.now() - catalog.at > CATALOG_MAX_AGE) {
    const list = fetchCatalog().catch(() => {
      catalog = null;
      return [] as RegionInfo[];
    });
    catalog = { at: Date.now(), list };
  }
  return catalog.list;
}

/** Downloads one region unless it is already on its way. Resolves true once it is held. */
export async function fetchRegion(region: RegionInfo): Promise<boolean> {
  if (downloading.value.has(region.id)) return false;
  downloading.value = new Set([...downloading.value, region.id]);
  try {
    await install(region, () => {});
    return true;
  } catch {
    return false;
  } finally {
    const next = new Set(downloading.value);
    next.delete(region.id);
    downloading.value = next;
  }
}

function connection(): Connection | undefined {
  return (navigator as Navigator & { connection?: Connection }).connection;
}

export interface AutoOptions {
  /** Called once a region was downloaded because of this point. */
  onFetched?: (region: RegionInfo, update: boolean) => void;
}

/** The user is interested in this point: fetch the region around it if there is one. */
export async function interestIn(lat: number, lng: number, opts: AutoOptions = {}): Promise<void> {
  if (!connectionAllows(connection())) return;
  const list = await offered();
  const region = regionToFetch(lat, lng, list, installed.value, Date.now());
  if (!region) return;
  const update = installed.value.some((r) => r.id === region.id);
  if (await fetchRegion(region)) opts.onFetched?.(region, update);
}

/** Brings the held regions up to date, at most once in a while. */
export async function refreshHeld(opts: AutoOptions = {}): Promise<void> {
  if (installed.value.length === 0 || !connectionAllows(connection())) return;
  const list = await offered();
  for (const region of regionsToRefresh(list, installed.value, Date.now())) {
    if (await fetchRegion(region)) opts.onFetched?.(region, true);
  }
}
