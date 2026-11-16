/**
 * Where a moving position stands on a path: how far along it, how far off it,
 * and which way the path runs there. Distances are in metres, along the
 * ground; coordinates are [lng, lat].
 */
import { distance, type Path } from "./polyline";

const M_PER_DEG = (6371008.8 * Math.PI) / 180;

export interface OnPath {
  /** Metres from the start of the path to the point of it nearest the position. */
  along: number;
  /** Metres between the position and that point. */
  offset: number;
  /** The heading of the path there, in degrees clockwise from north. */
  bearing: number;
}

/** The heading from a to b, in degrees clockwise from north. */
export function bearingOf(a: readonly [number, number], b: readonly [number, number]): number {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const deg = (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * The point of a path nearest a position. When the path passes the position
 * more than once (a loop, a street taken both ways), the pass nearest `hint`
 * (the last known `along`) wins among those almost as close as the best one,
 * so the progress does not jump ahead or back.
 */
export function snap(path: Path, p: readonly [number, number], hint?: number): OnPath | null {
  const first = path[0];
  if (!first) return null;
  if (path.length === 1) return { along: 0, offset: distance(p, first), bearing: 0 };
  // A flat projection around the position: exact enough for the few hundred metres that matter.
  const k = Math.cos((p[1] * Math.PI) / 180);
  const x = (q: readonly [number, number]) => (q[0] - p[0]) * k * M_PER_DEG;
  const y = (q: readonly [number, number]) => (q[1] - p[1]) * M_PER_DEG;
  const found: OnPath[] = [];
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as [number, number];
    const b = path[i] as [number, number];
    const ax = x(a);
    const ay = y(a);
    const vx = x(b) - ax;
    const vy = y(b) - ay;
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * vx + ay * vy) / len2));
    const seg = distance(a, b);
    found.push({
      along: walked + t * seg,
      offset: Math.hypot(ax + t * vx, ay + t * vy),
      bearing: bearingOf(a, b),
    });
    walked += seg;
  }
  let best = found[0] as OnPath;
  for (const f of found) if (f.offset < best.offset) best = f;
  if (hint === undefined) return best;
  // Within 15 m of the nearest pass, the one closest to where the traveller was.
  let pick = best;
  for (const f of found) {
    if (f.offset > best.offset + 15) continue;
    if (Math.abs(f.along - hint) < Math.abs(pick.along - hint)) pick = f;
  }
  return pick;
}
