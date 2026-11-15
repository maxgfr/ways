/**
 * Search as you type: what the user kept (at once, no network), then stops
 * from Transitous and places from Photon, asked together a moment after the
 * typing pauses and cancelled when it resumes.
 */
import { useEffect, useState } from "preact/hooks";
import { search as searchPlaces } from "../geo/geocode";
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

export const MIN_CHARS = 3;
const DEBOUNCE_MS = 320;

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

export function useSearch(q: string, near: [number, number], zoom: number): SearchState {
  const [remote, setRemote] = useState<Hit[]>([]);
  const [status, setStatus] = useState<SearchState["status"]>("idle");
  const [failed, setFailed] = useState<string[]>([]);
  const text = q.trim();
  const local = engine.value === "device";

  useEffect(() => {
    if (text.length < MIN_CHARS || local) {
      setRemote([]);
      setFailed([]);
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    const timer = setTimeout(async () => {
      const [stops, places] = await Promise.allSettled([
        searchStops(text, { near, signal: controller.signal }),
        searchPlaces(text, { near, zoom, signal: controller.signal, limit: 6 }),
      ]);
      if (controller.signal.aborted) return;
      if ([stops, places].some((r) => r.status === "rejected" && isAbort(r.reason))) return;
      const hits: Hit[] = [];
      if (stops.status === "fulfilled") {
        for (const s of stops.value) {
          hits.push({
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
          hits.push({
            kind: "place",
            source: "place",
            point: { lat: p.lat, lng: p.lng, name: p.name },
            ...(p.osm ? { osm: p.osm } : {}),
            meta: p.address,
            key: `place:${p.key}`,
          });
        }
      }
      const down = [
        ...(stops.status === "rejected" ? [TRANSITOUS] : []),
        ...(places.status === "rejected" ? ["Photon"] : []),
      ];
      setRemote(hits);
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
