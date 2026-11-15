/**
 * Timetables count minutes from midnight on a service day, on the clocks of
 * the region. These helpers go between that and a moment in time, whatever
 * time zone the device is set to.
 */

export interface ServiceTime {
  /** The service day, as "YYYY-MM-DD". */
  date: string;
  /** Minutes since that day's midnight, on the region's clocks. */
  minutes: number;
}

function parts(ms: number, timeZone: string): Record<string, number> {
  const out: Record<string, number> = {};
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  for (const p of fmt.formatToParts(ms)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** The day and the minute of the day a moment falls on, in a time zone. */
export function toServiceTime(ms: number, timeZone: string): ServiceTime {
  const p = parts(ms, timeZone);
  return {
    date: `${p.year}-${pad(p.month ?? 1)}-${pad(p.day ?? 1)}`,
    minutes: (p.hour ?? 0) * 60 + (p.minute ?? 0),
  };
}

/**
 * The moment that is `minutes` after midnight of a service day in a time zone.
 * Minutes may pass 24 hours: a timetable's late runs belong to the day before.
 */
export function fromServiceTime(date: string, minutes: number, timeZone: string): number {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  const wanted = Date.UTC(y, m - 1, d) + minutes * 60_000;
  // What the zone's clocks show at a UTC instant, read back as if it were UTC, gives its offset.
  const shown = (ms: number): number => {
    const p = parts(ms, timeZone);
    return Date.UTC(p.year ?? y, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0);
  };
  let guess = wanted;
  // Twice: the first offset may be the one from the other side of a clock change.
  for (let i = 0; i < 2; i++) guess = wanted - (shown(guess) - guess);
  return guess;
}

/** The day `days` after a "YYYY-MM-DD" day. */
export function addDays(date: string, days: number): string {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
