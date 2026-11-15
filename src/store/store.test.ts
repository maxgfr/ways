import { describe, expect, test } from "bun:test";
import {
  emptyDoc,
  MAX_RECENTS,
  parseDoc,
  samePlace,
  withoutSaved,
  withRecent,
  withSaved,
} from "./store";

const a = { lat: 48.1, lng: -1.6, name: "A" };
const b = { lat: 48.2, lng: -1.7, name: "B" };

describe("samePlace", () => {
  test("stops are compared by id, places by position", () => {
    expect(samePlace({ ...a, stopId: "s1" }, { ...b, stopId: "s1" })).toBe(true);
    expect(samePlace({ ...a, stopId: "s1" }, { ...a, stopId: "s2" })).toBe(false);
    expect(samePlace(a, { ...a, name: "renamed", lat: a.lat + 0.00001 })).toBe(true);
    expect(samePlace(a, b)).toBe(false);
  });
});

describe("recents", () => {
  test("the newest comes first and a repeat moves up instead of doubling", () => {
    let d = emptyDoc();
    d = withRecent(d, { kind: "place", point: a, at: 1 });
    d = withRecent(d, { kind: "place", point: b, at: 2 });
    d = withRecent(d, { kind: "place", point: a, at: 3 });
    expect(d.recents.map((r) => r.point.name)).toEqual(["A", "B"]);
    expect(d.recents[0]?.at).toBe(3);
  });

  test("capped", () => {
    let d = emptyDoc();
    for (let i = 0; i < MAX_RECENTS + 5; i++)
      d = withRecent(d, { kind: "place", point: { lat: i, lng: i, name: `p${i}` }, at: i });
    expect(d.recents).toHaveLength(MAX_RECENTS);
    expect(d.recents[0]?.point.name).toBe(`p${MAX_RECENTS + 4}`);
  });
});

describe("saved", () => {
  test("saving twice keeps one; removing takes it out", () => {
    let d = withSaved(emptyDoc(), { id: "1", kind: "place", point: a, savedAt: 1 });
    d = withSaved(d, { id: "2", kind: "place", point: a, savedAt: 2 });
    expect(d.saved).toHaveLength(1);
    expect(withoutSaved(d, a).saved).toHaveLength(0);
  });
});

describe("parseDoc", () => {
  test("drops what is malformed and keeps the rest", () => {
    const d = parseDoc({
      saved: [
        { id: "1", kind: "place", point: a, savedAt: 1 },
        { id: "2", kind: "planet", point: a, savedAt: 1 },
        { id: "3", kind: "stop", point: { lat: "x", lng: 1, name: "bad" }, savedAt: 1 },
        null,
      ],
      recents: [
        { kind: "stop", point: { ...b, stopId: "s" }, at: 5 },
        { kind: "stop", at: 5 },
      ],
    });
    expect(d.saved.map((s) => s.id)).toEqual(["1"]);
    expect(d.recents).toHaveLength(1);
  });

  test("anything that is not a document is an empty one", () => {
    expect(parseDoc("nope")).toEqual(emptyDoc());
    expect(parseDoc(null)).toEqual(emptyDoc());
  });
});
