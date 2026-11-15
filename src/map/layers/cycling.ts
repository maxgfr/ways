/**
 * Cycle paths, from the basemap's own tiles (OpenStreetMap through
 * OpenFreeMap): ways mapped as cycleways, and paths signed for bicycles.
 * Painted lanes on a road are not in these tiles.
 */
import { effect } from "@preact/signals";
import type { Map as MLMap } from "maplibre-gl";
import { dark, layers } from "../../app/prefs";
import { overlay } from "../style";
import { firstLabel } from "./common";

const LAYER = "ways-cycling";

export function attachCycling(map: MLMap): () => void {
  map.addLayer(
    {
      id: LAYER,
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 10,
      filter: [
        "all",
        ["==", ["geometry-type"], "LineString"],
        ["any", ["==", ["get", "subclass"], "cycleway"], ["==", ["get", "bicycle"], "designated"]],
      ],
      layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
      paint: {
        "line-color": overlay(dark.peek()).cycle,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 14, 2.5, 18, 5],
      },
    },
    firstLabel(map),
  );
  const stopVisibility = effect(() => {
    map.setLayoutProperty(LAYER, "visibility", layers.value.cycling ? "visible" : "none");
  });
  const stopTheme = effect(() => {
    map.setPaintProperty(LAYER, "line-color", overlay(dark.value).cycle);
  });
  return () => {
    stopVisibility();
    stopTheme();
  };
}
