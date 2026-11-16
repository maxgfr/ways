/**
 * Trips computed on the device, from a downloaded region: on the street graph
 * for bike and foot, on the day's timetable for public transport, with the
 * walk to the first stop and from the last. Nothing here touches the network.
 *
 * Times come from the timetable alone: there is no live data in a region.
 */
import {
  RangeQuery,
  type Router,
  type Stop,
  type StopsIndex,
  type Route as TransitRoute,
} from "minotor";
import { distance } from "../geo/polyline";
import { type MessageKey, t } from "../i18n";
import type {
  Itinerary,
  Leg,
  Line,
  Origin,
  PlanRequest,
  Point,
  Step,
  Vehicle,
} from "../providers/types";
import {
  BIKE_SPEED,
  type Graph,
  type Index,
  type Manoeuvre,
  nearestNode,
  route as streetRoute,
  type Turn,
  WALK_SPEED,
} from "./graph";
import { addDays, fromServiceTime, toServiceTime } from "./time";

export const DEVICE: Origin = { name: "This device", host: "device" };

export interface LineColours {
  color?: string;
  textColor?: string;
}

/** Everything a region holds, once loaded in memory. */
export interface RegionData {
  timezone: string;
  graph: Graph;
  index: Index;
  stops: StopsIndex;
  lines: Record<string, LineColours>;
  /** The router over a service day's timetable, or null when the region does not cover that day. */
  router(date: string): Router | null;
}

const PACE = { slow: 1.0, normal: WALK_SPEED, fast: 1.78 } as const;
/** How much longer a walk is than the straight line, when the streets are not consulted. */
const DETOUR = 1.3;
/** How far from a point a stop is still worth walking to, in kilometres. */
const REACH_KM = 0.9;
const WINDOW_MIN = 90;

const TURN_KEYS: Record<Turn, MessageKey> = {
  depart: "step.depart",
  continue: "step.continue",
  left: "step.left",
  right: "step.right",
  slightLeft: "step.slightLeft",
  slightRight: "step.slightRight",
  hardLeft: "step.hardLeft",
  hardRight: "step.hardRight",
  uturn: "step.uturn",
  stairs: "step.stairs",
};

export function toSteps(manoeuvres: Manoeuvre[]): Step[] {
  return manoeuvres.map((m) => {
    const action = t(TURN_KEYS[m.turn]);
    return {
      text: m.street ? t("step.onto", { action, street: m.street }) : action,
      distance: Math.round(m.distance),
      turn: m.turn,
    };
  });
}

function walkSpeed(req: PlanRequest): number {
  return PACE[req.pace ?? "normal"];
}

/**
 * One leg on foot or by bike between two points, starting at `start`. Follows
 * the streets when both ends are near one; otherwise the straight line, made
 * longer by the usual detour.
 */
export function streetLeg(
  data: Pick<RegionData, "graph" | "index">,
  from: Point,
  to: Point,
  mode: "walk" | "bike",
  start: number,
  req: PlanRequest,
): Leg {
  const speed = mode === "walk" ? walkSpeed(req) : BIKE_SPEED;
  const a = nearestNode(data.graph, data.index, from.lat, from.lng, mode);
  const b = nearestNode(data.graph, data.index, to.lat, to.lng, mode);
  const found =
    a !== -1 && b !== -1
      ? streetRoute(data.graph, a, b, mode, {
          walkSpeed: walkSpeed(req),
          ...(req.stepFree ? { stepFree: true } : {}),
        })
      : null;
  const ends: [number, number][] = [
    [from.lng, from.lat],
    [to.lng, to.lat],
  ];
  let path = ends;
  let metres = distance(ends[0] as [number, number], ends[1] as [number, number]) * DETOUR;
  let seconds = metres / speed;
  let steps: Step[] = [];
  if (found && found.path.length > 0) {
    const first = found.path[0] as [number, number];
    const last = found.path[found.path.length - 1] as [number, number];
    // From the point to the street and from the street to the point, at walking pace.
    const offStreet =
      distance(ends[0] as [number, number], first) + distance(last, ends[1] as [number, number]);
    path = [ends[0] as [number, number], ...found.path, ends[1] as [number, number]];
    metres = found.distance + offStreet;
    seconds = found.duration + offStreet / walkSpeed(req);
    steps = toSteps(found.manoeuvres);
  }
  const duration = Math.max(1, Math.round(seconds));
  const end = start + duration * 1000;
  return {
    kind: mode,
    vehicle: mode === "bike" ? "bike" : "foot",
    from: { name: from.name, lat: from.lat, lng: from.lng, departure: start },
    to: { name: to.name, lat: to.lat, lng: to.lng, arrival: end },
    start,
    end,
    scheduledStart: start,
    scheduledEnd: end,
    duration,
    distance: Math.round(metres),
    realTime: false,
    cancelled: false,
    stops: [],
    path,
    steps,
    alerts: [],
  };
}

/** A trip by bike or on foot, as one leg. */
export function planStreet(data: RegionData, req: PlanRequest, now: number): Itinerary[] {
  const mode = req.mode === "bike" ? "bike" : "walk";
  let leg = streetLeg(data, req.from, req.to, mode, req.time ?? now, req);
  if (req.arriveBy && req.time !== undefined)
    leg = streetLeg(data, req.from, req.to, mode, req.time - leg.duration * 1000, req);
  return [
    {
      id: `device:${mode}:${leg.start}`,
      start: leg.start,
      end: leg.end,
      duration: leg.duration,
      transfers: 0,
      legs: [leg],
      origin: DEVICE,
    },
  ];
}

const VEHICLES: Record<number, Vehicle> = {
  1: "tram",
  2: "subway",
  3: "rail",
  4: "bus",
  5: "ferry",
  6: "cable",
  7: "cable",
  8: "cable",
  9: "bus",
  10: "rail",
};

interface Near {
  stop: Stop;
  /** Minutes on foot between the point and the stop, rounded up. */
  minutes: number;
}

/** The stops within walking reach of a point, nearest first. */
export function stopsNear(stops: StopsIndex, at: Point, speed: number, max: number): Near[] {
  const here: [number, number] = [at.lng, at.lat];
  return stops
    .findStopsByLocation(at.lat, at.lng, max, REACH_KM)
    .filter((s) => s.lat !== undefined && s.lon !== undefined)
    .map((stop) => ({
      stop,
      minutes: Math.ceil(
        (distance(here, [stop.lon as number, stop.lat as number]) * DETOUR) / speed / 60,
      ),
    }));
}

interface Candidate {
  route: TransitRoute;
  access: Near;
  egressMinutes: number;
  /** Minutes of the service day: leaving the origin, reaching the destination. */
  leave: number;
  arrive: number;
}

/** Keeps the trips no other trip beats: one that leaves no earlier and arrives no later. */
export function pareto<T extends { leave: number; arrive: number }>(list: T[]): T[] {
  return list.filter(
    (a) =>
      !list.some(
        (b) =>
          b !== a &&
          b.leave >= a.leave &&
          b.arrive <= a.arrive &&
          (b.leave > a.leave || b.arrive < a.arrive || list.indexOf(b) < list.indexOf(a)),
      ),
  );
}

function stopPoint(stop: Stop): Point {
  return { lat: stop.lat ?? 0, lng: stop.lon ?? 0, name: stop.name };
}

function toItinerary(data: RegionData, c: Candidate, date: string, req: PlanRequest): Itinerary {
  const at = (minutes: number) => fromServiceTime(date, minutes, data.timezone);
  const legs: Leg[] = [];
  const first = c.route.legs[0];
  const last = c.route.legs[c.route.legs.length - 1];
  if (first) {
    const walk = streetLeg(data, req.from, stopPoint(first.from), "walk", at(c.leave), req);
    if (walk.distance !== undefined && walk.distance > 15) legs.push(walk);
  }
  for (const leg of c.route.legs) {
    if ("route" in leg) {
      const start = at(leg.departureTime);
      const end = at(leg.arrivalTime);
      const colours = data.lines[leg.route.name] ?? {};
      const line: Line = { name: leg.route.name, ...colours };
      legs.push({
        kind: "transit",
        vehicle: VEHICLES[leg.route.type] ?? "other",
        from: {
          name: leg.from.name,
          lat: leg.from.lat ?? 0,
          lng: leg.from.lon ?? 0,
          tz: data.timezone,
          departure: start,
          scheduledDeparture: start,
          ...(leg.from.platform ? { track: leg.from.platform } : {}),
        },
        to: {
          name: leg.to.name,
          lat: leg.to.lat ?? 0,
          lng: leg.to.lon ?? 0,
          tz: data.timezone,
          arrival: end,
          scheduledArrival: end,
        },
        start,
        end,
        scheduledStart: start,
        scheduledEnd: end,
        duration: Math.max(0, Math.round((end - start) / 1000)),
        realTime: false,
        cancelled: false,
        line,
        stops: [],
        path: [],
        steps: [],
        alerts: [],
      });
    } else {
      // A change on foot between two stops: it starts when the ride before it ends.
      const previous = legs[legs.length - 1];
      const from = stopPoint(leg.from);
      const to = stopPoint(leg.to);
      if (distance([from.lng, from.lat], [to.lng, to.lat]) < 20) continue;
      legs.push(streetLeg(data, from, to, "walk", previous?.end ?? at(c.leave), req));
    }
  }
  if (last) {
    const previous = legs[legs.length - 1];
    const walk = streetLeg(
      data,
      stopPoint(last.to),
      req.to,
      "walk",
      previous?.end ?? at(c.arrive),
      req,
    );
    if (walk.distance !== undefined && walk.distance > 15) legs.push(walk);
  }
  const start = legs[0]?.start ?? at(c.leave);
  const end = legs[legs.length - 1]?.end ?? at(c.arrive);
  const rides = legs.filter((l) => l.kind === "transit");
  return {
    id: `device:transit:${date}:${c.leave}:${c.arrive}:${rides.map((l) => l.line?.name).join(">")}`,
    start,
    end,
    duration: Math.max(0, Math.round((end - start) / 1000)),
    transfers: Math.max(0, rides.length - 1),
    legs,
    origin: DEVICE,
  };
}

/**
 * Trips by public transport. From each stop near the start, every trip that is
 * not beaten by another within the next hour and a half; the walks at both
 * ends are added, and the best five are kept.
 */
export function planTransit(data: RegionData, req: PlanRequest, now: number): Itinerary[] {
  const speed = walkSpeed(req);
  const asked = toServiceTime(req.time ?? now, data.timezone);
  // A trip asked for in the small hours may still be on yesterday's timetable, past 24:00.
  const days: { date: string; minutes: number }[] = [asked];
  if (asked.minutes < 4 * 60)
    days.unshift({ date: addDays(asked.date, -1), minutes: asked.minutes + 24 * 60 });

  const origins = stopsNear(data.stops, req.from, speed, 6);
  const ends = stopsNear(data.stops, req.to, speed, 8);
  if (origins.length === 0 || ends.length === 0) return [];
  const egress = new Map(ends.map((e) => [e.stop.id, e.minutes]));
  const targets = new Set(ends.map((e) => e.stop.id));

  for (const day of days) {
    const router = data.router(day.date);
    if (!router) continue;
    const from = req.arriveBy ? day.minutes - 150 : day.minutes;
    const until = req.arriveBy ? day.minutes : day.minutes + WINDOW_MIN;
    const found: Candidate[] = [];
    for (const access of origins.slice(0, 4)) {
      const query = new RangeQuery.Builder()
        .from(access.stop.id)
        .to(targets)
        // The window opens just before: a ride leaving at the very minute asked for counts.
        .departureTime(Math.max(0, from + access.minutes - 1))
        .lastDepartureTime(until + access.minutes)
        .maxTransfers(4)
        .build();
      let result: ReturnType<Router["rangeRoute"]>;
      try {
        result = router.rangeRoute(query);
      } catch {
        continue;
      }
      for (const route of result.routes()) {
        const last = route.legs[route.legs.length - 1];
        if (!last || !route.legs.some((l) => "route" in l)) continue;
        const egressMinutes = egress.get(last.to.id) ?? 0;
        const arrive = route.arrivalTime() + egressMinutes;
        if (req.arriveBy && arrive > day.minutes) continue;
        found.push({
          route,
          access,
          egressMinutes,
          leave: route.departureTime() - access.minutes,
          arrive,
        });
      }
    }
    if (found.length === 0) continue;
    const best = pareto(found).sort((a, b) =>
      req.arriveBy ? b.leave - a.leave : a.arrive - b.arrive || b.leave - a.leave,
    );
    return best.slice(0, 5).map((c) => toItinerary(data, c, day.date, req));
  }
  return [];
}

export function plan(data: RegionData, req: PlanRequest, now: number): Itinerary[] {
  return req.mode === "transit" ? planTransit(data, req, now) : planStreet(data, req, now);
}
