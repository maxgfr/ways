/**
 * Picks who computes a trip. Online: Transitous for public transport, Valhalla
 * for bike and foot with Transitous as its stand-in. On device: the routing
 * that runs in this browser on a downloaded region. "Auto" asks the open
 * services first and falls back to the device when they do not answer.
 *
 * The outcome says which service failed, so the screen can name it.
 */
import type { Engine } from "../app/prefs";
import { motisRouter } from "./motis";
import type { Itinerary, PlanRequest, Router } from "./types";
import { isAbort } from "./types";
import { valhallaRouter } from "./valhalla";

export interface PlanOutcome {
  itineraries: Itinerary[];
  /** The services that were asked and did not answer, in the order they were tried. */
  failed: string[];
  /** True when the device was asked to route and no downloaded region covers the trip. */
  noRegion: boolean;
}

/** A router that works in this browser, when a region is installed that covers the request. */
export type DeviceLookup = (req: PlanRequest) => Router | null;

let deviceLookup: DeviceLookup = () => null;

/** Lets the region packs offer their router without this module loading them up front. */
export function setDeviceLookup(lookup: DeviceLookup): void {
  deviceLookup = lookup;
}

export function onlineRouters(mode: PlanRequest["mode"]): Router[] {
  return mode === "transit" ? [motisRouter] : [valhallaRouter, motisRouter];
}

/** The routers to try, in order, for an engine choice. */
export function chain(engine: Engine, req: PlanRequest, device: Router | null): Router[] {
  const online = onlineRouters(req.mode);
  if (engine === "online") return online;
  if (engine === "device") return device ? [device] : [];
  return device ? [...online, device] : online;
}

export async function planTrip(req: PlanRequest, engine: Engine): Promise<PlanOutcome> {
  const device = deviceLookup(req);
  const routers = chain(engine, req, device);
  const failed: string[] = [];
  for (const router of routers) {
    try {
      const itineraries = await router.plan(req);
      // An empty answer from the first choice still lets the next one try.
      if (itineraries.length > 0) return { itineraries, failed, noRegion: false };
    } catch (err) {
      if (isAbort(err)) throw err;
      failed.push(router.origin.name);
    }
  }
  return { itineraries: [], failed, noRegion: engine === "device" && !device };
}
