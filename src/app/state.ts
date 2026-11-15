/**
 * Interface state: the route (in the URL hash, so the back button and shared
 * links work), the user's position, and when a trip should leave or arrive.
 * A place, a stop and both ends of a trip are written into the hash itself:
 * nothing about them is stored anywhere to make a link work.
 */
import { signal } from "@preact/signals";
import { type CategoryId, categoryById } from "../map/places";
import type { Point } from "../providers/types";
import type { TravelMode } from "./prefs";

export type Route =
  | { name: "home" }
  | { name: "place"; point: Point; osm?: string }
  | { name: "stop"; point: Point }
  | {
      name: "dir";
      /** Null means "where I am". */
      from: Point | null;
      to: Point | null;
      mode: TravelMode;
      /** The itinerary opened in detail, by its position in the list. */
      pick: number | null;
    }
  | { name: "category"; id: CategoryId }
  | { name: "saved" }
  | { name: "layers" }
  | { name: "settings" }
  | { name: "sources" };

const MODES: TravelMode[] = ["transit", "bike", "walk"];

export function encodePoint(p: Point): string {
  const parts = [p.lat.toFixed(5), p.lng.toFixed(5), encodeURIComponent(p.name)];
  if (p.stopId) parts.push(encodeURIComponent(p.stopId));
  return parts.join(",");
}

export function decodePoint(text: string | undefined): Point | null {
  if (!text) return null;
  const [a, b, name = "", stopId] = text.split(",");
  const lat = Number(a);
  const lng = Number(b);
  if (a === "" || b === undefined || b === "" || !Number.isFinite(lat) || !Number.isFinite(lng))
    return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const decode = (s: string): string => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const point: Point = { lat, lng, name: decode(name) };
  if (stopId) point.stopId = decode(stopId);
  return point;
}

export function parseRoute(hash: string): Route {
  const [head = "", ...rest] = hash.replace(/^#\/?/, "").split("/");
  switch (head) {
    case "place": {
      const point = decodePoint(rest[0]);
      if (!point) return { name: "home" };
      const osm = rest[1] && /^[NWR]\d+$/.test(rest[1]) ? rest[1] : undefined;
      return { name: "place", point, ...(osm ? { osm } : {}) };
    }
    case "stop": {
      const point = decodePoint(rest[0]);
      return point ? { name: "stop", point } : { name: "home" };
    }
    case "dir": {
      const mode = MODES.find((m) => m === rest[2]) ?? "transit";
      const n = rest[3] === undefined || rest[3] === "" ? Number.NaN : Number(rest[3]);
      return {
        name: "dir",
        from: decodePoint(rest[0]),
        to: decodePoint(rest[1]),
        mode,
        pick: Number.isInteger(n) && n >= 0 ? n : null,
      };
    }
    case "category": {
      const category = categoryById(rest[0] ?? "");
      return category ? { name: "category", id: category.id } : { name: "home" };
    }
    case "saved":
    case "layers":
    case "settings":
    case "sources":
      return { name: head };
    default:
      return { name: "home" };
  }
}

export function href(r: Route): string {
  switch (r.name) {
    case "home":
      return "#/";
    case "place":
      return `#/place/${encodePoint(r.point)}${r.osm ? `/${r.osm}` : ""}`;
    case "stop":
      return `#/stop/${encodePoint(r.point)}`;
    case "dir": {
      const end = (p: Point | null) => (p ? encodePoint(p) : "-");
      return `#/dir/${end(r.from)}/${end(r.to)}/${r.mode}${r.pick !== null ? `/${r.pick}` : ""}`;
    }
    case "category":
      return `#/category/${r.id}`;
    default:
      return `#/${r.name}`;
  }
}

export const route = signal<Route>(
  typeof location === "undefined" ? { name: "home" } : parseRoute(location.hash),
);

/** How many screens this tab pushed: going back past them would leave the app. */
let depth = 0;

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    route.value = parseRoute(location.hash);
  });
  window.addEventListener("popstate", () => {
    depth = Math.max(0, depth - 1);
  });
}

export function go(r: Route, opts: { replace?: boolean } = {}): void {
  const target = href(r);
  if (opts.replace) history.replaceState(null, "", target);
  else if (location.hash !== target) {
    history.pushState(null, "", target);
    depth++;
  }
  route.value = r;
}

/** Back to the previous screen when this tab has one, otherwise to `fallback`. */
export function back(fallback: Route = { name: "home" }): void {
  if (depth > 0) history.back();
  else go(fallback, { replace: true });
}

/** The user's position once they allowed it, [lng, lat]. */
export const userPosition = signal<[number, number] | null>(null);
/** How sure the device is of that position: a radius in metres. */
export const userAccuracy = signal<number | null>(null);
/** True while the device is being asked where it is. */
export const locating = signal(false);

/** When a trip should happen: leaving now, leaving at a time, or arriving by one. */
export interface When {
  kind: "now" | "depart" | "arrive";
  /** Epoch milliseconds; ignored for "now". */
  time: number;
}

export const when = signal<When>({ kind: "now", time: 0 });

/** A point pressed on the map, shown as a pin until the user leaves it. */
export const pin = signal<{ lat: number; lng: number } | null>(null);
