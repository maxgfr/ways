/**
 * The little the app needs from a GTFS feed beyond what the timetable holds:
 * the colours operators give their lines.
 */

/** Rows of a CSV file as objects keyed by the header, quoted fields and doubled quotes included. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = (rows.shift() ?? []).map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

export interface LineColours {
  color?: string;
  textColor?: string;
}

const hex = (v: string | undefined): string | undefined =>
  v && /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : undefined;

/**
 * Colours by line name, from routes.txt. The name is the one the timetable
 * uses: the short name, or the long one when a route has no short name.
 */
export function lineColours(routesTxt: string): Record<string, LineColours> {
  const out: Record<string, LineColours> = {};
  for (const r of parseCsv(routesTxt)) {
    const name = r.route_short_name || r.route_long_name;
    const color = hex(r.route_color);
    if (!name || !color || out[name]) continue;
    const textColor = hex(r.route_text_color);
    out[name] = { color, ...(textColor ? { textColor } : {}) };
  }
  return out;
}
