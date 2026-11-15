import { describe, expect, test } from "bun:test";
import { addDays, fromServiceTime, toServiceTime } from "./time";

const PARIS = "Europe/Paris";

describe("toServiceTime", () => {
  test("a winter afternoon in Paris is one hour ahead of UTC", () => {
    expect(toServiceTime(Date.UTC(2026, 10, 15, 16, 30), PARIS)).toEqual({
      date: "2026-11-15",
      minutes: 17 * 60 + 30,
    });
  });

  test("a summer evening can already be tomorrow there", () => {
    expect(toServiceTime(Date.UTC(2026, 6, 14, 22, 30), PARIS)).toEqual({
      date: "2026-07-15",
      minutes: 30,
    });
  });

  test("midnight is minute zero, not 24:00", () => {
    expect(toServiceTime(Date.UTC(2026, 0, 9, 23, 0), PARIS).minutes).toBe(0);
  });
});

describe("fromServiceTime", () => {
  test("is the inverse, winter and summer", () => {
    for (const ms of [Date.UTC(2026, 10, 15, 16, 30), Date.UTC(2026, 6, 14, 22, 30)]) {
      const s = toServiceTime(ms, PARIS);
      expect(fromServiceTime(s.date, s.minutes, PARIS)).toBe(ms);
    }
  });

  test("runs past midnight belong to the service day before", () => {
    expect(fromServiceTime("2026-11-15", 25 * 60 + 10, PARIS)).toBe(Date.UTC(2026, 10, 16, 0, 10));
  });

  test("the morning after the clocks go forward is still right", () => {
    // 29 March 2026: 02:00 becomes 03:00 in Paris. 08:00 that day is 06:00 UTC.
    expect(fromServiceTime("2026-03-29", 8 * 60, PARIS)).toBe(Date.UTC(2026, 2, 29, 6, 0));
    expect(fromServiceTime("2026-03-29", 60, PARIS)).toBe(Date.UTC(2026, 2, 29, 0, 0));
  });

  test("other zones", () => {
    expect(fromServiceTime("2026-11-15", 9 * 60, "America/New_York")).toBe(
      Date.UTC(2026, 10, 15, 14, 0),
    );
  });
});

describe("addDays", () => {
  test("crosses months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-11-15", 0)).toBe("2026-11-15");
  });
});
