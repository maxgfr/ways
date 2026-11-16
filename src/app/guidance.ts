/**
 * Following a trip as it happens: the position is watched closely, the map
 * follows it and turns with the route, the next instruction is worked out at
 * each fix and spoken when it changes, the screen stays awake, and a new route
 * is asked for when the traveller leaves this one.
 *
 * Nothing here is sent anywhere except the new route request, to the same
 * service that computed the trip.
 */
import { effect, signal } from "@preact/signals";
import type { Map as MLMap } from "maplibre-gl";
import { formatDistance, lang, locale, t } from "../i18n";
import { mapRef } from "../map/MapView";
import { planTrip } from "../providers/router";
import type { Itinerary, Point, TravelMode } from "../providers/types";
import { type Course, courseOf, type Guidance, guide, type Instruction } from "./course";
import { engine, travel } from "./prefs";
import { back, go, guided, route, userAccuracy, userPosition } from "./state";

/** What the guidance screen shows: computed at each position fix. */
export const guidance = signal<Guidance | null>(null);
/** True while the map keeps the traveller in view; a drag of the map stops it. */
export const following = signal(true);
/** Set while a new route is being asked for, or when asking failed. */
export const rerouting = signal<"asking" | "failed" | null>(null);
/** Speak the instructions. Kept in this browser. */
export const voice = signal(readVoice());

const VOICE_KEY = "ways:voice";

function readVoice(): boolean {
  try {
    return localStorage.getItem(VOICE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setVoice(on: boolean): void {
  voice.value = on;
  try {
    localStorage.setItem(VOICE_KEY, on ? "on" : "off");
  } catch {}
  if (!on) speechSynthesis?.cancel();
}

/** The sentence for an instruction, as shown and as spoken. */
export function instructionText(next: Instruction): string {
  switch (next.kind) {
    case "step":
      return next.text;
    case "board": {
      const line = next.line?.name ?? "";
      if (!line) return t("guide.boardAt", { stop: next.stop });
      return next.headsign
        ? t("guide.board", { line, headsign: next.headsign })
        : t("guide.boardLine", { line });
    }
    case "ride":
      return t("guide.getOff", { stop: next.getOff });
    case "arrive":
      return next.place ? t("guide.arriveAt", { place: next.place }) : t("guide.arrived");
  }
}

/** How far ahead an instruction is said again, as the traveller comes close: by mode. */
const NEAR_M: Record<TravelMode, number> = { car: 200, bike: 60, walk: 30, transit: 30 };
/** Off the route by more than this, for three fixes in a row, asks for a new one. */
const OFF_ROUTE_M = 45;
const REROUTE_GAP_MS = 15_000;

let course: Course | null = null;
let watchId: number | null = null;
let lock: WakeLockSentinel | null = null;
let lastAlong: number | undefined;
let offFixes = 0;
let lastReroute = 0;
let spokenId = "";
let spokenNear = "";
let arrivedSaid = false;
let rerouteAbort: AbortController | null = null;
let detachMap: (() => void) | null = null;

function speak(text: string): void {
  if (!voice.peek() || typeof speechSynthesis === "undefined") return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = locale();
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/** "In 300 m, turn right onto…", or the instruction alone when it is now. */
export function spokenText(g: Guidance): string {
  const text = instructionText(g.next);
  if (g.toNext < 40 || g.next.kind === "ride") return text;
  const lower = text.charAt(0).toLocaleLowerCase(locale()) + text.slice(1);
  return t("guide.inDistance", { distance: formatDistance(g.toNext), text: lower });
}

async function keepAwake(): Promise<void> {
  try {
    lock = (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    lock = null;
  }
}

function onVisible(): void {
  if (document.visibilityState === "visible" && guided.peek()) void keepAwake();
}

/** Moves the camera to the traveller, turned the way the trip goes. */
function follow(map: MLMap, pos: [number, number], bearing: number, mode: TravelMode): void {
  if (!following.peek()) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const h = map.getContainer().clientHeight;
  map.easeTo({
    center: pos,
    bearing,
    pitch: reduce ? 0 : 45,
    zoom: mode === "car" ? 16.5 : 17.5,
    // The traveller sits low on the screen, with the road ahead above.
    padding: { top: Math.round(h * 0.42), bottom: 110, left: 20, right: 20 },
    duration: reduce ? 0 : 900,
    easing: (x) => x,
  });
}

function onFix(pos: [number, number], accuracy: number): void {
  const trip = guided.peek();
  if (!trip || !course) return;
  const now = Date.now();
  const g = guide(course, pos, now, lastAlong);
  if (!g) return;
  lastAlong = g.along;
  guidance.value = g;

  const leg = course.legs[g.legIndex]?.leg;
  // Under the ground or in a vehicle the position wanders: only a street leg can be left.
  const off = leg?.kind !== "transit" && g.offset > Math.max(OFF_ROUTE_M, accuracy * 1.5);
  offFixes = off ? offFixes + 1 : 0;
  if (offFixes >= 3 && !rerouteAbort && now - lastReroute > REROUTE_GAP_MS) void reroute(pos);

  if (g.arrived) {
    if (!arrivedSaid) {
      arrivedSaid = true;
      speak(t("guide.arrived"));
    }
  } else if (g.nextId !== spokenId) {
    spokenId = g.nextId;
    spokenNear = g.toNext < NEAR_M[trip.mode] ? g.nextId : "";
    speak(spokenText(g));
  } else if (spokenNear !== g.nextId && g.toNext < NEAR_M[trip.mode]) {
    spokenNear = g.nextId;
    speak(spokenText(g));
  }

  const map = mapRef.peek();
  if (map) follow(map, pos, g.bearing, trip.mode);
}

/** Asks the same service for a trip from here to the same place. */
export async function reroute(pos: [number, number] | null = userPosition.peek()): Promise<void> {
  const trip = guided.peek();
  if (!trip || !pos) return;
  rerouteAbort?.abort();
  const controller = new AbortController();
  rerouteAbort = controller;
  lastReroute = Date.now();
  rerouting.value = "asking";
  const prefs = travel.peek();
  const from: Point = { lat: pos[1], lng: pos[0], name: t("dir.myPosition") };
  try {
    const out = await planTrip(
      {
        from,
        to: trip.to,
        mode: trip.mode,
        avoidHills: prefs.avoidHills,
        pace: prefs.pace,
        stepFree: prefs.stepFree,
        avoidTolls: prefs.avoidTolls,
        avoidMotorways: prefs.avoidMotorways,
        signal: controller.signal,
      },
      engine.peek(),
    );
    if (controller.signal.aborted || guided.peek() !== trip) return;
    const first = out.itineraries[0];
    if (!first) {
      rerouting.value = "failed";
      return;
    }
    rerouting.value = null;
    setTrip(first, trip.mode, trip.to);
    speak(t("guide.newRoute"));
  } catch {
    if (!controller.signal.aborted) rerouting.value = "failed";
  } finally {
    if (rerouteAbort === controller) rerouteAbort = null;
  }
}

function setTrip(it: Itinerary, mode: TravelMode, to: Point): void {
  guided.value = { it, mode, to };
  course = courseOf(it);
  lastAlong = undefined;
  offFixes = 0;
  spokenId = "";
  spokenNear = "";
  const pos = userPosition.peek();
  if (pos) onFix(pos, userAccuracy.peek() ?? 0);
}

/** Starts guidance along a trip. Asks for the position if it is not known yet. */
export function startGuidance(it: Itinerary, mode: TravelMode, to: Point): void {
  stopWatching();
  arrivedSaid = false;
  rerouting.value = null;
  following.value = true;
  guidance.value = null;
  setTrip(it, mode, to);
  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      (p) => {
        const pos: [number, number] = [p.coords.longitude, p.coords.latitude];
        userPosition.value = pos;
        userAccuracy.value = p.coords.accuracy;
        onFix(pos, p.coords.accuracy);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 30_000 },
    );
  }
  void keepAwake();
  document.addEventListener("visibilitychange", onVisible);
  const map = mapRef.peek();
  if (map) {
    map.setMaxPitch(60);
    // A drag, a pinch or the wheel takes the camera back; the recentre button returns it.
    const release = (e: object) => {
      if ("originalEvent" in e && e.originalEvent) following.value = false;
    };
    map.on("dragstart", release);
    map.on("zoomstart", release);
    detachMap = () => {
      map.off("dragstart", release);
      map.off("zoomstart", release);
      map.easeTo({ bearing: 0, pitch: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
      map.setMaxPitch(0);
    };
  }
  // Like the other screens, guidance has its own address, so the back button ends it.
  go({ name: "go" });
}

/** Brings the camera back to the traveller. */
export function recentre(): void {
  following.value = true;
  const pos = userPosition.peek();
  const g = guidance.peek();
  const trip = guided.peek();
  const map = mapRef.peek();
  if (map && pos && trip) follow(map, pos, g?.bearing ?? map.getBearing(), trip.mode);
}

function stopWatching(): void {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  void lock?.release().catch(() => {});
  lock = null;
  document.removeEventListener("visibilitychange", onVisible);
  detachMap?.();
  detachMap = null;
  rerouteAbort?.abort();
  rerouteAbort = null;
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

/** Ends guidance and goes back to the trip. */
export function endGuidance(): void {
  back();
}

if (typeof window !== "undefined") {
  // Leaving the guidance screen, by its button or the back button, ends it.
  effect(() => {
    const name = route.value.name;
    if (name === "go" || !guided.peek()) return;
    stopWatching();
    guided.value = null;
    guidance.value = null;
    course = null;
  });
  // A language change says the next instruction again in the new language.
  effect(() => {
    lang.value;
    spokenId = "";
  });
}
