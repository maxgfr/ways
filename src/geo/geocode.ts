/**
 * Finding places: Photon (komoot's OpenStreetMap geocoder, made for search as
 * you type) for search and reverse lookups, and Nominatim as the fallback for
 * a reverse lookup and for a place's details, at most one request a second as
 * its policy asks. Both are
 * free and keyless; their fair-use rules are why searches are debounced by the
 * caller and cancelled when superseded.
 */
import { networkAllowed } from "../app/prefs";
import { lang } from "../i18n";

export interface GeoResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** OpenStreetMap's kind of place ("restaurant", "cafe", "museum"…). */
  kind?: string;
  /** The OpenStreetMap object behind the result ("N123", "W456", "R789"), to look up its details. */
  osm?: string;
  /** A unique key for lists. */
  key: string;
}

const PHOTON = "https://photon.komoot.io";
const NOMINATIM = "https://nominatim.openstreetmap.org";

interface PhotonProps {
  name?: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  city?: string;
  district?: string;
  locality?: string;
  state?: string;
  country?: string;
  osm_key?: string;
  osm_value?: string;
  osm_type?: string;
  osm_id?: number;
  type?: string;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: PhotonProps;
}

/** Photon answers in English, German, French and Italian; every language ways speaks is one. */
function photonLang(): string {
  return lang.value;
}

/** "20 Rue Alibert, 75010 Paris" from Photon's parts, without repeating the name. */
export function formatAddress(p: PhotonProps): string {
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const town = [p.postcode, p.city ?? p.district ?? p.locality].filter(Boolean).join(" ");
  const parts = [street, town];
  if (!street && !town) parts.push(p.state ?? "", p.country ?? "");
  else if (p.country && !town) parts.push(p.country);
  return parts.filter(Boolean).join(", ");
}

export function fromPhoton(f: PhotonFeature): GeoResult | null {
  const c = f.geometry?.coordinates;
  const p = f.properties ?? {};
  if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  const address = formatAddress(p);
  const name = p.name ?? ([p.housenumber, p.street].filter(Boolean).join(" ") || address);
  if (!name) return null;
  const kind =
    p.osm_key && p.osm_key !== "place" && p.osm_key !== "highway" ? p.osm_value : undefined;
  return {
    name,
    address: address === name ? "" : address,
    lng: c[0],
    lat: c[1],
    ...(kind ? { kind } : {}),
    ...(p.osm_type && p.osm_id ? { osm: `${p.osm_type}${p.osm_id}` } : {}),
    key: `${p.osm_type ?? ""}${p.osm_id ?? `${c[0]},${c[1]}`}`,
  };
}

/** Places matching `q`, nearest to `near` first when given. */
export async function search(
  q: string,
  opts: { near?: [number, number]; zoom?: number; signal?: AbortSignal; limit?: number } = {},
): Promise<GeoResult[]> {
  if (!networkAllowed()) return [];
  const url = new URL(`${PHOTON}/api/`);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(opts.limit ?? 8));
  url.searchParams.set("lang", photonLang());
  if (opts.near) {
    url.searchParams.set("lon", opts.near[0].toFixed(5));
    url.searchParams.set("lat", opts.near[1].toFixed(5));
    url.searchParams.set("zoom", String(Math.round(Math.min(18, Math.max(4, opts.zoom ?? 12)))));
  }
  const res = await fetch(url, opts.signal ? { signal: opts.signal } : {});
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const json = (await res.json()) as { features?: PhotonFeature[] };
  const seen = new Set<string>();
  const out: GeoResult[] = [];
  for (const f of json.features ?? []) {
    const r = fromPhoton(f);
    if (r && !seen.has(r.key)) {
      seen.add(r.key);
      out.push(r);
    }
  }
  return out;
}

let lastNominatim = 0;

async function nominatimReverse(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<GeoResult | null> {
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const url = new URL(`${NOMINATIM}/reverse`);
  url.searchParams.set("lat", lat.toFixed(6));
  url.searchParams.set("lon", lng.toFixed(6));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("zoom", "18");
  url.searchParams.set("accept-language", photonLang());
  // Nominatim asks to know which site sends the request; the page's own policy sends no referrer.
  const res = await fetch(url, { referrerPolicy: "origin", ...(signal ? { signal } : {}) });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    name?: string;
    display_name?: string;
    category?: string;
    type?: string;
    address?: Record<string, string>;
  };
  const a = j.address ?? {};
  const address = formatAddress({
    ...(a.house_number ? { housenumber: a.house_number } : {}),
    ...(a.road ? { street: a.road } : {}),
    ...(a.postcode ? { postcode: a.postcode } : {}),
    ...(a.city || a.town || a.village ? { city: a.city ?? a.town ?? a.village } : {}),
    ...(a.country ? { country: a.country } : {}),
  });
  const name = j.name || address || j.display_name || "";
  if (!name) return null;
  return {
    name,
    address: address === name ? "" : address,
    lat,
    lng,
    key: `nominatim:${lat},${lng}`,
  };
}

/** What OpenStreetMap says about a place beyond its name, when someone mapped it. */
export interface PlaceDetails {
  openingHours?: string;
  website?: string;
  phone?: string;
  wheelchair?: "yes" | "limited" | "no";
  cuisine?: string;
}

const detailsCache = new Map<string, PlaceDetails | null>();

function safeUrl(v: string | undefined): string | undefined {
  if (!v) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function toDetails(tags: Record<string, string>): PlaceDetails {
  const out: PlaceDetails = {};
  if (tags.opening_hours) out.openingHours = tags.opening_hours;
  const website = safeUrl(tags.website ?? tags["contact:website"]);
  if (website) out.website = website;
  const phone = tags.phone ?? tags["contact:phone"];
  if (phone) out.phone = phone;
  const w = tags.wheelchair;
  if (w === "yes" || w === "limited" || w === "no") out.wheelchair = w;
  if (tags.cuisine) out.cuisine = tags.cuisine.split(";").join(", ").replaceAll("_", " ");
  return out;
}

const found = new Map<string, string | null>();

/** Lower case without accents or punctuation, to compare two spellings of one name. */
function plain(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The OpenStreetMap object behind a named place at a point, for a place known
 * only by its name and position (one tapped on the map). Found by searching
 * the name next to the point and keeping a result of the same name within a
 * short walk. Asked once per place, and remembered.
 */
export async function findOsm(
  name: string,
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!name || !networkAllowed()) return null;
  const key = `${plain(name)}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
  if (found.has(key)) return found.get(key) ?? null;
  const results = await search(name, {
    near: [lng, lat],
    zoom: 18,
    limit: 5,
    ...(signal ? { signal } : {}),
  });
  const wanted = plain(name);
  const near = (r: GeoResult) =>
    Math.hypot((r.lat - lat) * 111_200, (r.lng - lng) * 111_200 * Math.cos((lat * Math.PI) / 180)) <
    120;
  const hit = results.find((r) => r.osm && near(r) && plain(r.name) === wanted);
  const osm = hit?.osm ?? null;
  found.set(key, osm);
  return osm;
}

/**
 * The details of one OpenStreetMap object ("N123", "W456", "R789"), from
 * Nominatim. Asked once per place, when its card opens, and remembered.
 */
export async function details(osm: string, signal?: AbortSignal): Promise<PlaceDetails | null> {
  if (!/^[NWR]\d+$/.test(osm) || !networkAllowed()) return null;
  if (detailsCache.has(osm)) return detailsCache.get(osm) ?? null;
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const url = new URL(`${NOMINATIM}/lookup`);
  url.searchParams.set("osm_ids", osm);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("extratags", "1");
  const res = await fetch(url, { referrerPolicy: "origin", ...(signal ? { signal } : {}) });
  if (!res.ok) return null;
  const json = (await res.json()) as { extratags?: Record<string, string> | null }[];
  const found = json[0] ? toDetails(json[0].extratags ?? {}) : null;
  detailsCache.set(osm, found);
  return found;
}

/** What is at a point: the nearest named place or address, or null. */
export async function reverse(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<GeoResult | null> {
  if (!networkAllowed()) return null;
  try {
    const url = new URL(`${PHOTON}/reverse`);
    url.searchParams.set("lat", lat.toFixed(6));
    url.searchParams.set("lon", lng.toFixed(6));
    url.searchParams.set("lang", photonLang());
    url.searchParams.set("limit", "1");
    const res = await fetch(url, signal ? { signal } : {});
    if (res.ok) {
      const json = (await res.json()) as { features?: PhotonFeature[] };
      const f = json.features?.[0];
      const r = f ? fromPhoton(f) : null;
      if (r) return { ...r, lat, lng };
    }
  } catch (err) {
    if (signal?.aborted) throw err;
  }
  return nominatimReverse(lat, lng, signal);
}
