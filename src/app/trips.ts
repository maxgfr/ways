/**
 * The trips of the directions screen: asked once both ends are known, when the
 * user picks a destination, changes the mode or the time. Never while typing.
 * Answers are kept for a minute so going back and forth does not ask again.
 */
import { computed, effect, signal } from "@preact/signals";
import { t } from "../i18n";
import { type PlanOutcome, planTrip } from "../providers/router";
import type { Itinerary, PlanRequest, Point } from "../providers/types";
import { isAbort } from "../providers/types";
import { engine, travel } from "./prefs";
import { guided, route, userPosition, type When, when } from "./state";

export type Trips =
  | { status: "idle" }
  /** The trip starts "where I am" and the position is not known yet. */
  | { status: "need-position" }
  | { status: "loading" }
  | { status: "done"; outcome: PlanOutcome };

export const trips = signal<Trips>({ status: "idle" });

const KEEP_MS = 60_000;
const kept = new Map<string, { at: number; outcome: PlanOutcome }>();
let running: AbortController | null = null;
let runningKey = "";

function pointKey(p: Point): string {
  return p.stopId ?? `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
}

/** What makes two requests the same one. */
export function requestKey(req: PlanRequest, eng: string, w: When): string {
  return [
    pointKey(req.from),
    pointKey(req.to),
    req.mode,
    w.kind === "now" ? "now" : `${w.kind}:${w.time}`,
    eng,
    req.avoidHills ? "flat" : "",
    req.pace ?? "",
    req.stepFree ? "stepfree" : "",
    req.avoidTolls ? "notolls" : "",
    req.avoidMotorways ? "nomotorways" : "",
  ].join("|");
}

/** The start of the trip in the address bar: the point given, or the user's position. */
export function resolveFrom(from: Point | null, me: [number, number] | null): Point | null {
  if (from) return from;
  return me ? { lat: me[1], lng: me[0], name: t("dir.myPosition") } : null;
}

/** Asks again, ignoring what was kept (the "try again" button). */
export function retryTrips(): void {
  kept.clear();
  runningKey = "";
  refresh();
}

function refresh(): void {
  const r = route.value;
  if (r.name !== "dir" || !r.to) {
    running?.abort();
    running = null;
    runningKey = "";
    if (trips.peek().status !== "idle") trips.value = { status: "idle" };
    return;
  }
  const from = resolveFrom(r.from, userPosition.value);
  if (!from) {
    trips.value = { status: "need-position" };
    return;
  }
  const w = when.value;
  const prefs = travel.value;
  const req: PlanRequest = {
    from,
    to: r.to,
    mode: r.mode,
    ...(w.kind !== "now" ? { time: w.time, arriveBy: w.kind === "arrive" } : {}),
    avoidHills: prefs.avoidHills,
    pace: prefs.pace,
    stepFree: prefs.stepFree,
    avoidTolls: prefs.avoidTolls,
    avoidMotorways: prefs.avoidMotorways,
  };
  const eng = engine.value;
  const key = requestKey(req, eng, w);
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) {
    running?.abort();
    running = null;
    runningKey = key;
    trips.value = { status: "done", outcome: hit.outcome };
    return;
  }
  if (key === runningKey && running) return;
  running?.abort();
  const controller = new AbortController();
  running = controller;
  runningKey = key;
  trips.value = { status: "loading" };
  planTrip({ ...req, signal: controller.signal }, eng)
    .then((outcome) => {
      if (controller.signal.aborted) return;
      if (outcome.itineraries.length > 0) kept.set(key, { at: Date.now(), outcome });
      trips.value = { status: "done", outcome };
    })
    .catch((err) => {
      if (isAbort(err) || controller.signal.aborted) return;
      trips.value = {
        status: "done",
        outcome: { itineraries: [], failed: [], noRegion: false, noDeviceMode: false },
      };
    })
    .finally(() => {
      if (running === controller) running = null;
    });
}

if (typeof window !== "undefined") {
  // Moving along the street must not ask for the same trip again: once a trip from
  // "where I am" is shown, it stays until the user asks for another.
  let lastEnds = "";
  effect(() => {
    const r = route.value;
    // Subscribed so a change of time, engine or preference asks again.
    when.value;
    engine.value;
    travel.value;
    const ends =
      r.name === "dir"
        ? `${r.from ? pointKey(r.from) : "me"}>${r.to ? pointKey(r.to) : ""}>${r.mode}`
        : "";
    const needsMe = r.name === "dir" && !r.from;
    const me = needsMe ? userPosition.value : null;
    if (needsMe && me && ends === lastEnds && trips.peek().status === "done") return;
    lastEnds = ends;
    refresh();
  });
}

/** The itinerary drawn on the map: the one followed, the one opened in detail, or the first of the list. */
export const shownItinerary = computed<Itinerary | null>(() => {
  const r = route.value;
  const followed = guided.value;
  if (r.name === "go") return followed?.it ?? null;
  const s = trips.value;
  if (r.name !== "dir" || s.status !== "done") return null;
  return s.outcome.itineraries[r.pick ?? 0] ?? null;
});

/** A line's whole run, shown when a departure is opened at a stop. */
export const shownTrip = signal<import("../providers/types").Leg | null>(null);
