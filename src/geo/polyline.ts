/**
 * Encoded polylines, as the routing services return them: a string of
 * variable-length deltas. MOTIS uses 6 decimal places (7 on its oldest
 * endpoints), Valhalla 6, OSRM 5 or 6, so the precision is always passed.
 */

/** A path as [lng, lat] pairs, the order MapLibre and GeoJSON use. */
export type Path = [number, number][];

export function decodePolyline(encoded: string, precision = 6): Path {
  const factor = 10 ** precision;
  const out: Path = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

export function encodePolyline(path: Path, precision = 6): string {
  const factor = 10 ** precision;
  let out = "";
  let prevLat = 0;
  let prevLng = 0;
  const write = (value: number): void => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [lng, lat] of path) {
    const iLat = Math.round(lat * factor);
    const iLng = Math.round(lng * factor);
    write(iLat - prevLat);
    write(iLng - prevLng);
    prevLat = iLat;
    prevLng = iLng;
  }
  return out;
}

/** Distance in metres between two [lng, lat] points (haversine). */
export function distance(a: readonly [number, number], b: readonly [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** The length of a path in metres. */
export function pathLength(path: Path): number {
  let total = 0;
  for (let i = 1; i < path.length; i++)
    total += distance(path[i - 1] as [number, number], path[i] as [number, number]);
  return total;
}

/** The point a fraction (0 to 1) of the way along a path, and the heading there in degrees. */
export function pointAlong(
  path: Path,
  fraction: number,
): { at: [number, number]; bearing: number } | null {
  const first = path[0];
  if (!first) return null;
  if (path.length === 1) return { at: first, bearing: 0 };
  const total = pathLength(path);
  const target = Math.min(1, Math.max(0, fraction)) * total;
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as [number, number];
    const b = path[i] as [number, number];
    const seg = distance(a, b);
    if (walked + seg >= target || i === path.length - 1) {
      const f = seg === 0 ? 0 : Math.min(1, (target - walked) / seg);
      const bearing = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
      return { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], bearing };
    }
    walked += seg;
  }
  return null;
}

/** The [west, south, east, north] box around some paths, or null when they are empty. */
export function boundsOf(paths: Path[]): [number, number, number, number] | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const path of paths) {
    for (const [lng, lat] of path) {
      if (lng < w) w = lng;
      if (lng > e) e = lng;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}
