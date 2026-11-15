/**
 * Transitous, the community-run MOTIS server: trips by public transport, bike
 * and foot, departures at a stop, the stops and vehicles of an area, shared
 * bikes, and a stop search. No key; its policy asks for light, identified use,
 * so trips are only requested when the user asks for them.
 *
 * Every answer is translated into the shapes of `types.ts`. Fields the server
 * may add or drop are read defensively: an unknown mode is "other", a missing
 * colour is no colour.
 */

import { endpoint, hostOf } from "../app/prefs";
import { decodePolyline, distance } from "../geo/polyline";
import { lang, type MessageKey, t } from "../i18n";
import { getJson } from "./http";
import type {
  Alert,
  Call,
  Departure,
  Itinerary,
  Leg,
  LegKind,
  Line,
  LiveTrip,
  Origin,
  PlanRequest,
  Point,
  RentalStation,
  RentalVehicle,
  Router,
  Step,
  Stop,
  TravelMode,
  Vehicle,
} from "./types";
import { ServiceError } from "./types";

export const SERVICE = "Transitous";

const VEHICLES: Record<string, Vehicle> = {
  WALK: "foot",
  BIKE: "bike",
  CAR: "car",
  CAR_PARKING: "car",
  CAR_DROPOFF: "car",
  ODM: "car",
  RIDE_SHARING: "car",
  FLEX: "bus",
  BUS: "bus",
  COACH: "bus",
  TRAM: "tram",
  SUBWAY: "subway",
  METRO: "subway",
  RAIL: "rail",
  SUBURBAN: "rail",
  HIGHSPEED_RAIL: "rail",
  LONG_DISTANCE: "rail",
  NIGHT_RAIL: "rail",
  REGIONAL_FAST_RAIL: "rail",
  REGIONAL_RAIL: "rail",
  FERRY: "ferry",
  CABLE_CAR: "cable",
  FUNICULAR: "cable",
  AERIAL_LIFT: "cable",
  AREAL_LIFT: "cable",
  AIRPLANE: "plane",
};

const FORM_FACTORS: Record<string, Vehicle> = {
  BICYCLE: "bike",
  CARGO_BICYCLE: "bike",
  SCOOTER_STANDING: "scooter",
  SCOOTER_SEATED: "scooter",
  MOPED: "scooter",
  CAR: "car",
};

export function vehicleOf(mode: unknown, formFactor?: unknown): Vehicle {
  if (mode === "RENTAL") return FORM_FACTORS[String(formFactor)] ?? "bike";
  return VEHICLES[String(mode)] ?? "other";
}

function kindOf(mode: unknown): LegKind {
  switch (mode) {
    case "WALK":
      return "walk";
    case "BIKE":
      return "bike";
    case "RENTAL":
      return "rental";
    case "CAR":
    case "CAR_PARKING":
    case "CAR_DROPOFF":
      return "car";
    default:
      return "transit";
  }
}

function ms(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** "#rrggbb" from the bare hex a GTFS feed carries, or nothing when it is not one. */
export function hexColor(v: unknown): string | undefined {
  const s = str(v)?.replace(/^#/, "");
  return s && /^[0-9a-f]{6}$/i.test(s) ? `#${s.toLowerCase()}` : undefined;
}

type Raw = Record<string, unknown>;

function obj(v: unknown): Raw {
  return v && typeof v === "object" ? (v as Raw) : {};
}

function list(v: unknown): Raw[] {
  return Array.isArray(v) ? v.map(obj) : [];
}

function toCall(v: unknown): Call {
  const p = obj(v);
  const name = str(p.name) ?? "";
  const call: Call = { name, lat: num(p.lat) ?? 0, lng: num(p.lon) ?? 0 };
  const stopId = str(p.stopId);
  if (stopId) call.stopId = stopId;
  const tz = str(p.tz);
  if (tz) call.tz = tz;
  const track = str(p.track) ?? str(p.scheduledTrack);
  if (track) call.track = track;
  const arrival = ms(p.arrival);
  if (arrival !== undefined) call.arrival = arrival;
  const departure = ms(p.departure);
  if (departure !== undefined) call.departure = departure;
  const sa = ms(p.scheduledArrival);
  if (sa !== undefined) call.scheduledArrival = sa;
  const sd = ms(p.scheduledDeparture);
  if (sd !== undefined) call.scheduledDeparture = sd;
  if (p.cancelled === true) call.cancelled = true;
  return call;
}

function toAlerts(...sources: unknown[]): Alert[] {
  const seen = new Set<string>();
  const out: Alert[] = [];
  for (const source of sources) {
    for (const a of list(source)) {
      const title = str(a.headerText) ?? "";
      const text = str(a.descriptionText) ?? "";
      if (!title && !text) continue;
      const key = `${title}\n${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const url = str(a.url);
      out.push({ title, text, ...(url ? { url } : {}) });
    }
  }
  return out;
}

function toLine(r: Raw): Line {
  const name =
    str(r.displayName) ??
    str(r.routeShortName) ??
    str(r.tripShortName) ??
    str(r.routeLongName) ??
    "";
  const line: Line = { name };
  const longName = str(r.routeLongName);
  if (longName && longName !== name) line.longName = longName;
  const color = hexColor(r.routeColor);
  if (color) line.color = color;
  const textColor = hexColor(r.routeTextColor);
  if (textColor) line.textColor = textColor;
  const agency = str(r.agencyName);
  if (agency) line.agency = agency;
  return line;
}

const STEP_KEYS: Record<string, MessageKey> = {
  DEPART: "step.depart",
  CONTINUE: "step.continue",
  LEFT: "step.left",
  RIGHT: "step.right",
  SLIGHTLY_LEFT: "step.slightLeft",
  SLIGHTLY_RIGHT: "step.slightRight",
  HARD_LEFT: "step.hardLeft",
  HARD_RIGHT: "step.hardRight",
  UTURN_LEFT: "step.uturn",
  UTURN_RIGHT: "step.uturn",
  CIRCLE_CLOCKWISE: "step.roundabout",
  CIRCLE_COUNTERCLOCKWISE: "step.roundabout",
  STAIRS: "step.stairs",
  ELEVATOR: "step.elevator",
};

/** Street steps as sentences, merging the stretches that go straight on along the same street. */
function toSteps(raw: unknown): Step[] {
  const out: Step[] = [];
  for (const s of list(raw)) {
    const dir = String(s.relativeDirection ?? "CONTINUE");
    const street = str(s.streetName);
    const distance = num(s.distance) ?? 0;
    const prev = out[out.length - 1];
    if (dir === "CONTINUE" && prev && (s.stayOn === true || !street)) {
      prev.distance += distance;
      continue;
    }
    const action = t(STEP_KEYS[dir] ?? "step.continue");
    out.push({ text: street ? t("step.onto", { action, street }) : action, distance });
  }
  return out;
}

export function toLeg(v: unknown): Leg {
  const r = obj(v);
  const rental = obj(r.rental);
  const kind = kindOf(r.mode);
  const from = toCall(r.from);
  const to = toCall(r.to);
  const start = ms(r.startTime) ?? from.departure ?? 0;
  const end = ms(r.endTime) ?? to.arrival ?? start;
  const geometry = obj(r.legGeometry);
  const points = str(geometry.points);
  const steps = list(r.steps);
  let ascent = 0;
  let descent = 0;
  for (const s of steps) {
    ascent += num(s.elevationUp) ?? 0;
    descent += num(s.elevationDown) ?? 0;
  }
  const leg: Leg = {
    kind,
    vehicle: vehicleOf(r.mode, rental.formFactor),
    from,
    to,
    start,
    end,
    scheduledStart: ms(r.scheduledStartTime) ?? start,
    scheduledEnd: ms(r.scheduledEndTime) ?? end,
    duration: num(r.duration) ?? Math.max(0, Math.round((end - start) / 1000)),
    realTime: r.realTime === true,
    cancelled: r.cancelled === true,
    stops: list(r.intermediateStops).map(toCall),
    path: points ? decodePolyline(points, num(geometry.precision) ?? 6) : [],
    steps: kind === "transit" ? [] : toSteps(r.steps),
    alerts: toAlerts(r.alerts, obj(r.from).alerts, obj(r.to).alerts),
  };
  const distance = num(r.distance);
  if (distance !== undefined) leg.distance = distance;
  if (kind === "transit") {
    leg.line = toLine(r);
    const headsign = str(r.headsign);
    if (headsign) leg.headsign = headsign;
    const tripId = str(r.tripId);
    if (tripId) leg.tripId = tripId;
  }
  if (kind === "rental") {
    const provider =
      str(rental.systemName) ?? str(rental.providerGroupId) ?? str(rental.providerId);
    if (provider) leg.rentalProvider = provider;
  }
  if (ascent > 0) leg.ascent = Math.round(ascent);
  if (descent > 0) leg.descent = Math.round(descent);
  return leg;
}

export function origin(): Origin {
  return { name: SERVICE, host: hostOf("motis") };
}

export function toItinerary(v: unknown, from: Origin, index = 0): Itinerary {
  const r = obj(v);
  const legs = list(r.legs).map(toLeg);
  const start = ms(r.startTime) ?? legs[0]?.start ?? 0;
  const end = ms(r.endTime) ?? legs[legs.length - 1]?.end ?? start;
  return {
    id: str(r.id) ?? `${from.host}:${start}:${index}`,
    start,
    end,
    duration: num(r.duration) ?? Math.max(0, Math.round((end - start) / 1000)),
    transfers: num(r.transfers) ?? Math.max(0, legs.filter((l) => l.kind === "transit").length - 1),
    legs,
    origin: from,
  };
}

/**
 * The server calls the ends of a trip asked by position "START" and "END": they are given back
 * the names the user knows them by.
 */
export function nameEnds(it: Itinerary, from: Point, to: Point): Itinerary {
  const first = it.legs[0];
  const last = it.legs[it.legs.length - 1];
  if (first && (first.from.name === "START" || !first.from.name)) first.from.name = from.name;
  if (last && (last.to.name === "END" || !last.to.name)) last.to.name = to.name;
  return it;
}

function place(p: Point, useStop: boolean): string {
  return useStop && p.stopId ? p.stopId : `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

function api(path: string, params: Record<string, string | undefined>): URL {
  const url = new URL(`${endpoint("motis")}${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url;
}

const DIRECT: Record<TravelMode, string> = { transit: "WALK", bike: "BIKE", walk: "WALK" };

async function planOnce(req: PlanRequest, useStops: boolean): Promise<Itinerary[]> {
  const url = api("/api/v6/plan", {
    fromPlace: place(req.from, useStops),
    toPlace: place(req.to, useStops),
    directModes: DIRECT[req.mode],
    // An empty list of transit modes asks for the street route alone.
    transitModes: req.mode === "transit" ? undefined : "",
    time: req.time !== undefined ? new Date(req.time).toISOString() : undefined,
    arriveBy: req.arriveBy ? "true" : undefined,
    numItineraries: req.mode === "transit" ? "5" : undefined,
    pedestrianProfile: req.stepFree ? "WHEELCHAIR" : undefined,
    elevationCosts: req.mode === "bike" && req.avoidHills ? "HIGH" : undefined,
    language: lang.value,
  });
  const json = await getJson<Raw>(url, { service: SERVICE, signal: req.signal });
  const from = origin();
  const named = (it: Itinerary) => nameEnds(it, req.from, req.to);
  const direct = list(json.direct).map((d, i) => named(toItinerary(d, from, i)));
  if (req.mode !== "transit") return direct;
  const itineraries = list(json.itineraries).map((it, i) => named(toItinerary(it, from, i)));
  // A walk that beats every ride is worth showing beside them.
  const best = Math.min(...itineraries.map((it) => it.duration), Infinity);
  const walks = direct.filter((d) => d.duration <= Math.max(best, 20 * 60));
  return [...itineraries, ...walks].sort((a, b) => a.end - b.end);
}

/** Trips between two points. A stop id the server no longer knows falls back to its position. */
export async function plan(req: PlanRequest): Promise<Itinerary[]> {
  const hasStop = Boolean(req.from.stopId || req.to.stopId);
  try {
    return await planOnce(req, true);
  } catch (err) {
    if (hasStop && err instanceof ServiceError && err.status >= 400 && err.status < 500) {
      return planOnce(req, false);
    }
    throw err;
  }
}

export const motisRouter: Router = {
  get origin() {
    return origin();
  },
  modes: ["transit", "bike", "walk"],
  plan,
};

export function toDeparture(v: unknown): Departure | null {
  const r = obj(v);
  const p = obj(r.place);
  const time = ms(p.departure) ?? ms(p.arrival);
  if (time === undefined) return null;
  const dep: Departure = {
    time,
    scheduled: ms(p.scheduledDeparture) ?? ms(p.scheduledArrival) ?? time,
    realTime: r.realTime === true,
    cancelled: r.cancelled === true || r.tripCancelled === true || p.cancelled === true,
    line: toLine(r),
    vehicle: vehicleOf(r.mode),
    headsign: str(r.headsign) ?? str(obj(r.tripTo).name) ?? "",
    stopName: str(p.name) ?? "",
    alerts: toAlerts(r.alerts, p.alerts),
  };
  const stopId = str(p.stopId);
  if (stopId) dep.stopId = stopId;
  const tz = str(p.tz);
  if (tz) dep.tz = tz;
  const track = str(p.track) ?? str(p.scheduledTrack);
  if (track) dep.track = track;
  const tripId = str(r.tripId);
  if (tripId) dep.tripId = tripId;
  return dep;
}

/**
 * The next departures at a stop. Asked by position as well as by id, because
 * stop ids change when an operator republishes its timetable.
 */
export async function departures(
  stop: { stopId?: string | undefined; lat: number; lng: number },
  opts: { signal?: AbortSignal; count?: number } = {},
): Promise<Departure[]> {
  const common = { n: String(opts.count ?? 12), withAlerts: "true", language: lang.value };
  const byPosition = () =>
    getJson<Raw>(
      api("/api/v6/stoptimes", {
        center: `${stop.lat.toFixed(6)},${stop.lng.toFixed(6)}`,
        radius: "150",
        ...common,
      }),
      { service: SERVICE, signal: opts.signal },
    );
  let json: Raw;
  if (stop.stopId) {
    try {
      json = await getJson<Raw>(api("/api/v6/stoptimes", { stopId: stop.stopId, ...common }), {
        service: SERVICE,
        signal: opts.signal,
      });
    } catch (err) {
      if (!(err instanceof ServiceError) || err.status < 400 || err.status >= 500) throw err;
      json = await byPosition();
    }
  } else json = await byPosition();
  return list(json.stopTimes)
    .map(toDeparture)
    .filter((d): d is Departure => d !== null)
    .sort((a, b) => a.time - b.time);
}

export function toStop(v: unknown): Stop | null {
  const r = obj(v);
  const id = str(r.stopId);
  const lat = num(r.lat);
  const lng = num(r.lon);
  if (!id || lat === undefined || lng === undefined) return null;
  const stop: Stop = {
    id,
    name: str(r.name) ?? "",
    lat,
    lng,
    vehicles: [...new Set((Array.isArray(r.modes) ? r.modes : []).map((m) => vehicleOf(m)))],
  };
  const parentId = str(r.parentId);
  if (parentId) stop.parentId = parentId;
  return stop;
}

/** How far apart two platforms of the same name can be and still be one station, in metres. */
const SAME_STATION = 150;

/**
 * One entry per station. Platforms that share a parent are one station; so are
 * platforms of the same name a street apart, which many feeds publish without
 * a parent. The entry keeps the id of the first platform found.
 */
export function groupStops(stops: Stop[]): Stop[] {
  const groups: {
    id: string;
    name: string;
    members: Stop[];
    lat: number;
    lng: number;
    parent: boolean;
  }[] = [];
  const byParent = new Map<string, number>();
  const byName = new Map<string, number[]>();
  for (const s of stops) {
    let index = s.parentId !== undefined ? byParent.get(s.parentId) : undefined;
    if (index === undefined) {
      index = (byName.get(s.name) ?? []).find((i) => {
        const g = groups[i];
        return g !== undefined && distance([g.lng, g.lat], [s.lng, s.lat]) <= SAME_STATION;
      });
    }
    if (index === undefined) {
      index = groups.length;
      groups.push({
        id: s.parentId ?? s.id,
        name: s.name,
        members: [],
        lat: s.lat,
        lng: s.lng,
        parent: s.parentId !== undefined,
      });
      byName.set(s.name, [...(byName.get(s.name) ?? []), index]);
    }
    if (s.parentId !== undefined) byParent.set(s.parentId, index);
    groups[index]?.members.push(s);
  }
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    lat: g.members.reduce((sum, s) => sum + s.lat, 0) / g.members.length,
    lng: g.members.reduce((sum, s) => sum + s.lng, 0) / g.members.length,
    vehicles: [...new Set(g.members.flatMap((s) => s.vehicles))],
    whole: g.members.length === 1 || (g.parent && g.members.every((s) => s.parentId === g.id)),
  }));
}

export interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** The stops inside a box of the map. */
export async function stopsIn(box: Box, signal?: AbortSignal): Promise<Stop[]> {
  const json = await getJson<unknown>(
    api("/api/v6/map/stops", {
      min: `${box.north.toFixed(5)},${box.west.toFixed(5)}`,
      max: `${box.south.toFixed(5)},${box.east.toFixed(5)}`,
    }),
    { service: SERVICE, signal },
  );
  return groupStops(
    list(json)
      .map(toStop)
      .filter((s): s is Stop => s !== null),
  );
}

export function toLiveTrip(v: unknown, precision: number): LiveTrip | null {
  const r = obj(v);
  const first = list(r.trips)[0];
  const departure = ms(r.departure);
  const arrival = ms(r.arrival);
  const points = str(r.polyline);
  if (!first || departure === undefined || arrival === undefined || !points) return null;
  const trip: LiveTrip = {
    tripId: str(first.tripId) ?? "",
    name: str(first.displayName) ?? str(first.routeShortName) ?? "",
    vehicle: vehicleOf(r.mode),
    realTime: r.realTime === true,
    departure,
    arrival,
    path: decodePolyline(points, precision),
  };
  const color = hexColor(r.routeColor);
  if (color) trip.color = color;
  return trip;
}

/** The vehicles running through a box during a time window, each with the stretch it covers. */
export async function tripsIn(
  box: Box,
  zoom: number,
  window: { start: number; end: number },
  signal?: AbortSignal,
): Promise<LiveTrip[]> {
  const precision = 5;
  const json = await getJson<unknown>(
    api("/api/v6/map/trips", {
      zoom: String(Math.round(zoom)),
      min: `${box.north.toFixed(5)},${box.west.toFixed(5)}`,
      max: `${box.south.toFixed(5)},${box.east.toFixed(5)}`,
      startTime: new Date(window.start).toISOString(),
      endTime: new Date(window.end).toISOString(),
      precision: String(precision),
    }),
    { service: SERVICE, signal },
  );
  return list(json)
    .map((t) => toLiveTrip(t, precision))
    .filter((t): t is LiveTrip => t !== null);
}

/**
 * One run of a line from its first stop to its last, to draw it and list its
 * stops. A vehicle that chains several runs in a day is asked for run by run,
 * and only the one named is kept.
 */
export async function trip(tripId: string, signal?: AbortSignal): Promise<Leg | null> {
  const json = await getJson<Raw>(
    api("/api/v6/trip", { tripId, joinInterlinedLegs: "false", language: lang.value }),
    { service: SERVICE, signal },
  );
  const runs = list(json.legs).filter((l) => kindOf(l.mode) === "transit");
  const run = runs.find((l) => l.tripId === tripId) ?? runs[0];
  return run ? toLeg(run) : null;
}

export function toRentals(v: unknown): { stations: RentalStation[]; vehicles: RentalVehicle[] } {
  const r = obj(v);
  const names = new Map<string, string>();
  for (const p of list(r.providers)) {
    const id = str(p.id);
    if (id) names.set(id, str(p.name) ?? str(p.groupId) ?? id);
  }
  const provider = (x: Raw) =>
    names.get(String(x.providerId)) ?? str(x.providerGroupId) ?? str(x.providerId) ?? "";
  const stations: RentalStation[] = [];
  for (const s of list(r.stations)) {
    const id = str(s.id);
    const lat = num(s.lat);
    const lng = num(s.lon);
    const forms = Array.isArray(s.formFactors) ? s.formFactors : [];
    const vehicle = FORM_FACTORS[String(forms[0])] ?? "bike";
    if (!id || lat === undefined || lng === undefined || vehicle === "car") continue;
    const docks = Object.values(obj(s.vehicleDocksAvailable)).reduce<number>(
      (sum, n) => sum + (num(n) ?? 0),
      0,
    );
    const station: RentalStation = {
      id: `${String(s.providerId)}:${id}`,
      name: str(s.name) ?? "",
      lat,
      lng,
      provider: provider(s),
      vehicle,
      available: num(s.numVehiclesAvailable) ?? 0,
      renting: s.isRenting !== false,
      returning: s.isReturning !== false,
    };
    if (Object.keys(obj(s.vehicleDocksAvailable)).length > 0) station.docks = docks;
    stations.push(station);
  }
  const vehicles: RentalVehicle[] = [];
  for (const x of list(r.vehicles)) {
    const id = str(x.id);
    const lat = num(x.lat);
    const lng = num(x.lon);
    const vehicle = FORM_FACTORS[String(x.formFactor)] ?? "bike";
    // Docked vehicles are counted by their station; cars are out of scope.
    if (!id || lat === undefined || lng === undefined || vehicle === "car") continue;
    if (str(x.stationId) || x.isReserved === true || x.isDisabled === true) continue;
    vehicles.push({
      id: `${String(x.providerId)}:${id}`,
      lat,
      lng,
      provider: provider(x),
      vehicle,
    });
  }
  return { stations, vehicles };
}

/** Shared bikes and scooters around a point: stations with what they hold, and loose vehicles. */
export async function rentalsNear(
  at: { lat: number; lng: number },
  radius: number,
  signal?: AbortSignal,
): Promise<{ stations: RentalStation[]; vehicles: RentalVehicle[] }> {
  const json = await getJson<unknown>(
    api("/api/v1/rentals", {
      point: `${at.lat.toFixed(5)},${at.lng.toFixed(5)}`,
      radius: String(Math.round(radius)),
      withProviders: "true",
      withStations: "true",
      withVehicles: "true",
      withZones: "false",
    }),
    { service: SERVICE, signal },
  );
  return toRentals(json);
}

export interface StopMatch extends Point {
  stopId: string;
  /** The town or district the stop is in, to tell two stops of the same name apart. */
  area: string;
  vehicles: Vehicle[];
}

export function toStopMatch(v: unknown): StopMatch | null {
  const r = obj(v);
  const id = str(r.id);
  const lat = num(r.lat);
  const lng = num(r.lon);
  const name = str(r.name);
  if (r.type !== "STOP" || !id || !name || lat === undefined || lng === undefined) return null;
  const areas = list(r.areas);
  const area = str(
    (areas.find((a) => a.default === true) ?? areas.find((a) => a.matched === true))?.name,
  );
  return {
    stopId: id,
    name,
    lat,
    lng,
    area: area ?? "",
    vehicles: [...new Set((Array.isArray(r.modes) ? r.modes : []).map((m) => vehicleOf(m)))],
  };
}

/** Stops whose name matches, nearest to `near` first. */
export async function searchStops(
  text: string,
  opts: { near?: [number, number]; signal?: AbortSignal } = {},
): Promise<StopMatch[]> {
  const json = await getJson<unknown>(
    api("/api/v1/geocode", {
      text,
      type: "STOP",
      language: lang.value,
      place: opts.near ? `${opts.near[1].toFixed(5)},${opts.near[0].toFixed(5)}` : undefined,
      placeBias: opts.near ? "2" : undefined,
    }),
    { service: SERVICE, signal: opts.signal },
  );
  return list(json)
    .map(toStopMatch)
    .filter((s): s is StopMatch => s !== null)
    .slice(0, 5);
}
