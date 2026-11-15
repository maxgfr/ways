/** Helpers shared by the layers ways draws over the basemap. */
import type { FeatureCollection } from "geojson";
import type { GeoJSONSource, MapLayerMouseEvent, Map as MLMap } from "maplibre-gl";
import type { Box } from "../../providers/motis";

export const FONT_REGULAR = ["Noto Sans Regular"];
export const FONT_BOLD = ["Noto Sans Bold"];

export const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/** The visible box, grown by a share of its size so a small pan needs no new request. */
export function boxOf(map: MLMap, grow = 0): Box {
  const b = map.getBounds();
  const dLng = (b.getEast() - b.getWest()) * grow;
  const dLat = (b.getNorth() - b.getSouth()) * grow;
  return {
    west: b.getWest() - dLng,
    south: b.getSouth() - dLat,
    east: b.getEast() + dLng,
    north: b.getNorth() + dLat,
  };
}

export function contains(outer: Box, inner: Box): boolean {
  return (
    outer.west <= inner.west &&
    outer.south <= inner.south &&
    outer.east >= inner.east &&
    outer.north >= inner.north
  );
}

/** The first label layer of the basemap: overlays drawn before it stay under place names. */
export function firstLabel(map: MLMap): string | undefined {
  return map.getStyle().layers.find((l) => l.type === "symbol")?.id;
}

export function setData(map: MLMap, source: string, data: FeatureCollection): void {
  (map.getSource(source) as GeoJSONSource | undefined)?.setData(data);
}

/** Calls `run` a moment after the map stops moving. Returns how to stop listening. */
export function onSettled(map: MLMap, run: () => void, delay = 350): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const handler = () => {
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  };
  map.on("moveend", handler);
  return () => {
    clearTimeout(timer);
    map.off("moveend", handler);
  };
}

/** Makes a layer's features clickable, with the pointer cursor that says so. */
export function clickable(
  map: MLMap,
  layer: string,
  onClick: (e: MapLayerMouseEvent) => void,
): void {
  map.on("click", layer, onClick);
  map.on("mouseenter", layer, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", layer, () => {
    map.getCanvas().style.cursor = "";
  });
}
