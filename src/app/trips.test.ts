import { describe, expect, test } from "bun:test";
import type { PlanRequest } from "../providers/types";
import { requestKey, resolveFrom } from "./trips";

const a = { lat: 48.1, lng: -1.6, name: "A" };
const b = { lat: 48.2, lng: -1.7, name: "B", stopId: "stop-b" };
const req: PlanRequest = { from: a, to: b, mode: "transit" };

describe("requestKey", () => {
  test("same request, same key; a name alone changes nothing", () => {
    const now = { kind: "now" as const, time: 0 };
    expect(requestKey(req, "auto", now)).toBe(
      requestKey({ ...req, from: { ...a, name: "renamed" } }, "auto", now),
    );
  });

  test("mode, time, engine and preferences each make a different request", () => {
    const now = { kind: "now" as const, time: 0 };
    const base = requestKey(req, "auto", now);
    const others = [
      requestKey({ ...req, mode: "bike" }, "auto", now),
      requestKey(req, "auto", { kind: "depart", time: 1000 }),
      requestKey(req, "auto", { kind: "arrive", time: 1000 }),
      requestKey(req, "device", now),
      requestKey({ ...req, avoidHills: true }, "auto", now),
      requestKey({ ...req, stepFree: true }, "auto", now),
      requestKey({ ...req, pace: "slow" }, "auto", now),
    ];
    expect(new Set([base, ...others]).size).toBe(others.length + 1);
  });
});

describe("resolveFrom", () => {
  test("a given start wins over the position", () => {
    expect(resolveFrom(a, [2, 1])).toBe(a);
  });

  test("no start means where the user is, when that is known", () => {
    expect(resolveFrom(null, [-1.68, 48.11])).toMatchObject({ lat: 48.11, lng: -1.68 });
    expect(resolveFrom(null, null)).toBeNull();
  });
});
