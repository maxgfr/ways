/**
 * Shared bikes and scooters around the centre of the map, from the operators'
 * GBFS feeds as Transitous gathers them. A station shows how many vehicles can
 * be taken; an empty one is drawn hollow, so the count is not carried by colour.
 */
import { effect, signal } from "@preact/signals";
import type { Feature, Point } from "geojson";
import type { Map as MLMap } from "maplibre-gl";
import * as maplibregl from "maplibre-gl";
import { dark, engine, layers, networkAllowed } from "../../app/prefs";
import { route } from "../../app/state";
import { distance } from "../../geo/polyline";
import { plural, t } from "../../i18n";
import { rentalsNear } from "../../providers/motis";
import type { RentalStation, RentalVehicle } from "../../providers/types";
import { isAbort } from "../../providers/types";
import { overlay } from "../style";
import { clickable, EMPTY, FONT_BOLD, onSettled, setData } from "./common";

const SOURCE = "ways-rentals";
const STATION = "ways-rentals-station";
const COUNT = "ways-rentals-count";
const LOOSE = "ways-rentals-loose";
export const RENTALS_MIN_ZOOM = 13.5;
const MAX_RADIUS = 2500;

export const rentalStations = signal<RentalStation[]>([]);
export const rentalsStatus = signal<"off" | "far" | "local" | "loading" | "ready" | "error">("off");

function stationFeature(s: RentalStation): Feature<Point> {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [s.lng, s.lat] },
    properties: {
      kind: "station",
      name: s.name,
      provider: s.provider,
      available: s.available,
      docks: s.docks ?? -1,
      empty: s.available === 0 || !s.renting,
    },
  };
}

function looseFeature(v: RentalVehicle): Feature<Point> {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [v.lng, v.lat] },
    properties: { kind: "loose", provider: v.provider, vehicle: v.vehicle },
  };
}

function line(text: string, cls?: string): HTMLElement {
  const el = document.createElement(cls === "title" ? "strong" : "span");
  el.textContent = text;
  if (cls) el.className = `popup-${cls}`;
  return el;
}

export function attachRentals(map: MLMap): () => void {
  const o = overlay(dark.peek());
  map.addSource(SOURCE, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: LOOSE,
    type: "circle",
    source: SOURCE,
    filter: ["==", ["get", "kind"], "loose"],
    paint: {
      "circle-radius": 4,
      "circle-color": o.cycle,
      "circle-stroke-color": o.casing,
      "circle-stroke-width": 1.5,
    },
  });
  map.addLayer({
    id: STATION,
    type: "circle",
    source: SOURCE,
    filter: ["==", ["get", "kind"], "station"],
    paint: {
      "circle-radius": 11,
      "circle-color": ["case", ["get", "empty"], o.casing, o.cycle],
      "circle-stroke-color": ["case", ["get", "empty"], o.cycle, o.casing],
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: COUNT,
    type: "symbol",
    source: SOURCE,
    filter: ["==", ["get", "kind"], "station"],
    layout: {
      "text-field": ["to-string", ["get", "available"]],
      "text-font": FONT_BOLD,
      "text-size": 12,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: { "text-color": ["case", ["get", "empty"], o.cycle, o.casing] },
  });

  let popup: maplibregl.Popup | null = null;
  const open = (at: [number, number], rows: HTMLElement[]) => {
    popup?.remove();
    const box = document.createElement("div");
    box.className = "popup";
    box.append(...rows);
    popup = new maplibregl.Popup({ offset: 14, maxWidth: "260px" })
      .setLngLat(at)
      .setDOMContent(box)
      .addTo(map);
  };
  clickable(map, STATION, (e) => {
    const f = e.features?.[0];
    const p = f?.properties;
    if (!f || !p) return;
    const rows = [line(String(p.name || p.provider), "title")];
    if (p.name && p.provider) rows.push(line(String(p.provider), "meta"));
    const n = Number(p.available);
    rows.push(line(plural(n, "rental.available.one", "rental.available.other")));
    if (Number(p.docks) >= 0)
      rows.push(line(plural(Number(p.docks), "rental.docks.one", "rental.docks.other")));
    open((f.geometry as Point).coordinates as [number, number], rows);
  });
  clickable(map, LOOSE, (e) => {
    const f = e.features?.[0];
    const p = f?.properties;
    if (!f || !p) return;
    open((f.geometry as Point).coordinates as [number, number], [
      line(String(p.provider), "title"),
      line(p.vehicle === "scooter" ? t("rental.scooter") : t("rental.bike")),
    ]);
  });

  let fetched: { at: [number, number]; radius: number } | null = null;
  let controller: AbortController | null = null;

  const clear = (status: "off" | "far" | "local") => {
    controller?.abort();
    controller = null;
    fetched = null;
    popup?.remove();
    rentalStations.value = [];
    rentalsStatus.value = status;
    setData(map, SOURCE, EMPTY);
  };

  const load = () => {
    if (!layers.peek().rentals) return clear("off");
    if (!networkAllowed()) return clear("local");
    if (map.getZoom() < RENTALS_MIN_ZOOM) return clear("far");
    const c = map.getCenter();
    const at: [number, number] = [c.lng, c.lat];
    const b = map.getBounds();
    const reach = distance(at, [b.getEast(), b.getNorth()]);
    // Still inside the circle already fetched: nothing new to ask.
    if (fetched && distance(fetched.at, at) + reach <= fetched.radius) return;
    const radius = Math.min(MAX_RADIUS, reach * 1.4);
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    rentalsStatus.value = "loading";
    rentalsNear({ lat: at[1], lng: at[0] }, radius, mine.signal)
      .then(({ stations, vehicles }) => {
        if (mine.signal.aborted) return;
        fetched = { at, radius };
        rentalStations.value = stations;
        rentalsStatus.value = "ready";
        setData(map, SOURCE, {
          type: "FeatureCollection",
          features: [...vehicles.map(looseFeature), ...stations.map(stationFeature)],
        });
      })
      .catch((err) => {
        if (isAbort(err) || mine.signal.aborted) return;
        rentalsStatus.value = "error";
      });
  };

  const stopMoves = onSettled(map, load);
  const stopLayer = effect(() => {
    layers.value.rentals;
    engine.value;
    load();
  });
  const stopTrip = effect(() => {
    const visibility = route.value.name === "dir" ? "none" : "visible";
    for (const layer of [LOOSE, STATION, COUNT])
      map.setLayoutProperty(layer, "visibility", visibility);
    if (visibility === "none") popup?.remove();
  });
  const stopTheme = effect(() => {
    const c = overlay(dark.value);
    map.setPaintProperty(LOOSE, "circle-color", c.cycle);
    map.setPaintProperty(LOOSE, "circle-stroke-color", c.casing);
    map.setPaintProperty(STATION, "circle-color", ["case", ["get", "empty"], c.casing, c.cycle]);
    map.setPaintProperty(STATION, "circle-stroke-color", [
      "case",
      ["get", "empty"],
      c.cycle,
      c.casing,
    ]);
    map.setPaintProperty(COUNT, "text-color", ["case", ["get", "empty"], c.cycle, c.casing]);
  });
  return () => {
    stopMoves();
    stopLayer();
    stopTrip();
    stopTheme();
    controller?.abort();
    popup?.remove();
  };
}
