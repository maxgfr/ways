/**
 * The trip on the map. Each way of travelling has its own stroke, the same as
 * in the list beside it: a solid line in the line's colour for public
 * transport, dashes by bike, dots on foot. A white rim lifts it off the map.
 */
import { effect } from "@preact/signals";
import type { Feature, LineString, Point } from "geojson";
import type { Map as MLMap } from "maplibre-gl";
import * as maplibregl from "maplibre-gl";
import { dark } from "../../app/prefs";
import { route } from "../../app/state";
import { shownItinerary, shownTrip } from "../../app/trips";
import { boundsOf } from "../../geo/polyline";
import type { Leg } from "../../providers/types";
import { overlay } from "../style";
import { EMPTY, setData } from "./common";

const LINES = "ways-route";
const DOTS = "ways-route-stops";
const CASING = "ways-route-casing";
const SOLID = "ways-route-solid";
const DASHED = "ways-route-dashed";
const DOTTED = "ways-route-dotted";
const STOPS = "ways-route-stop-dots";

/** The stroke a leg is drawn with. */
export function strokeOf(leg: Pick<Leg, "kind">): "solid" | "dashed" | "dotted" {
  if (leg.kind === "transit" || leg.kind === "car") return "solid";
  return leg.kind === "walk" ? "dotted" : "dashed";
}

export function legFeatures(legs: Leg[]): { lines: Feature<LineString>[]; dots: Feature<Point>[] } {
  const lines: Feature<LineString>[] = [];
  const dots: Feature<Point>[] = [];
  for (const leg of legs) {
    // A leg without geometry is still shown, as the straight line between its ends.
    const path =
      leg.path.length > 1
        ? leg.path
        : [
            [leg.from.lng, leg.from.lat],
            [leg.to.lng, leg.to.lat],
          ];
    lines.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: path },
      properties: { stroke: strokeOf(leg), color: leg.line?.color ?? "" },
    });
    if (leg.kind !== "transit") continue;
    for (const call of [leg.from, ...leg.stops, leg.to]) {
      dots.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [call.lng, call.lat] },
        properties: { end: call === leg.from || call === leg.to },
      });
    }
  }
  return { lines, dots };
}

export function attachRoute(
  map: MLMap,
  fit: (box: [number, number, number, number]) => void,
): () => void {
  const o = overlay(dark.peek());
  map.addSource(LINES, { type: "geojson", data: EMPTY });
  map.addSource(DOTS, { type: "geojson", data: EMPTY });
  const lineColor = (fallback: string): maplibregl.ExpressionSpecification => [
    "case",
    ["!=", ["get", "color"], ""],
    ["get", "color"],
    fallback,
  ];
  map.addLayer({
    id: CASING,
    type: "line",
    source: LINES,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": o.casing, "line-width": 9 },
  });
  map.addLayer({
    id: SOLID,
    type: "line",
    source: LINES,
    filter: ["==", ["get", "stroke"], "solid"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": lineColor(o.action), "line-width": 5 },
  });
  map.addLayer({
    id: DASHED,
    type: "line",
    source: LINES,
    filter: ["==", ["get", "stroke"], "dashed"],
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: { "line-color": o.street, "line-width": 5, "line-dasharray": [2, 1] },
  });
  map.addLayer({
    id: DOTTED,
    type: "line",
    source: LINES,
    filter: ["==", ["get", "stroke"], "dotted"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": o.street, "line-width": 5, "line-dasharray": [0.01, 1.8] },
  });
  map.addLayer({
    id: STOPS,
    type: "circle",
    source: DOTS,
    paint: {
      "circle-radius": ["case", ["get", "end"], 5, 3],
      "circle-color": o.casing,
      "circle-stroke-color": o.stopStroke,
      "circle-stroke-width": ["case", ["get", "end"], 2.5, 1.5],
    },
  });

  let start: maplibregl.Marker | null = null;
  let end: maplibregl.Marker | null = null;
  let framed = "";

  const stopData = effect(() => {
    const itinerary = shownItinerary.value;
    const legs = itinerary?.legs ?? (shownTrip.value ? [shownTrip.value] : []);
    const { lines, dots } = legFeatures(legs);
    setData(map, LINES, { type: "FeatureCollection", features: lines });
    setData(map, DOTS, { type: "FeatureCollection", features: dots });
    start?.remove();
    end?.remove();
    start = null;
    end = null;
    const first = legs[0];
    const last = legs[legs.length - 1];
    if (itinerary && first && last) {
      const el = document.createElement("div");
      el.className = "route-start";
      start = new maplibregl.Marker({ element: el })
        .setLngLat([first.from.lng, first.from.lat])
        .addTo(map);
      end = new maplibregl.Marker({ color: overlay(dark.peek()).action })
        .setLngLat([last.to.lng, last.to.lat])
        .addTo(map);
    }
    // Frame a trip once when it appears, not each time its times refresh. A line opened from a
    // stop is drawn without moving the map: the user is looking at that stop.
    // While guiding, the camera follows the traveller instead.
    const key = itinerary ? itinerary.id : "";
    if (key && key !== framed && route.peek().name !== "go") {
      const box = boundsOf(lines.map((l) => l.geometry.coordinates as [number, number][]));
      if (box) fit(box);
    }
    framed = key;
  });
  const stopTheme = effect(() => {
    const c = overlay(dark.value);
    map.setPaintProperty(CASING, "line-color", c.casing);
    map.setPaintProperty(SOLID, "line-color", lineColor(c.action));
    map.setPaintProperty(DASHED, "line-color", c.street);
    map.setPaintProperty(DOTTED, "line-color", c.street);
    map.setPaintProperty(STOPS, "circle-color", c.casing);
    map.setPaintProperty(STOPS, "circle-stroke-color", c.stopStroke);
  });
  return () => {
    stopData();
    stopTheme();
    start?.remove();
    end?.remove();
  };
}
