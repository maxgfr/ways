/**
 * What the user keeps: saved places and stops, and the last things they looked
 * up. One small document in IndexedDB, in this browser only. Another tab's
 * changes arrive through a BroadcastChannel; if IndexedDB is unavailable the
 * document stays in memory for the session and the interface says so.
 */
import { computed, effect, signal } from "@preact/signals";
import { keepRecents } from "../app/prefs";
import type { Point } from "../providers/types";

export interface Saved {
  id: string;
  kind: "place" | "stop";
  point: Point;
  /** The OpenStreetMap object of a place, to find its details again. */
  osm?: string;
  savedAt: number;
}

export interface Recent {
  kind: "place" | "stop";
  point: Point;
  osm?: string;
  at: number;
}

export interface Doc {
  version: 1;
  saved: Saved[];
  recents: Recent[];
}

const DB_NAME = "ways";
const STORE = "kept";
const ID = "doc";
export const MAX_RECENTS = 8;

export function emptyDoc(): Doc {
  return { version: 1, saved: [], recents: [] };
}

function isPoint(v: unknown): v is Point {
  const p = v as Partial<Point> | null;
  return (
    !!p &&
    typeof p === "object" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    typeof p.name === "string" &&
    (p.stopId === undefined || typeof p.stopId === "string")
  );
}

function isKind(v: unknown): v is "place" | "stop" {
  return v === "place" || v === "stop";
}

/** A stored document, with anything unreadable left out rather than trusted. */
export function parseDoc(raw: unknown): Doc {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const saved = (Array.isArray(r.saved) ? r.saved : []).filter(
    (s): s is Saved =>
      !!s &&
      typeof s.id === "string" &&
      isKind(s.kind) &&
      isPoint(s.point) &&
      Number.isFinite(s.savedAt) &&
      (s.osm === undefined || typeof s.osm === "string"),
  );
  const recents = (Array.isArray(r.recents) ? r.recents : []).filter(
    (x): x is Recent =>
      !!x &&
      isKind(x.kind) &&
      isPoint(x.point) &&
      Number.isFinite(x.at) &&
      (x.osm === undefined || typeof x.osm === "string"),
  );
  return { version: 1, saved, recents: recents.slice(0, MAX_RECENTS) };
}

/** Two points are the same place when they share a stop, or sit within a few metres. */
export function samePlace(a: Point, b: Point): boolean {
  if (a.stopId && b.stopId) return a.stopId === b.stopId;
  return Math.abs(a.lat - b.lat) < 0.00005 && Math.abs(a.lng - b.lng) < 0.00005;
}

export function withRecent(doc: Doc, entry: Recent): Doc {
  const rest = doc.recents.filter((r) => !samePlace(r.point, entry.point));
  return { ...doc, recents: [entry, ...rest].slice(0, MAX_RECENTS) };
}

export function withSaved(doc: Doc, entry: Saved): Doc {
  if (doc.saved.some((s) => samePlace(s.point, entry.point))) return doc;
  return { ...doc, saved: [entry, ...doc.saved] };
}

export function withoutSaved(doc: Doc, point: Point): Doc {
  return { ...doc, saved: doc.saved.filter((s) => !samePlace(s.point, point)) };
}

export const doc = signal<Doc>(emptyDoc());
/** Set when the browser refuses to store: what is kept will not survive the tab. */
export const storageError = signal(false);

let opening: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("blocked"));
    setTimeout(() => reject(new Error("busy")), 3000);
  });
  return opening;
}

async function idb<T>(
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("ways-kept");
let lastWritten = "";
let loaded = false;

/** Resolves once what was kept has been read (or could not be). */
export const storeLoaded: Promise<void> =
  typeof indexedDB === "undefined"
    ? Promise.resolve()
    : idb<unknown>("readonly", (s) => s.get(ID))
        .then((raw) => {
          if (typeof raw === "string") {
            lastWritten = raw;
            doc.value = parseDoc(JSON.parse(raw));
          }
        })
        .catch(() => {
          storageError.value = true;
        })
        .finally(() => {
          loaded = true;
        });

if (typeof window !== "undefined") {
  effect(() => {
    const json = JSON.stringify(doc.value);
    if (!loaded || json === lastWritten) return;
    lastWritten = json;
    idb("readwrite", (s) => s.put(json, ID))
      .then(() => {
        storageError.value = false;
        channel?.postMessage(json);
      })
      .catch(() => {
        storageError.value = true;
      });
  });
  channel?.addEventListener("message", (e: MessageEvent<unknown>) => {
    if (typeof e.data !== "string" || e.data === lastWritten) return;
    try {
      lastWritten = e.data;
      doc.value = parseDoc(JSON.parse(e.data));
    } catch {}
  });
}

export const saved = computed(() => doc.value.saved);
export const recents = computed(() => doc.value.recents);

export function isSaved(point: Point): boolean {
  return doc.value.saved.some((s) => samePlace(s.point, point));
}

export function save(kind: "place" | "stop", point: Point, osm?: string): void {
  doc.value = withSaved(doc.value, {
    id: crypto.randomUUID(),
    kind,
    point,
    ...(osm ? { osm } : {}),
    savedAt: Date.now(),
  });
}

export function unsave(point: Point): void {
  doc.value = withoutSaved(doc.value, point);
}

export function remember(kind: "place" | "stop", point: Point, osm?: string): void {
  if (!point.name || !keepRecents.peek()) return;
  doc.value = withRecent(doc.value, { kind, point, ...(osm ? { osm } : {}), at: Date.now() });
}

export function forgetRecent(point: Point): void {
  doc.value = {
    ...doc.value,
    recents: doc.value.recents.filter((r) => !samePlace(r.point, point)),
  };
}

export function forgetRecents(): void {
  doc.value = { ...doc.value, recents: [] };
}
