/**
 * What the user chose and what survives a reload: theme, the last map view,
 * the layers shown, the routing engine and the service addresses. Kept in this
 * browser only, under one localStorage key.
 */
import { computed, effect, signal } from "@preact/signals";

export type Theme = "system" | "light" | "dark";

/** Where trips are computed: the open services, this browser, or whichever can answer. */
export type Engine = "auto" | "online" | "device";

export interface Layers {
  /** Public transport stops. */
  transit: boolean;
  /** Cycle paths and lanes. */
  cycling: boolean;
  /** Shared bikes and scooters. */
  rentals: boolean;
  /** Vehicles in service, moving. */
  vehicles: boolean;
}

export type ServiceId = "motis" | "valhalla";

/** The community services ways calls unless the user points it at their own. */
export const DEFAULT_ENDPOINTS: Record<ServiceId, string> = {
  motis: "https://api.transitous.org",
  valhalla: "https://valhalla1.openstreetmap.de",
};

export type TravelMode = "transit" | "bike" | "walk";
export type Pace = "slow" | "normal" | "fast";

/** How the user likes to travel. Sent only as parameters of a trip request. */
export interface Travel {
  /** The mode a new trip opens on: the last one the user picked. */
  mode: TravelMode;
  /** By bike, prefer a flatter way even when it is longer. */
  avoidHills: boolean;
  /** Walking pace, which sets how long legs on foot take. */
  pace: Pace;
  /** Avoid stairs: ramps and lifts only, on foot and when changing lines. */
  stepFree: boolean;
}

export const DEFAULT_TRAVEL: Travel = {
  mode: "transit",
  avoidHills: false,
  pace: "normal",
  stepFree: false,
};

export interface View {
  lng: number;
  lat: number;
  zoom: number;
}

interface Prefs {
  theme: Theme;
  view: View | null;
  layers: Layers;
  engine: Engine;
  endpoints: Record<ServiceId, string>;
  travel: Travel;
  /** Download the region around what the user looks at, and keep it up to date. */
  autoRegions: boolean;
}

const PREFS_KEY = "ways:prefs";

export const DEFAULT_LAYERS: Layers = {
  transit: true,
  cycling: false,
  rentals: false,
  vehicles: false,
};

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** A custom service address, kept only when it is a usable http(s) URL; "" means the default. */
export function cleanEndpoint(v: unknown): string {
  if (typeof v !== "string") return "";
  const text = v.trim().replace(/\/+$/, "");
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? text : "";
  } catch {
    return "";
  }
}

/** Reads stored preferences, replacing anything missing or malformed by its default. */
export function parsePrefs(raw: unknown): Prefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const theme: Theme = r.theme === "light" || r.theme === "dark" ? r.theme : "system";
  const v = r.view as Partial<View> | null | undefined;
  const view =
    v && Number.isFinite(v.lng) && Number.isFinite(v.lat) && Number.isFinite(v.zoom)
      ? { lng: v.lng as number, lat: v.lat as number, zoom: v.zoom as number }
      : null;
  const l = (r.layers && typeof r.layers === "object" ? r.layers : {}) as Record<string, unknown>;
  const e = (r.endpoints && typeof r.endpoints === "object" ? r.endpoints : {}) as Record<
    string,
    unknown
  >;
  const tr = (r.travel && typeof r.travel === "object" ? r.travel : {}) as Record<string, unknown>;
  return {
    theme,
    view,
    layers: {
      transit: bool(l.transit, DEFAULT_LAYERS.transit),
      cycling: bool(l.cycling, DEFAULT_LAYERS.cycling),
      rentals: bool(l.rentals, DEFAULT_LAYERS.rentals),
      vehicles: bool(l.vehicles, DEFAULT_LAYERS.vehicles),
    },
    engine: r.engine === "online" || r.engine === "device" ? r.engine : "auto",
    endpoints: { motis: cleanEndpoint(e.motis), valhalla: cleanEndpoint(e.valhalla) },
    travel: {
      mode: tr.mode === "bike" || tr.mode === "walk" ? tr.mode : DEFAULT_TRAVEL.mode,
      avoidHills: bool(tr.avoidHills, DEFAULT_TRAVEL.avoidHills),
      pace: tr.pace === "slow" || tr.pace === "fast" ? tr.pace : DEFAULT_TRAVEL.pace,
      stepFree: bool(tr.stepFree, DEFAULT_TRAVEL.stepFree),
    },
    autoRegions: bool(r.autoRegions, true),
  };
}

function readPrefs(): Prefs {
  try {
    return parsePrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null"));
  } catch {
    return parsePrefs(null);
  }
}

const initial = typeof window === "undefined" ? parsePrefs(null) : readPrefs();

export const theme = signal<Theme>(initial.theme);
export const lastView = signal<View | null>(initial.view);
export const layers = signal<Layers>(initial.layers);
export const engine = signal<Engine>(initial.engine);
export const autoRegions = signal<boolean>(initial.autoRegions);
/** Custom service addresses; an empty string means the default one. */
export const endpoints = signal<Record<ServiceId, string>>(initial.endpoints);

export const travel = signal<Travel>(initial.travel);

export function setTravel(patch: Partial<Travel>): void {
  travel.value = { ...travel.value, ...patch };
}

/**
 * False in local mode: the user chose that no service be called. Only map tiles still load,
 * and those can be kept offline.
 */
export function networkAllowed(): boolean {
  return engine.value !== "device";
}

/** The address a service is called at: the user's own when set, the community one otherwise. */
export function endpoint(id: ServiceId): string {
  return endpoints.value[id] || DEFAULT_ENDPOINTS[id];
}

/** The host of a service, as named to the user wherever it is called. */
export function hostOf(id: ServiceId): string {
  try {
    return new URL(endpoint(id)).host;
  } catch {
    return endpoint(id);
  }
}

export function toggleLayer(id: keyof Layers): void {
  layers.value = { ...layers.value, [id]: !layers.value[id] };
}

const systemDark = signal(
  typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches,
);
if (typeof matchMedia !== "undefined") {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    systemDark.value = e.matches;
  });
}

/** The theme in effect: the user's choice, or the system's. */
export const dark = computed(() =>
  theme.value === "system" ? systemDark.value : theme.value === "dark",
);

if (typeof window !== "undefined") {
  effect(() => {
    document.documentElement.dataset.theme = dark.value ? "dark" : "light";
  });
  effect(() => {
    const prefs: Prefs = {
      theme: theme.value,
      view: lastView.value,
      layers: layers.value,
      engine: engine.value,
      endpoints: endpoints.value,
      travel: travel.value,
      autoRegions: autoRegions.value,
    };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  });
}
