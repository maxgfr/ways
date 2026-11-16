/**
 * Search as you type: what the user kept (at once, no network), then stops
 * from Transitous and places from Photon, asked together a moment after the
 * typing pauses and cancelled when it resumes.
 */
import { useEffect, useState } from "preact/hooks";
import { search as searchPlaces } from "../geo/geocode";
import { distance } from "../geo/polyline";
import { searchRegionStops } from "../local/client";
import { installed } from "../local/packs";
import { searchStops, SERVICE as TRANSITOUS } from "../providers/motis";
import type { Point, Vehicle } from "../providers/types";
import { isAbort } from "../providers/types";
import { type Recent, recents, type Saved, saved } from "../store/store";
import { engine } from "./prefs";

export interface Hit {
  kind: "place" | "stop";
  /** Where the hit comes from, which decides its icon and its group. */
  source: "saved" | "recent" | "stop" | "place";
  point: Point;
  osm?: string;
  /** The line under the name: an address, a town. */
  meta: string;
  vehicles?: Vehicle[];
  /** A town, a city, a region: it keeps its rank among places of the same name. */
  area?: boolean;
  key: string;
}

export interface SearchState {
  hits: Hit[];
  /** True in local mode: only what the user kept is searched. */
  local: boolean;
  status: "idle" | "loading" | "error";
  /** Services that did not answer while others did. */
  failed: string[];
}

export const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;
/** A stop that only half matches is shown when it is this close, in metres. */
const NEAR_STOP_M = 50_000;

/** Lower case without accents, so "republique" finds "République". */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** The first part of a label is its name, the rest says where it is. */
export function labelParts(label: string): [name: string, rest: string] {
  const i = label.indexOf(", ");
  return i === -1 ? [label, ""] : [label.slice(0, i), label.slice(i + 2)];
}

function keptHit(source: "saved" | "recent", x: Saved | Recent): Hit {
  const [name, rest] = labelParts(x.point.name);
  return {
    kind: x.kind,
    source,
    point: { ...x.point, name },
    ...(x.osm ? { osm: x.osm } : {}),
    meta: rest,
    key: `${source}:${x.point.stopId ?? `${x.point.lat},${x.point.lng}`}`,
  };
}

/** What the user kept that matches every word typed; everything kept when nothing is typed. */
export function localHits(q: string, savedList: Saved[], recentList: Recent[], max = 5): Hit[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  const match = (p: Point) => {
    const hay = fold(p.name);
    return words.every((w) => hay.includes(w));
  };
  const out: Hit[] = [];
  const seen = new Set<string>();
  const push = (hit: Hit, p: Point) => {
    const id = p.stopId ?? `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
    if (seen.has(id) || out.length >= max) return;
    seen.add(id);
    out.push(hit);
  };
  for (const s of savedList) if (match(s.point)) push(keptHit("saved", s), s.point);
  for (const r of recentList) if (match(r.point)) push(keptHit("recent", r), r.point);
  return out;
}

/** The words that tell a result apart: three letters or more, numbers left out. */
function keyWords(q: string): string[] {
  return fold(q)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
}

/** The share of the typed words that start a word of `name`. */
export function matchShare(q: string, name: string): number {
  const words = keyWords(q);
  if (words.length === 0) return 0;
  const hay = fold(name).split(/[^\p{L}\p{N}]+/u);
  return words.filter((w) => hay.some((h) => h.startsWith(w))).length / words.length;
}

/**
 * Places of the same name nearest first, each name where it first came: many
 * towns have a "Rue de la Paix", and the user means the one around them. A
 * town or city keeps its rank: "Lyon" is the city before a Lyon street nearby.
 */
export function nearestFirstByName(places: Hit[], near: [number, number] | undefined): Hit[] {
  if (!near) return places;
  const groups = new Map<string, Hit[]>();
  for (const p of places) {
    const name = fold(p.point.name);
    const group = groups.get(name);
    if (group) group.push(p);
    else groups.set(name, [p]);
  }
  const away = (h: Hit) => distance(near, [h.point.lng, h.point.lat]);
  return [...groups.values()].flatMap((group) => {
    const areas = group.filter((h) => h.area);
    const rest = group.filter((h) => !h.area).sort((a, b) => away(a) - away(b));
    return [...areas, ...rest];
  });
}

/**
 * Places and stops in one list, the way a map search reads: a nearby stop
 * named after what was typed comes first; then the places, addresses
 * included, the nearest of a name first; then the stops that match most of
 * the words and are nearby, and last a few stops of that name far away. Stop
 * search is fuzzy and covers the world: without this, a street address drowned
 * under bus stops of similar names hundreds of kilometres away.
 */
export function rankRemote(
  q: string,
  stops: Hit[],
  places: Hit[],
  near: [number, number] | undefined,
): Hit[] {
  const address = /\d/.test(q);
  const strong: Hit[] = [];
  const weak: Hit[] = [];
  const far: Hit[] = [];
  for (const s of stops) {
    const share = matchShare(q, s.point.name);
    const close = !near || distance(near, [s.point.lng, s.point.lat]) <= NEAR_STOP_M;
    if (share === 1 && !address) (close ? strong : far).push(s);
    else if (share >= 2 / 3 && close) weak.push(s);
  }
  const seen = new Set<string>();
  const uniquePlaces = places.filter((p) => {
    const id = fold(`${p.point.name}|${p.meta}`);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const byDistance = (list: Hit[]) =>
    near
      ? [...list].sort(
          (a, b) =>
            distance(near, [a.point.lng, a.point.lat]) - distance(near, [b.point.lng, b.point.lat]),
        )
      : list;
  return [
    ...byDistance(strong),
    ...nearestFirstByName(uniquePlaces, near),
    ...weak.slice(0, 3),
    ...byDistance(far).slice(0, 2),
  ];
}

/** Within this distance of the map's centre, the user is taken to be looking around them. */
const AROUND_ME_M = 30_000;

/**
 * The point suggestions are looked for around, and their distances measured from: the user's
 * position when the map shows their surroundings or a whole country, otherwise the part of
 * the map in view (someone looking at another city wants that city).
 */
export function searchOrigin(
  center: [number, number],
  zoom: number,
  me: [number, number] | null,
): [number, number] {
  if (!me) return center;
  return zoom < 9 || distance(center, me) <= AROUND_ME_M ? me : center;
}

export function useSearch(q: string, near: [number, number], zoom: number): SearchState {
  const [remote, setRemote] = useState<Hit[]>([]);
  const [status, setStatus] = useState<SearchState["status"]>("idle");
  const [failed, setFailed] = useState<string[]>([]);
  const text = q.trim();
  const local = engine.value === "device";

  useEffect(() => {
    if (text.length < MIN_CHARS) {
      setRemote([]);
      setFailed([]);
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    if (local) {
      // No service is asked: the stops of the regions on this device are searched instead.
      setFailed([]);
      setStatus("idle");
      const regions = installed.value;
      if (regions.length === 0) {
        setRemote([]);
        return;
      }
      searchRegionStops(regions, text, controller.signal).then((stops) => {
        if (controller.signal.aborted) return;
        setRemote(
          stops.map((s) => ({
            kind: "stop" as const,
            source: "stop" as const,
            point: { lat: s.lat, lng: s.lng, name: s.name },
            meta: "",
            key: `region:${s.name}:${s.lat},${s.lng}`,
          })),
        );
      });
      return () => controller.abort();
    }
    setStatus("loading");
    const timer = setTimeout(async () => {
      const [stops, places] = await Promise.allSettled([
        searchStops(text, { near, signal: controller.signal }),
        searchPlaces(text, { near, zoom, signal: controller.signal, limit: 8 }),
      ]);
      if (controller.signal.aborted) return;
      if ([stops, places].some((r) => r.status === "rejected" && isAbort(r.reason))) return;
      const stopHits: Hit[] = [];
      const placeHits: Hit[] = [];
      if (stops.status === "fulfilled") {
        for (const s of stops.value) {
          stopHits.push({
            kind: "stop",
            source: "stop",
            point: { lat: s.lat, lng: s.lng, name: s.name, stopId: s.stopId },
            meta: s.area,
            vehicles: s.vehicles,
            key: `stop:${s.stopId}`,
          });
        }
      }
      if (places.status === "fulfilled") {
        for (const p of places.value) {
          placeHits.push({
            kind: "place",
            source: "place",
            point: { lat: p.lat, lng: p.lng, name: p.name },
            ...(p.osm ? { osm: p.osm } : {}),
            meta: p.address,
            ...(p.area ? { area: true } : {}),
            key: `place:${p.key}`,
          });
        }
      }
      const down = [
        ...(stops.status === "rejected" ? [TRANSITOUS] : []),
        ...(places.status === "rejected" ? ["Photon"] : []),
      ];
      setRemote(rankRemote(text, stopHits, placeHits, near));
      setFailed(down);
      setStatus(down.length === 2 ? "error" : "idle");
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // The map moving must not restart a search: `near` and `zoom` are read when the text changes.
  }, [text, local]);

  const kept = localHits(text, saved.value, recents.value);
  const known = new Set(
    kept.map((h) => h.point.stopId ?? `${h.point.lat.toFixed(5)},${h.point.lng.toFixed(5)}`),
  );
  const rest = remote.filter(
    (h) => !known.has(h.point.stopId ?? `${h.point.lat.toFixed(5)},${h.point.lng.toFixed(5)}`),
  );
  return { hits: [...kept, ...rest], local, status, failed };
}
