/**
 * Guidance along a trip, as pure arithmetic: given where the traveller is,
 * which leg they are on, what to do next and how far away it is, and how long
 * is left. The screen and the voice only read what this computes.
 */
import { distance, type Path, pathLength } from "../geo/polyline";
import { snap } from "../geo/progress";
import type { Itinerary, Leg, Line, StepTurn, Vehicle } from "../providers/types";

interface CourseLeg {
  leg: Leg;
  /** Metres from the start of the trip to the start of this leg. */
  start: number;
  length: number;
  /** Where each street instruction starts, in metres from the start of the leg. */
  stepAt: number[];
  /** Where each stop passed on the way is, in metres from the start of the leg. */
  stopAt: number[];
}

export interface Course {
  it: Itinerary;
  path: Path;
  legs: CourseLeg[];
  total: number;
}

export type Instruction =
  | { kind: "step"; text: string; vehicle: Vehicle; turn?: StepTurn }
  | { kind: "board"; line?: Line; vehicle: Vehicle; headsign?: string; stop: string }
  | { kind: "ride"; line?: Line; vehicle: Vehicle; getOff: string; stopsLeft: number }
  | { kind: "arrive"; place: string };

export interface Guidance {
  legIndex: number;
  along: number;
  /** Metres between the traveller and the trip. */
  offset: number;
  /** The heading of the trip where the traveller is, in degrees. */
  bearing: number;
  next: Instruction;
  /** Identifies `next`, so a new instruction can be told from the same one coming closer. */
  nextId: string;
  /** Metres to where `next` happens. */
  toNext: number;
  /** Metres left to the destination. */
  remaining: number;
  /** Expected arrival, epoch milliseconds. */
  eta: number;
  arrived: boolean;
}

/** A leg's path, or a straight line between its ends when the source gave none. */
function legPath(leg: Leg): Path {
  return leg.path.length > 1
    ? leg.path
    : [
        [leg.from.lng, leg.from.lat],
        [leg.to.lng, leg.to.lat],
      ];
}

export function courseOf(it: Itinerary): Course {
  const legs: CourseLeg[] = [];
  const path: Path = [];
  let start = 0;
  for (const leg of it.legs) {
    const p = legPath(leg);
    const length = pathLength(p);
    // Instructions are laid along the path by their share of the distance they announce.
    const said = leg.steps.reduce((sum, s) => sum + s.distance, 0);
    const scale = said > 0 ? length / said : 0;
    const stepAt: number[] = [];
    let walked = 0;
    for (const s of leg.steps) {
      stepAt.push(walked * scale);
      walked += s.distance;
    }
    const stopAt = leg.stops.map((s) => snap(p, [s.lng, s.lat])?.along ?? 0);
    legs.push({ leg, start, length, stepAt, stopAt });
    path.push(...p);
    start += length;
  }
  return { it, path, legs, total: start };
}

/** The leg a distance along the trip falls in. */
function legAt(course: Course, along: number): number {
  let i = 0;
  while (i + 1 < course.legs.length && (course.legs[i + 1] as CourseLeg).start <= along) i++;
  return i;
}

function nextAfterLeg(course: Course, i: number): Instruction {
  const following = course.legs[i + 1]?.leg;
  const last = course.legs[course.legs.length - 1]?.leg;
  if (following?.kind === "transit")
    return {
      kind: "board",
      vehicle: following.vehicle,
      stop: following.from.name,
      ...(following.line ? { line: following.line } : {}),
      ...(following.headsign ? { headsign: following.headsign } : {}),
    };
  return { kind: "arrive", place: last?.to.name ?? "" };
}

/** Within this many metres of the destination, the trip is over. */
export const ARRIVED_M = 25;

export function guide(
  course: Course,
  pos: readonly [number, number],
  now: number,
  hint?: number,
): Guidance | null {
  const on = snap(course.path, pos, hint);
  if (!on) return null;
  const i = legAt(course, on.along);
  const c = course.legs[i] as CourseLeg;
  const leg = c.leg;
  const local = Math.min(c.length, Math.max(0, on.along - c.start));
  let next: Instruction;
  let nextId: string;
  let toNext: number;
  if (leg.kind === "transit") {
    const waiting = local < 40 && now < leg.start + 60_000;
    if (waiting) {
      next = nextAfterLeg(course, i - 1);
      if (next.kind !== "board")
        next = { kind: "board", vehicle: leg.vehicle, stop: leg.from.name };
      nextId = `${i}:board`;
      toNext = 0;
    } else {
      const stopsLeft = c.stopAt.filter((at) => at > local + 30).length + 1;
      next = {
        kind: "ride",
        vehicle: leg.vehicle,
        getOff: leg.to.name,
        stopsLeft,
        ...(leg.line ? { line: leg.line } : {}),
      };
      nextId = `${i}:ride`;
      toNext = c.length - local;
    }
  } else {
    // The first instruction not yet passed; one just begun stays for ten metres.
    const j = c.stepAt.findIndex((at) => at > local - 10);
    const step = j >= 0 ? leg.steps[j] : undefined;
    if (step && j >= 0) {
      next = {
        kind: "step",
        text: step.text,
        vehicle: leg.vehicle,
        ...(step.turn ? { turn: step.turn } : {}),
      };
      nextId = `${i}:${j}`;
      toNext = Math.max(0, (c.stepAt[j] as number) - local);
    } else {
      next = nextAfterLeg(course, i);
      nextId = `${i}:end`;
      toNext = c.length - local;
    }
  }
  // Time left: the rest of this leg at its own pace, then the legs after it.
  const legLeft =
    leg.kind === "transit"
      ? Math.max(0, leg.end - now)
      : c.length > 0
        ? (1 - local / c.length) * leg.duration * 1000
        : 0;
  const after = course.legs.slice(i + 1).reduce((sum, l) => sum + l.leg.duration * 1000, 0);
  const rideAhead = course.legs.slice(i).some((l) => l.leg.kind === "transit");
  const eta = rideAhead ? Math.max(course.it.end, now + legLeft + after) : now + legLeft + after;
  const last = course.legs[course.legs.length - 1]?.leg;
  const goal: [number, number] | null = last ? [last.to.lng, last.to.lat] : null;
  const arrived =
    (goal !== null && distance(pos, goal) < ARRIVED_M) ||
    (on.along >= course.total - ARRIVED_M && on.offset < 40);
  return {
    legIndex: i,
    along: on.along,
    offset: on.offset,
    bearing: on.bearing,
    next,
    nextId,
    toNext,
    remaining: Math.max(0, course.total - on.along),
    eta,
    arrived,
  };
}
