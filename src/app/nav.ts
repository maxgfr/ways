/** Opening things: a search hit, a kept place, a trip to somewhere. */
import { showPoint } from "../map/MapView";
import type { Point } from "../providers/types";
import { remember } from "../store/store";
import { travel } from "./prefs";
import type { Hit } from "./search";
import { go, pin } from "./state";

/** The label a point is stored and linked under: its name, then where it is. */
export function fullLabel(name: string, meta: string): string {
  return meta ? `${name}, ${meta}` : name;
}

export function openPlace(kind: "place" | "stop", point: Point, osm?: string): void {
  pin.value = null;
  remember(kind, point, osm);
  if (kind === "stop") go({ name: "stop", point });
  else go({ name: "place", point, ...(osm ? { osm } : {}) });
  showPoint(point.lng, point.lat, kind === "stop" ? 16 : 15);
}

export function openHit(hit: Hit): void {
  openPlace(hit.kind, { ...hit.point, name: fullLabel(hit.point.name, hit.meta) }, hit.osm);
}

/** Opens the directions screen towards a point, in the mode the user last used. */
export function directionsTo(to: Point | null): void {
  go({ name: "dir", from: null, to, mode: travel.value.mode, pick: null });
}
