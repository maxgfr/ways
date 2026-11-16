/**
 * The model every data source is translated into. Screens and the map only
 * know these shapes, so a service can be swapped (another MOTIS server, a
 * routing engine running in the browser) without touching them.
 */
import type { Pace, TravelMode } from "../app/prefs";
import type { Path } from "../geo/polyline";

/** A point with the name the user knows it by. */
export interface Point {
  lat: number;
  lng: number;
  name: string;
  /** Set when the point is a public transport stop. */
  stopId?: string;
}

/** What carries the traveller on a leg, the way a rider would name it. */
export type Vehicle =
  | "foot"
  | "bike"
  | "scooter"
  | "car"
  | "bus"
  | "tram"
  | "subway"
  | "rail"
  | "ferry"
  | "cable"
  | "plane"
  | "other";

/** How a leg is travelled: on one's own, on a shared vehicle, or on public transport. */
export type LegKind = "walk" | "bike" | "rental" | "car" | "transit";

/** A public transport line as its operator publishes it. */
export interface Line {
  /** The short name printed on vehicles and signs ("11", "a", "TGV 8086"). */
  name: string;
  longName?: string;
  /** Operator colours as #rrggbb, when the feed gives them. */
  color?: string;
  textColor?: string;
  agency?: string;
}

export interface Alert {
  title: string;
  text: string;
  url?: string;
}

/** A stop as a leg passes it: the place, and when. Times are epoch milliseconds. */
export interface Call {
  name: string;
  lat: number;
  lng: number;
  stopId?: string;
  /** IANA time zone of the stop, to print its clock rather than the device's. */
  tz?: string;
  track?: string;
  arrival?: number;
  departure?: number;
  scheduledArrival?: number;
  scheduledDeparture?: number;
  cancelled?: boolean;
}

/** One instruction along a street leg. */
export interface Step {
  /** A sentence in the user's language ("Turn left onto Rue de l'Horloge"). */
  text: string;
  /** Metres covered by this step. */
  distance: number;
}

export interface Leg {
  kind: LegKind;
  vehicle: Vehicle;
  from: Call;
  to: Call;
  /** Epoch milliseconds. */
  start: number;
  end: number;
  scheduledStart: number;
  scheduledEnd: number;
  /** Seconds. */
  duration: number;
  /** Metres, when the source measures it (street legs). */
  distance?: number;
  /** True when the times come from a live feed rather than the timetable. */
  realTime: boolean;
  cancelled: boolean;
  line?: Line;
  headsign?: string;
  tripId?: string;
  /** Stops passed without getting off. */
  stops: Call[];
  path: Path;
  steps: Step[];
  alerts: Alert[];
  /** Metres climbed and descended, when the source knows the terrain. */
  ascent?: number;
  descent?: number;
  /** Heights in metres along the path, evenly spaced, for a profile. */
  elevation?: number[];
  /** The sharing service of a rental leg ("LE vélo STAR"). */
  rentalProvider?: string;
}

/** Where an itinerary was computed, shown to the user beside it. */
export interface Origin {
  /** The engine's name as shown ("Transitous", "Valhalla (FOSSGIS)", "On device"). */
  name: string;
  /** Where the request went, or "device" when nothing left the browser. */
  host: string;
}

export interface Itinerary {
  id: string;
  /** Epoch milliseconds. */
  start: number;
  end: number;
  /** Seconds. */
  duration: number;
  transfers: number;
  legs: Leg[];
  origin: Origin;
}

export type { TravelMode } from "../app/prefs";

export interface PlanRequest {
  from: Point;
  to: Point;
  mode: TravelMode;
  /** By bike, prefer a flatter way. */
  avoidHills?: boolean;
  /** Walking pace. */
  pace?: Pace;
  /** Ramps and lifts only. */
  stepFree?: boolean;
  /** By car, keep off toll roads. */
  avoidTolls?: boolean;
  /** By car, keep off motorways. */
  avoidMotorways?: boolean;
  /** Epoch milliseconds; "now" when absent. */
  time?: number;
  /** True when `time` is the latest arrival rather than the earliest departure. */
  arriveBy?: boolean;
  signal?: AbortSignal;
}

/** Something that can answer a trip request. */
export interface Router {
  origin: Origin;
  /** The travel modes this router answers. */
  modes: TravelMode[];
  plan(req: PlanRequest): Promise<Itinerary[]>;
}

export interface Stop {
  id: string;
  /** The station a platform belongs to, when the feed groups them. */
  parentId?: string;
  name: string;
  lat: number;
  lng: number;
  vehicles: Vehicle[];
  /** True when `id` names the whole station; otherwise its departures are asked by position. */
  whole?: boolean;
}

export interface Departure {
  /** Epoch milliseconds. */
  time: number;
  scheduled: number;
  realTime: boolean;
  cancelled: boolean;
  line: Line;
  vehicle: Vehicle;
  headsign: string;
  stopName: string;
  stopId?: string;
  tz?: string;
  track?: string;
  tripId?: string;
  alerts: Alert[];
}

/** A docking station of a bike or scooter sharing service. */
export interface RentalStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  provider: string;
  vehicle: Vehicle;
  /** Vehicles that can be taken now. */
  available: number;
  /** Free docks, when the service reports them. */
  docks?: number;
  renting: boolean;
  returning: boolean;
}

/** A free-floating shared vehicle. */
export interface RentalVehicle {
  id: string;
  lat: number;
  lng: number;
  provider: string;
  vehicle: Vehicle;
}

/** A public transport vehicle in service, with the stretch it covers in a time window. */
export interface LiveTrip {
  tripId: string;
  name: string;
  vehicle: Vehicle;
  color?: string;
  realTime: boolean;
  /** Epoch milliseconds at the ends of `path`. */
  departure: number;
  arrival: number;
  path: Path;
}

/** A failed call to a named service, so the interface can say which one did not answer. */
export class ServiceError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `${service} answered ${status}`);
    this.name = "ServiceError";
  }
}

/** Raised instead of calling a service when the user chose local mode. */
export class LocalOnlyError extends Error {
  constructor(readonly service: string) {
    super(`${service} is not called in local mode`);
    this.name = "LocalOnlyError";
  }
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
