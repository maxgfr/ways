/**
 * Vehicles in service, moving along their line. Transitous gives, for a short
 * time window, the stretch each vehicle covers and when; the position in
 * between is worked out here. Off by default: it is the heaviest request.
 */
import { effect, signal } from "@preact/signals";
import type { Feature, Point } from "geojson";
import type { Map as MLMap } from "maplibre-gl";
import { dark, engine, layers, networkAllowed } from "../../app/prefs";
import { pointAlong } from "../../geo/polyline";
import { tripsIn } from "../../providers/motis";
import type { LiveTrip } from "../../providers/types";
import { isAbort } from "../../providers/types";
import { overlay } from "../style";
import { boxOf, EMPTY, FONT_BOLD, onSettled, setData } from "./common";

const SOURCE = "ways-vehicles";
const DOT = "ways-vehicles-dot";
const LABEL = "ways-vehicles-label";
export const VEHICLES_MIN_ZOOM = 12.5;
const WINDOW_MS = 90_000;
const REFETCH_MS = 60_000;

export const vehiclesStatus = signal<"off" | "far" | "local" | "loading" | "ready" | "error">(
  "off",
);

/** Where each vehicle is at `now`, between the two ends of its stretch. */
export function positions(trips: LiveTrip[], now: number): Feature<Point>[] {
  const out: Feature<Point>[] = [];
  for (const trip of trips) {
    if (now < trip.departure || now > trip.arrival) continue;
    const span = trip.arrival - trip.departure;
    const at = pointAlong(trip.path, span > 0 ? (now - trip.departure) / span : 0);
    if (!at) continue;
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: at.at },
      properties: { name: trip.name, color: trip.color ?? "", live: trip.realTime },
    });
  }
  return out;
}

export function attachVehicles(map: MLMap): () => void {
  const o = overlay(dark.peek());
  map.addSource(SOURCE, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: DOT,
    type: "circle",
    source: SOURCE,
    paint: {
      "circle-radius": 7,
      "circle-color": ["case", ["!=", ["get", "color"], ""], ["get", "color"], o.action],
      "circle-stroke-color": o.casing,
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: LABEL,
    type: "symbol",
    source: SOURCE,
    minzoom: 14,
    layout: {
      "text-field": ["get", "name"],
      "text-font": FONT_BOLD,
      "text-size": 11,
      "text-anchor": "left",
      "text-offset": [0.9, 0],
      "text-optional": true,
    },
    paint: { "text-color": o.text, "text-halo-color": o.halo, "text-halo-width": 1.5 },
  });

  let trips: LiveTrip[] = [];
  let controller: AbortController | null = null;
  let fetchedAt = 0;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const draw = () => {
    setData(map, SOURCE, { type: "FeatureCollection", features: positions(trips, Date.now()) });
  };

  const clear = (status: "off" | "far" | "local") => {
    controller?.abort();
    controller = null;
    trips = [];
    fetchedAt = 0;
    vehiclesStatus.value = status;
    setData(map, SOURCE, EMPTY);
  };

  const load = () => {
    if (!layers.peek().vehicles) return clear("off");
    if (!networkAllowed()) return clear("local");
    if (map.getZoom() < VEHICLES_MIN_ZOOM) return clear("far");
    if (document.hidden) return;
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    const now = Date.now();
    if (trips.length === 0) vehiclesStatus.value = "loading";
    tripsIn(boxOf(map, 0.1), map.getZoom(), { start: now, end: now + WINDOW_MS }, mine.signal)
      .then((found) => {
        if (mine.signal.aborted) return;
        trips = found;
        fetchedAt = Date.now();
        vehiclesStatus.value = "ready";
        draw();
      })
      .catch((err) => {
        if (isAbort(err) || mine.signal.aborted) return;
        vehiclesStatus.value = "error";
      });
  };

  // Positions move every second (every five when motion is reduced); the stretches are asked
  // again once a minute, and never while the tab is hidden.
  const tick = setInterval(
    () => {
      if (document.hidden || !layers.peek().vehicles) return;
      if (fetchedAt > 0 && Date.now() - fetchedAt > REFETCH_MS) load();
      else if (trips.length > 0) draw();
    },
    reduce ? 5000 : 1000,
  );
  const onVisible = () => {
    if (!document.hidden) load();
  };
  document.addEventListener("visibilitychange", onVisible);

  const stopMoves = onSettled(map, load, 600);
  const stopLayer = effect(() => {
    layers.value.vehicles;
    engine.value;
    load();
  });
  const stopTheme = effect(() => {
    const c = overlay(dark.value);
    map.setPaintProperty(DOT, "circle-color", [
      "case",
      ["!=", ["get", "color"], ""],
      ["get", "color"],
      c.action,
    ]);
    map.setPaintProperty(DOT, "circle-stroke-color", c.casing);
    map.setPaintProperty(LABEL, "text-color", c.text);
    map.setPaintProperty(LABEL, "text-halo-color", c.halo);
  });
  return () => {
    clearInterval(tick);
    document.removeEventListener("visibilitychange", onVisible);
    stopMoves();
    stopLayer();
    stopTheme();
    controller?.abort();
  };
}
