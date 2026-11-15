/**
 * The page's side of on-device routing: it starts the worker the first time a
 * trip or a stop is asked of a downloaded region, and turns its answers into
 * the same shapes the online services give.
 */
import { lang } from "../i18n";
import type { Itinerary, PlanRequest, Router } from "../providers/types";
import { packsBase, type RegionInfo, regionFor } from "./packs";
import { DEVICE } from "./plan";
import type { Answer, Ask, FoundStop } from "./worker";

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve: (a: Answer) => void; reject: (e: Error) => void }>();

function start(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./worker.js", document.baseURI), { type: "module" });
  w.addEventListener("message", (e: MessageEvent<Answer>) => {
    const pending = waiting.get(e.data.n);
    waiting.delete(e.data.n);
    pending?.resolve(e.data);
  });
  w.addEventListener("error", () => {
    // The worker died: everything still waiting fails, and the next question starts a new one.
    for (const pending of waiting.values()) pending.reject(new Error("device routing stopped"));
    waiting.clear();
    worker = null;
  });
  worker = w;
  return w;
}

type Question =
  | { type: "plan"; region: RegionInfo; req: PlanRequest }
  | { type: "stops"; region: RegionInfo; text: string };

function ask(question: Question, signal?: AbortSignal): Promise<Answer> {
  const n = ++seq;
  const base = packsBase();
  const message: Ask =
    question.type === "plan"
      ? { n, type: "plan", base, region: question.region, req: question.req, lang: lang.value }
      : { n, type: "stops", base, region: question.region, text: question.text };
  return new Promise((resolve, reject) => {
    waiting.set(n, { resolve, reject });
    signal?.addEventListener(
      "abort",
      () => {
        waiting.delete(n);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
    start().postMessage(message);
  });
}

/** A router over one downloaded region. */
export function deviceRouter(region: RegionInfo): Router {
  return {
    origin: DEVICE,
    modes: ["transit", "bike", "walk"],
    async plan(req: PlanRequest): Promise<Itinerary[]> {
      // An AbortSignal cannot cross to a worker: it stays on this side.
      const { signal, ...plain } = req;
      const reply = await ask({ type: "plan", region, req: plain }, signal);
      if (!reply.ok) throw new Error(reply.error);
      return reply.itineraries ?? [];
    },
  };
}

/** The router to use on the device for a trip: the one of a region that covers both its ends. */
export function deviceLookup(req: PlanRequest): Router | null {
  const region = regionFor(req);
  return region ? deviceRouter(region) : null;
}

/** Stops of the downloaded regions whose name matches. */
export async function searchRegionStops(
  regions: RegionInfo[],
  text: string,
  signal?: AbortSignal,
): Promise<FoundStop[]> {
  const found: FoundStop[] = [];
  for (const region of regions) {
    const reply = await ask({ type: "stops", region, text }, signal).catch(() => null);
    if (reply?.ok && reply.stops) found.push(...reply.stops);
  }
  return found.slice(0, 6);
}
