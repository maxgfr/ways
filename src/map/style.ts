/**
 * The basemap: OpenFreeMap's Positron style (bundled, so the map does not wait
 * for a style request), recoloured layer by layer into a quiet neutral ground
 * with green parks and blue water, so that lines, stops and the route stand out
 * on it. Two palettes, light for daylight in the street and dark for the
 * evening; the tiles are the same.
 */
import type { StyleSpecification } from "maplibre-gl";
import positron from "./positron.json";

interface Ground {
  land: string;
  residential: string;
  park: string;
  water: string;
  waterLine: string;
  building: string;
  buildingLine: string;
  roadMajor: string;
  roadCasing: string;
  roadMinor: string;
  path: string;
  rail: string;
  boundary: string;
  label: string;
  labelStrong: string;
  waterLabel: string;
  halo: string;
}

const LIGHT: Ground = {
  land: "#f0f2f4",
  residential: "#eceef1",
  park: "#d2ecd3",
  water: "#a9d3f5",
  waterLine: "#93c4ee",
  building: "#e3e6ea",
  buildingLine: "#d6dadf",
  roadMajor: "#ffffff",
  roadCasing: "#d5d9df",
  roadMinor: "#fafbfc",
  path: "#e2e5e9",
  rail: "#c4cad3",
  boundary: "#9aa3b2",
  label: "#5c6676",
  labelStrong: "#283040",
  waterLabel: "#2f6fb0",
  halo: "#f7f8f9",
};

const DARK: Ground = {
  land: "#1b1f25",
  residential: "#1e2229",
  park: "#1c3026",
  water: "#12283f",
  waterLine: "#1a3654",
  building: "#252a32",
  buildingLine: "#2c323b",
  roadMajor: "#3a414c",
  roadCasing: "#262b33",
  roadMinor: "#2c323b",
  path: "#2a3038",
  rail: "#414a59",
  boundary: "#5b6577",
  label: "#9aa4b5",
  labelStrong: "#dfe4ec",
  waterLabel: "#7fb0e6",
  halo: "#1b1f25",
};

/** The colours of what ways draws over the basemap, per theme. */
export interface Overlay {
  /** The route, and anything the user can act on. */
  action: string;
  /** The rim that lifts a line or a dot off the map. */
  casing: string;
  text: string;
  halo: string;
  /** Legs on foot or by bike. */
  street: string;
  cycle: string;
  stopStroke: string;
  ok: string;
  muted: string;
  /** Search results: a red that stands out from the blue route and the green bikes. */
  danger: string;
}

const OVERLAY_LIGHT: Overlay = {
  action: "#1a66d9",
  casing: "#ffffff",
  text: "#1b1f27",
  halo: "#ffffff",
  street: "#1a66d9",
  cycle: "#1a7f4b",
  stopStroke: "#283040",
  ok: "#1a7f4b",
  muted: "#667085",
  danger: "#d93025",
};

const OVERLAY_DARK: Overlay = {
  action: "#7fb0ff",
  casing: "#14171c",
  text: "#eef1f6",
  halo: "#14171c",
  street: "#7fb0ff",
  cycle: "#5fd39a",
  stopStroke: "#dfe4ec",
  ok: "#5fd39a",
  muted: "#98a2b5",
  danger: "#ff6b5e",
};

export function overlay(dark: boolean): Overlay {
  return dark ? OVERLAY_DARK : OVERLAY_LIGHT;
}

type Layer = StyleSpecification["layers"][number];

function paintFor(id: string, type: string, g: Ground): Record<string, unknown> | null {
  if (type === "background") return { "background-color": g.land };
  if (id === "park" || id === "landcover_wood") return { "fill-color": g.park, "fill-opacity": 1 };
  if (id === "water") return { "fill-color": g.water };
  if (id === "waterway") return { "line-color": g.waterLine };
  if (id === "landuse_residential") return { "fill-color": g.residential };
  if (id.startsWith("landcover_")) return { "fill-color": g.land };
  if (id === "building") return { "fill-color": g.building, "fill-outline-color": g.buildingLine };
  if (id === "aeroway-area") return { "fill-color": g.residential };
  if (id.startsWith("aeroway")) return { "line-color": g.path };
  if (id === "road_area_pier") return { "fill-color": g.land };
  if (id === "road_pier") return { "line-color": g.land };
  if (id === "highway_path") return { "line-color": g.path };
  if (id === "highway_minor") return { "line-color": g.roadMinor };
  if (id.endsWith("_casing")) return { "line-color": g.roadCasing };
  if (id.endsWith("_inner")) return { "line-color": g.roadMajor };
  if (id.endsWith("_subtle")) return { "line-color": g.roadCasing };
  if (id.endsWith("_dashline")) return { "line-color": g.land };
  if (id.startsWith("railway")) return { "line-color": g.rail };
  if (id.startsWith("boundary")) return { "line-color": g.boundary };
  if (id.startsWith("water_name") || id === "waterway_line_label")
    return { "text-color": g.waterLabel, "text-halo-color": g.halo };
  if (id.startsWith("label_city") || id.startsWith("label_country") || id === "label_state")
    return { "text-color": g.labelStrong, "text-halo-color": g.halo };
  if (type === "symbol") return { "text-color": g.label, "text-halo-color": g.halo };
  return null;
}

/** Road shields need a sprite this style does not draw from; they are left out. */
function keep(layer: Layer): boolean {
  return !layer.id.includes("shield");
}

/** The basemap in the given palette. */
export function mapStyle(dark: boolean): StyleSpecification {
  const g = dark ? DARK : LIGHT;
  const base = positron as unknown as StyleSpecification;
  const layers = base.layers.filter(keep).map((layer): Layer => {
    const paint = paintFor(layer.id, layer.type, g);
    if (!paint) return layer;
    return { ...layer, paint: { ...(("paint" in layer && layer.paint) || {}), ...paint } } as Layer;
  });
  return { ...base, layers };
}

/**
 * The paint changes that turn a loaded map from one palette into the other,
 * so the theme switches without reloading the style (and what is drawn on it).
 */
export function recolorOps(dark: boolean): [layer: string, prop: string, value: unknown][] {
  const g = dark ? DARK : LIGHT;
  const ops: [string, string, unknown][] = [];
  for (const layer of (positron as unknown as StyleSpecification).layers) {
    const paint = paintFor(layer.id, layer.type, g);
    if (paint) for (const [k, v] of Object.entries(paint)) ops.push([layer.id, k, v]);
  }
  return ops;
}

/** The colour of the map's ground, for what is shown before tiles arrive. */
export function groundColor(dark: boolean): string {
  return (dark ? DARK : LIGHT).land;
}
