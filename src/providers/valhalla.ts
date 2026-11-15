/**
 * Bike and foot routes from Valhalla, on the server FOSSGIS runs for the
 * OpenStreetMap community: turn-by-turn instructions in the user's language
 * and the terrain along the way. Fair use: one call at a time per user, and
 * the app names itself in a header, as the operators ask.
 */
import { endpoint, hostOf } from "../app/prefs";
import { decodePolyline } from "../geo/polyline";
import { locale } from "../i18n";
import { getJson } from "./http";
import type { Itinerary, Leg, Origin, PlanRequest, Router, Step } from "./types";

export const SERVICE = "Valhalla (FOSSGIS)";
const CLIENT_ID = "ways (https://github.com/maxgfr/ways)";

interface Maneuver {
  instruction?: string;
  length?: number;
}

interface Trip {
  summary?: { time?: number; length?: number };
  legs?: { shape?: string; maneuvers?: Maneuver[]; elevation?: number[] }[];
}

interface Answer {
  trip?: Trip;
  alternates?: { trip?: Trip }[];
}

export function origin(): Origin {
  return { name: SERVICE, host: hostOf("valhalla") };
}

/** Metres climbed and descended along a height profile, ignoring wobbles under a metre. */
export function climb(heights: number[]): { ascent: number; descent: number } {
  let ascent = 0;
  let descent = 0;
  let ref = heights[0] ?? 0;
  for (const h of heights) {
    const d = h - ref;
    if (d >= 1) {
      ascent += d;
      ref = h;
    } else if (d <= -1) {
      descent -= d;
      ref = h;
    }
  }
  return { ascent: Math.round(ascent), descent: Math.round(descent) };
}

export function toItinerary(
  trip: Trip,
  req: PlanRequest,
  from: Origin,
  index: number,
  now: number,
): Itinerary | null {
  const duration = trip.summary?.time;
  const legs = trip.legs ?? [];
  if (typeof duration !== "number" || legs.length === 0) return null;
  const path = legs.flatMap((l) => (l.shape ? decodePolyline(l.shape, 6) : []));
  const steps: Step[] = legs.flatMap((l) =>
    (l.maneuvers ?? [])
      .filter((m) => typeof m.instruction === "string" && m.instruction.length > 0)
      .map((m) => ({
        text: m.instruction as string,
        distance: Math.round((m.length ?? 0) * 1000),
      })),
  );
  const elevation = legs.flatMap((l) => l.elevation ?? []);
  const seconds = Math.round(duration);
  const start =
    req.arriveBy && req.time !== undefined ? req.time - seconds * 1000 : (req.time ?? now);
  const end = start + seconds * 1000;
  const leg: Leg = {
    kind: req.mode === "bike" ? "bike" : "walk",
    vehicle: req.mode === "bike" ? "bike" : "foot",
    from: { name: req.from.name, lat: req.from.lat, lng: req.from.lng, departure: start },
    to: { name: req.to.name, lat: req.to.lat, lng: req.to.lng, arrival: end },
    start,
    end,
    scheduledStart: start,
    scheduledEnd: end,
    duration: seconds,
    distance: Math.round((trip.summary?.length ?? 0) * 1000),
    realTime: false,
    cancelled: false,
    stops: [],
    path,
    steps,
    alerts: [],
  };
  if (elevation.length > 1) {
    const c = climb(elevation);
    leg.elevation = elevation;
    leg.ascent = c.ascent;
    leg.descent = c.descent;
  }
  return {
    id: `${from.host}:${req.mode}:${index}`,
    start,
    end,
    duration: seconds,
    transfers: 0,
    legs: [leg],
    origin: from,
  };
}

const WALKING_SPEED = { slow: 3.6, normal: 5.1, fast: 6.4 } as const;

/** The traveller's preferences, in Valhalla's terms. */
export function costingOptions(req: PlanRequest): Record<string, number> {
  if (req.mode === "bike") return { use_hills: req.avoidHills ? 0.1 : 0.5 };
  return {
    walking_speed: WALKING_SPEED[req.pace ?? "normal"],
    ...(req.stepFree ? { step_penalty: 600, max_grade: 6 } : {}),
  };
}

export async function route(req: PlanRequest): Promise<Itinerary[]> {
  const costing = req.mode === "bike" ? "bicycle" : "pedestrian";
  const body = {
    locations: [
      { lat: req.from.lat, lon: req.from.lng },
      { lat: req.to.lat, lon: req.to.lng },
    ],
    costing,
    costing_options: { [costing]: costingOptions(req) },
    units: "kilometers",
    language: locale(),
    alternates: 2,
    elevation_interval: 30,
  };
  const url = new URL(`${endpoint("valhalla")}/route`);
  url.searchParams.set("json", JSON.stringify(body));
  const json = await getJson<Answer>(url, {
    service: SERVICE,
    signal: req.signal,
    headers: { "X-Client-Id": CLIENT_ID },
    minGap: 1000,
  });
  const from = origin();
  const now = Date.now();
  const trips = [json.trip, ...(json.alternates ?? []).map((a) => a.trip)];
  return trips
    .map((trip, i) => (trip ? toItinerary(trip, req, from, i, now) : null))
    .filter((it): it is Itinerary => it !== null);
}

export const valhallaRouter: Router = {
  get origin() {
    return origin();
  },
  modes: ["bike", "walk"],
  plan: route,
};
