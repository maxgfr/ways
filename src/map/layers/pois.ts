/**
 * Places on the map, as a map app shows them: every shop, restaurant, museum…
 * of the vector tiles, with its icon from the basemap's own sprite and its
 * name, the most notable ones first as the map zooms in. A tap opens its card.
 *
 * Also the markers of a category search ("restaurants in this area").
 */
import { effect, signal } from "@preact/signals";
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  Map as MLMap,
} from "maplibre-gl";
import { dark, layers } from "../../app/prefs";
import { lang } from "../../i18n";
import type { Point } from "../../providers/types";
import type { FoundPlace } from "../places";
import { overlay } from "../style";
import { clickable, EMPTY, FONT_BOLD, FONT_REGULAR, setData } from "./common";

/** Kinds drawn by other layers of their own (public transport stops), or not worth a tap. */
const SKIPPED = ["bus", "railway", "rail", "ferry_terminal", "entrance", "aerialway"];

/** Like the basemap's own POI tiers: the most notable places first, the rest closer in. */
const TIERS: { id: string; minzoom: number; from: number; to: number }[] = [
  { id: "ways-poi-1", minzoom: 15, from: 1, to: 7 },
  { id: "ways-poi-2", minzoom: 16, from: 7, to: 20 },
  { id: "ways-poi-3", minzoom: 17, from: 20, to: 10_000 },
];

const RESULTS = "ways-results";
const RESULTS_LABEL = "ways-results-label";

/** The places a category search found, drawn as markers until the search is left. */
export const categoryResults = signal<FoundPlace[]>([]);

function nameExpression(code: string): ExpressionSpecification {
  return ["coalesce", ["get", `name:${code}`], ["get", `name_${code}`], ["get", "name"]];
}

/**
 * The place layers, to be part of the style the map is created with: tiles are
 * decoded for the layers of the style, and a source layer added once they are
 * in would stay empty until they are fetched again.
 */
export function poiLayerSpecs(
  isDark: boolean,
  code: string,
  visible: boolean,
): LayerSpecification[] {
  const o = overlay(isDark);
  return TIERS.map((tier) => ({
    id: tier.id,
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "poi",
    minzoom: tier.minzoom,
    filter: [
      "all",
      ["==", ["geometry-type"], "Point"],
      [">=", ["get", "rank"], tier.from],
      ["<", ["get", "rank"], tier.to],
      ["!", ["in", ["get", "class"], ["literal", SKIPPED]]],
    ] as FilterSpecification,
    layout: {
      "icon-image": [
        "match",
        ["get", "subclass"],
        ["florist", "furniture"],
        ["get", "subclass"],
        ["get", "class"],
      ],
      "text-field": nameExpression(code),
      "text-font": FONT_REGULAR,
      "text-size": 11,
      "text-anchor": "top",
      "text-offset": [0, 0.8],
      "text-max-width": 8,
      "text-optional": true,
      visibility: visible ? "visible" : "none",
    },
    paint: { "text-color": o.muted, "text-halo-color": o.halo, "text-halo-width": 1.4 },
  }));
}

export function attachPois(map: MLMap, open: (point: Point) => void): () => void {
  const o = overlay(dark.peek());
  const ids = TIERS.map((t) => t.id);
  for (const tier of TIERS) {
    clickable(map, tier.id, (e) => {
      const f = e.features?.[0];
      if (f?.geometry.type !== "Point") return;
      const [lng, lat] = f.geometry.coordinates as [number, number];
      const name = String(f.properties?.[`name:${lang.peek()}`] ?? f.properties?.name ?? "");
      open({ lat, lng, name });
    });
  }

  map.addSource(RESULTS, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: RESULTS,
    type: "circle",
    source: RESULTS,
    paint: {
      "circle-radius": 8,
      "circle-color": o.danger,
      "circle-stroke-color": o.casing,
      "circle-stroke-width": 2.5,
    },
  });
  map.addLayer({
    id: RESULTS_LABEL,
    type: "symbol",
    source: RESULTS,
    minzoom: 14,
    layout: {
      "text-field": ["get", "name"],
      "text-font": FONT_BOLD,
      "text-size": 12,
      "text-anchor": "left",
      "text-offset": [1, 0],
      "text-max-width": 9,
      "text-optional": true,
    },
    paint: { "text-color": o.text, "text-halo-color": o.halo, "text-halo-width": 1.6 },
  });
  clickable(map, RESULTS, (e) => {
    const f = e.features?.[0];
    if (f?.geometry.type !== "Point") return;
    const [lng, lat] = f.geometry.coordinates as [number, number];
    open({ lat, lng, name: String(f.properties?.name ?? "") });
  });

  const stopResults = effect(() => {
    setData(map, RESULTS, {
      type: "FeatureCollection",
      features: categoryResults.value.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: { name: p.name },
      })),
    });
  });
  const stopVisibility = effect(() => {
    const visibility = layers.value.places ? "visible" : "none";
    for (const id of ids) map.setLayoutProperty(id, "visibility", visibility);
  });
  const stopLang = effect(() => {
    for (const id of ids) map.setLayoutProperty(id, "text-field", nameExpression(lang.value));
  });
  const stopTheme = effect(() => {
    const c = overlay(dark.value);
    for (const id of ids) {
      map.setPaintProperty(id, "text-color", c.muted);
      map.setPaintProperty(id, "text-halo-color", c.halo);
    }
    map.setPaintProperty(RESULTS, "circle-color", c.danger);
    map.setPaintProperty(RESULTS, "circle-stroke-color", c.casing);
    map.setPaintProperty(RESULTS_LABEL, "text-color", c.text);
    map.setPaintProperty(RESULTS_LABEL, "text-halo-color", c.halo);
  });
  return () => {
    stopResults();
    stopVisibility();
    stopLang();
    stopTheme();
  };
}
