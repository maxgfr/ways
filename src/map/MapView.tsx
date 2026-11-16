/**
 * The map: the basemap, the layers ways draws over it (cycle paths, stops,
 * shared vehicles, vehicles in service, the trip), the user's position, and
 * the pin of the place or stop open in the panel.
 *
 * Pressing the map (a long press, or a right click) opens what is there.
 */
import { effect, signal } from "@preact/signals";
import type { MapLayerTouchEvent, Map as MLMap } from "maplibre-gl";
import * as maplibregl from "maplibre-gl";
import { useEffect, useRef } from "preact/hooks";
import { locate, openPointAt } from "../app/actions";
import { dark, lastView, layers } from "../app/prefs";
import { deviceTimezone, homeZone, positionAllowed, startView } from "../app/startView";
import { go, pin, route, userAccuracy, userPosition } from "../app/state";
import { lang, t } from "../i18n";
import { remember } from "../store/store";
import { EMPTY } from "./layers/common";
import { attachCycling } from "./layers/cycling";
import { attachPois, poiLayerSpecs } from "./layers/pois";
import { attachRentals } from "./layers/rentals";
import { attachRoute } from "./layers/route";
import { attachStops } from "./layers/stops";
import { attachVehicles } from "./layers/vehicles";
import { groundColor, mapStyle, overlay, recolorOps } from "./style";

/** The live map, once it has loaded. */
export const mapRef = signal<MLMap | null>(null);
/** The map's centre, [lng, lat], and zoom, kept current as it moves. */
export const mapCenter = signal<[number, number]>([2.35, 48.86]);
export const mapZoom = signal(4);
/** How much of the map the panel covers, so the map can centre things in what stays visible. */
export const sheetInset = signal<{ bottom: number; left: number }>({ bottom: 0, left: 0 });

function reducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Moves the map so a point sits in the part the panel leaves visible. */
export function showPoint(lng: number, lat: number, zoom?: number): void {
  const map = mapRef.value;
  if (!map) return;
  const inset = sheetInset.value;
  map.easeTo({
    center: [lng, lat],
    ...(zoom !== undefined ? { zoom: Math.max(map.getZoom(), zoom) } : {}),
    padding: { top: 80, bottom: inset.bottom + 20, left: inset.left + 20, right: 20 },
    duration: reducedMotion() ? 0 : 650,
  });
}

/** Frames a [west, south, east, north] box in the part the panel leaves visible. */
export function fitBox(box: [number, number, number, number]): void {
  const map = mapRef.value;
  if (!map) return;
  const inset = sheetInset.value;
  // On a phone the panel is brought down to half before framing, so the trip stays in view.
  const bottom = Math.min(inset.bottom, Math.round(window.innerHeight * 0.55));
  map.fitBounds(
    [
      [box[0], box[1]],
      [box[2], box[3]],
    ],
    {
      padding: { top: 110, bottom: bottom + 60, left: inset.left + 60, right: 80 },
      maxZoom: 16,
      duration: reducedMotion() ? 0 : 700,
    },
  );
}

const LONG_PRESS_MS = 520;
/** The zoom a link to a place or a stop opens at: its street. */
const LINKED_ZOOM = 16;
const ME = "ways-me-accuracy";

/**
 * A radius in metres as a circle radius in pixels at every zoom: the ground covered by a
 * pixel halves with each zoom level, and shrinks with the cosine of the latitude.
 */
export function metresToPixels(metres: number, lat: number): maplibregl.ExpressionSpecification {
  const metresPerPixelAtZoom22 = (78271.484 * Math.cos((lat * Math.PI) / 180)) / 2 ** 22;
  return [
    "interpolate",
    ["exponential", 2],
    ["zoom"],
    0,
    0,
    22,
    Math.min(4000, metres / metresPerPixelAtZoom22),
  ];
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    maplibregl.setWorkerUrl(new URL("./maplibre-gl-worker.mjs", document.baseURI).href);
    // The place or stop of a link; else where the user last looked, or else their city as their
    // device's time zone tells it.
    const opened = route.peek();
    const linked =
      opened.name === "place" || opened.name === "stop"
        ? { lng: opened.point.lng, lat: opened.point.lat, zoom: LINKED_ZOOM }
        : null;
    const view =
      linked ?? startView(lastView.value, homeZone(deviceTimezone(), navigator.language));
    const base = mapStyle(dark.value);
    const map = new maplibregl.Map({
      container: container.current,
      style: {
        ...base,
        layers: [...base.layers, ...poiLayerSpecs(dark.value, lang.value, layers.value.places)],
      },
      center: [view.lng, view.lat],
      zoom: view.zoom,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
      fadeDuration: 150,
    });
    map.touchZoomRotate.disableRotation();
    // Top right, under the chips: the panel covers the bottom of the map on a phone.
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "top-right");
    // Zoom buttons, for a mouse: on a touch screen the fingers do it.
    if (matchMedia("(pointer: fine)").matches)
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    container.current.style.background = groundColor(dark.value);

    const disposers: (() => void)[] = [];
    let selected: maplibregl.Marker | null = null;
    let me: maplibregl.Marker | null = null;

    map.on("load", () => {
      // The attribution stays one tap away (and in full on the sources screen).
      container.current
        ?.querySelector(".maplibregl-ctrl-attrib")
        ?.classList.remove("maplibregl-compact-show");
      // Set first: a trip opened from a link may already be there to frame.
      mapRef.value = map;
      // As a map app does: when the user allowed it before, open on where they are. A link to a
      // place, a stop or a trip keeps its own view.
      if (route.peek().name === "home") {
        void positionAllowed().then((allowed) => {
          if (allowed) locate((pos) => showPoint(pos[0], pos[1], 15));
        });
      }
      // The linked point, moved into the part of the map the panel leaves visible.
      if (linked) showPoint(linked.lng, linked.lat, LINKED_ZOOM);
      disposers.push(
        attachCycling(map),
        attachPois(map, (point) => {
          // The place is on screen already: its card opens without moving the map.
          remember("place", point);
          go({ name: "place", point });
        }),
        attachRoute(map, fitBox),
        attachStops(map),
        attachRentals(map),
        attachVehicles(map),
      );

      // The place or stop open in the panel, or the point just pressed.
      disposers.push(
        effect(() => {
          const r = route.value;
          const at =
            r.name === "place" || r.name === "stop"
              ? { lat: r.point.lat, lng: r.point.lng }
              : pin.value;
          selected?.remove();
          selected = null;
          if (!at) return;
          selected = new maplibregl.Marker({ color: overlay(dark.value).action })
            .setLngLat([at.lng, at.lat])
            .addTo(map);
        }),
      );

      // How sure the device is of the position, as a disc in metres around the dot.
      map.addSource(ME, { type: "geojson", data: EMPTY });
      map.addLayer({
        id: ME,
        type: "circle",
        source: ME,
        paint: {
          "circle-color": overlay(dark.value).action,
          "circle-opacity": 0.14,
          "circle-stroke-color": overlay(dark.value).action,
          "circle-stroke-opacity": 0.4,
          "circle-stroke-width": 1,
          "circle-radius": 0,
        },
      });
      disposers.push(
        effect(() => {
          const pos = userPosition.value;
          const accuracy = userAccuracy.value;
          const shown = pos && accuracy !== null && accuracy > 15;
          (map.getSource(ME) as maplibregl.GeoJSONSource | undefined)?.setData(
            shown
              ? {
                  type: "FeatureCollection",
                  features: [
                    {
                      type: "Feature",
                      geometry: { type: "Point", coordinates: pos },
                      properties: {},
                    },
                  ],
                }
              : EMPTY,
          );
          if (shown) map.setPaintProperty(ME, "circle-radius", metresToPixels(accuracy, pos[1]));
        }),
      );

      disposers.push(
        effect(() => {
          const pos = userPosition.value;
          if (!pos) {
            me?.remove();
            me = null;
            return;
          }
          if (!me) {
            const el = document.createElement("div");
            el.className = "me-dot";
            me = new maplibregl.Marker({ element: el }).setLngLat(pos).addTo(map);
          } else me.setLngLat(pos);
        }),
      );

      disposers.push(
        effect(() => {
          const isDark = dark.value;
          for (const [layer, prop, value] of recolorOps(isDark)) {
            if (map.getLayer(layer))
              map.setPaintProperty(
                layer,
                prop as Parameters<MLMap["setPaintProperty"]>[1],
                value as Parameters<MLMap["setPaintProperty"]>[2],
              );
          }
          if (container.current) container.current.style.background = groundColor(isDark);
        }),
      );
    });

    // Leaving a card takes its pin away.
    disposers.push(
      effect(() => {
        const name = route.value.name;
        if (name !== "place" && name !== "dir") pin.value = null;
      }),
    );

    map.on("contextmenu", (e: maplibregl.MapMouseEvent) => {
      void openPointAt(e.lngLat.lat, e.lngLat.lng);
    });
    let pressTimer: ReturnType<typeof setTimeout> | undefined;
    let pressStart: { x: number; y: number } | null = null;
    const cancelPress = () => {
      clearTimeout(pressTimer);
      pressStart = null;
    };
    map.on("touchstart", (e: MapLayerTouchEvent) => {
      if (e.originalEvent.touches.length !== 1) return cancelPress();
      const touch = e.originalEvent.touches[0];
      if (!touch) return;
      pressStart = { x: touch.clientX, y: touch.clientY };
      const at = e.lngLat;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        pressStart = null;
        navigator.vibrate?.(12);
        void openPointAt(at.lat, at.lng);
      }, LONG_PRESS_MS);
    });
    map.on("touchmove", (e: MapLayerTouchEvent) => {
      const touch = e.originalEvent.touches[0];
      if (!pressStart || !touch) return;
      if (Math.hypot(touch.clientX - pressStart.x, touch.clientY - pressStart.y) > 8) cancelPress();
    });
    map.on("touchend", cancelPress);
    map.on("touchcancel", cancelPress);
    map.on("movestart", (e) => {
      if ((e as { originalEvent?: Event }).originalEvent) cancelPress();
    });

    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    map.on("moveend", () => {
      const c = map.getCenter();
      mapCenter.value = [c.lng, c.lat];
      mapZoom.value = map.getZoom();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        lastView.value = { lng: c.lng, lat: c.lat, zoom: map.getZoom() };
      }, 400);
    });
    const c0 = map.getCenter();
    mapCenter.value = [c0.lng, c0.lat];
    mapZoom.value = map.getZoom();

    return () => {
      for (const dispose of disposers) dispose();
      cancelPress();
      clearTimeout(saveTimer);
      mapRef.value = null;
      map.remove();
    };
  }, []);

  return <div ref={container} class="map" role="application" aria-label={t("map.label")} />;
}
