/**
 * Public transport stops in view, from Transitous. Asked for once the map is
 * close enough for them to be told apart, and again only when the map leaves
 * the area already fetched.
 */
import { effect, signal } from "@preact/signals";
import type { Feature, Point } from "geojson";
import type { Map as MLMap } from "maplibre-gl";
import { dark, engine, layers, networkAllowed } from "../../app/prefs";
import { go, route } from "../../app/state";
import { type Box, stopsIn } from "../../providers/motis";
import type { Stop } from "../../providers/types";
import { isAbort } from "../../providers/types";
import { overlay } from "../style";
import { boxOf, clickable, contains, EMPTY, FONT_REGULAR, onSettled, setData } from "./common";

const SOURCE = "ways-stops";
const DOT = "ways-stops-dot";
const LABEL = "ways-stops-label";
export const STOPS_MIN_ZOOM = 14;

/** The stops currently drawn, for the list that mirrors the map. */
export const stopsInView = signal<Stop[]>([]);
/** "far" when the map must be zoomed in to see stops; "error" when the service did not answer. */
export const stopsStatus = signal<"off" | "far" | "local" | "loading" | "ready" | "error">("off");

const BIG: ReadonlySet<string> = new Set(["subway", "rail", "tram", "ferry", "cable"]);

function feature(s: Stop): Feature<Point> {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [s.lng, s.lat] },
    properties: {
      id: s.whole ? s.id : "",
      name: s.name,
      big: s.vehicles.some((v) => BIG.has(v)),
    },
  };
}

export function attachStops(map: MLMap): () => void {
  const o = overlay(dark.peek());
  map.addSource(SOURCE, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: DOT,
    type: "circle",
    source: SOURCE,
    paint: {
      "circle-radius": ["case", ["get", "big"], 6.5, 4.5],
      "circle-color": o.casing,
      "circle-stroke-color": o.stopStroke,
      "circle-stroke-width": ["case", ["get", "big"], 3, 2],
    },
  });
  map.addLayer({
    id: LABEL,
    type: "symbol",
    source: SOURCE,
    minzoom: 15.5,
    layout: {
      "text-field": ["get", "name"],
      "text-font": FONT_REGULAR,
      "text-size": 12,
      "text-anchor": "top",
      "text-offset": [0, 0.8],
      "text-max-width": 9,
      "text-optional": true,
    },
    paint: { "text-color": o.text, "text-halo-color": o.halo, "text-halo-width": 1.5 },
  });

  clickable(map, DOT, (e) => {
    const f = e.features?.[0];
    const p = f?.properties;
    if (!f || !p) return;
    const [lng, lat] = (f.geometry as Point).coordinates as [number, number];
    const stopId = typeof p.id === "string" && p.id ? p.id : undefined;
    go({
      name: "stop",
      point: { lat, lng, name: String(p.name ?? ""), ...(stopId ? { stopId } : {}) },
    });
  });

  let fetched: Box | null = null;
  let controller: AbortController | null = null;

  const clear = (status: "off" | "far" | "local") => {
    controller?.abort();
    controller = null;
    fetched = null;
    stopsInView.value = [];
    stopsStatus.value = status;
    setData(map, SOURCE, EMPTY);
  };

  const load = () => {
    if (!layers.peek().transit) return clear("off");
    if (!networkAllowed()) return clear("local");
    if (map.getZoom() < STOPS_MIN_ZOOM) return clear("far");
    const view = boxOf(map);
    if (fetched && contains(fetched, view)) return;
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    const box = boxOf(map, 0.3);
    stopsStatus.value = "loading";
    stopsIn(box, mine.signal)
      .then((stops) => {
        if (mine.signal.aborted) return;
        fetched = box;
        stopsInView.value = stops;
        stopsStatus.value = "ready";
        setData(map, SOURCE, { type: "FeatureCollection", features: stops.map(feature) });
      })
      .catch((err) => {
        if (isAbort(err) || mine.signal.aborted) return;
        stopsStatus.value = "error";
      });
  };

  const stopMoves = onSettled(map, load);
  const stopLayer = effect(() => {
    layers.value.transit;
    engine.value;
    load();
  });
  // While a trip is on the map, the other stops step back so it reads on its own.
  const stopTrip = effect(() => {
    const visibility = route.value.name === "dir" ? "none" : "visible";
    map.setLayoutProperty(DOT, "visibility", visibility);
    map.setLayoutProperty(LABEL, "visibility", visibility);
  });
  const stopTheme = effect(() => {
    const c = overlay(dark.value);
    map.setPaintProperty(DOT, "circle-color", c.casing);
    map.setPaintProperty(DOT, "circle-stroke-color", c.stopStroke);
    map.setPaintProperty(LABEL, "text-color", c.text);
    map.setPaintProperty(LABEL, "text-halo-color", c.halo);
  });
  return () => {
    stopMoves();
    stopLayer();
    stopTrip();
    stopTheme();
    controller?.abort();
  };
}
