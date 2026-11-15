/**
 * Places from the map's own data: every shop, restaurant, museum… the vector
 * tiles carry, with their kind and their name. Reading them needs no request
 * of its own: the tiles on screen are already here, so a category search over
 * the visible area is instant, private, and works offline.
 */
import type { MapGeoJSONFeature, Map as MLMap } from "maplibre-gl";
import { distance } from "../geo/polyline";
import type { MessageKey } from "../i18n";
import type { IconName } from "../ui/icons";

export type CategoryId =
  | "restaurant"
  | "cafe"
  | "bar"
  | "grocery"
  | "pharmacy"
  | "hotel"
  | "museum";

export interface Category {
  id: CategoryId;
  icon: IconName;
  label: MessageKey;
  /** The OpenMapTiles `poi` classes and subclasses it covers. */
  classes: readonly string[];
}

export const CATEGORIES: readonly Category[] = [
  {
    id: "restaurant",
    icon: "restaurant",
    label: "cat.restaurant",
    classes: ["restaurant", "fast_food"],
  },
  { id: "cafe", icon: "cafe", label: "cat.cafe", classes: ["cafe"] },
  { id: "bar", icon: "bar", label: "cat.bar", classes: ["bar", "beer", "pub"] },
  {
    id: "grocery",
    icon: "grocery",
    label: "cat.grocery",
    classes: ["grocery", "supermarket", "convenience", "bakery"],
  },
  { id: "pharmacy", icon: "pharmacy", label: "cat.pharmacy", classes: ["pharmacy"] },
  {
    id: "hotel",
    icon: "hotel",
    label: "cat.hotel",
    classes: ["lodging", "hotel", "hostel", "guest_house"],
  },
  { id: "museum", icon: "museum", label: "cat.museum", classes: ["museum", "art_gallery"] },
];

export function categoryById(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export interface FoundPlace {
  name: string;
  lat: number;
  lng: number;
  /** The kind of place, as the map's data names it ("restaurant", "pharmacy"…). */
  kind: string;
  /** Metres from the point the search was made around. */
  distance: number;
}

type Props = Record<string, unknown>;

/** A place's name in the user's language when the map knows it, else its own. */
export function placeName(props: Props, lang: string): string {
  const local = props[`name:${lang}`] ?? props[`name_${lang}`];
  const name = typeof local === "string" && local ? local : props.name;
  return typeof name === "string" ? name.trim() : "";
}

export function inCategory(props: Props, category: Category): boolean {
  return (
    category.classes.includes(String(props.class ?? "")) ||
    category.classes.includes(String(props.subclass ?? ""))
  );
}

/**
 * The named places of a category among some tile features, inside a box,
 * nearest to `around` first. The same place cut by several tiles appears once.
 */
export function pick(
  features: { properties: Props; geometry: { type: string; coordinates: unknown } }[],
  category: Category,
  box: { west: number; south: number; east: number; north: number },
  around: [number, number],
  lang: string,
  limit = 40,
): FoundPlace[] {
  const seen = new Set<string>();
  const out: FoundPlace[] = [];
  for (const f of features) {
    if (f.geometry.type !== "Point" || !inCategory(f.properties, category)) continue;
    const [lng, lat] = f.geometry.coordinates as [number, number];
    if (lng < box.west || lng > box.east || lat < box.south || lat > box.north) continue;
    const name = placeName(f.properties, lang);
    if (!name) continue;
    const key = `${name}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      lat,
      lng,
      kind: String(f.properties.subclass || f.properties.class || ""),
      distance: distance(around, [lng, lat]),
    });
  }
  return out.sort((a, b) => a.distance - b.distance).slice(0, limit);
}

/** The places of a category in the area the map shows. */
export function placesInView(map: MLMap, category: Category, lang: string): FoundPlace[] {
  const b = map.getBounds();
  const c = map.getCenter();
  const features = map.querySourceFeatures("openmaptiles", {
    sourceLayer: "poi",
  }) as MapGeoJSONFeature[];
  return pick(
    features as unknown as {
      properties: Props;
      geometry: { type: string; coordinates: unknown };
    }[],
    category,
    { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
    [c.lng, c.lat],
    lang,
  );
}
