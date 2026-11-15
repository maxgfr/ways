/**
 * Turns OpenStreetMap ways (as Overpass returns them) into the street graph
 * the app routes on. Who may use a way, and in which direction, is read from
 * its tags; what cannot be walked or ridden is left out, and so is anything
 * cut off from the main network.
 */
import { BIKE, CYCLE_LANE, FOOT, type Graph, Kind } from "../src/local/graph";

export interface OsmNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
}

export interface OsmWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

export type OsmElement = OsmNode | OsmWay | { type: string };

const KINDS: Record<string, number> = {
  residential: Kind.street,
  unclassified: Kind.street,
  road: Kind.street,
  living_street: Kind.living,
  pedestrian: Kind.footway,
  footway: Kind.footway,
  path: Kind.footway,
  bridleway: Kind.footway,
  steps: Kind.steps,
  cycleway: Kind.cycleway,
  track: Kind.track,
  service: Kind.service,
  tertiary: Kind.tertiary,
  tertiary_link: Kind.tertiary,
  secondary: Kind.secondary,
  secondary_link: Kind.secondary,
  primary: Kind.primary,
  primary_link: Kind.primary,
};

const YES = new Set(["yes", "designated", "permissive", "official", "destination"]);
const NO = new Set(["no", "private", "use_sidepath", "discouraged"]);
const LANE = /^(lane|track|opposite_lane|opposite_track|shared_lane|share_busway)$/;

export interface WayUse {
  kind: number;
  foot: boolean;
  /** Along the way's own direction, and against it. */
  bikeForward: boolean;
  bikeBackward: boolean;
  lane: boolean;
}

/** How a way may be used, or null when it is no use on foot or by bike. */
export function wayUse(tags: Record<string, string> = {}): WayUse | null {
  const highway = tags.highway ?? "";
  const kind = KINDS[highway];
  if (kind === undefined) return null;
  if (tags.area === "yes") return null;
  const access = tags.access;
  const closed = access !== undefined && NO.has(access);

  let foot = !closed;
  if (tags.foot !== undefined) foot = YES.has(tags.foot) || (!NO.has(tags.foot) && foot);
  // A cycle track with no word about pedestrians: walkable where no pavement runs beside it.
  if (highway === "cycleway" && tags.foot === undefined && tags.segregated === undefined)
    foot = !closed && tags.sidewalk === undefined;

  // Where bikes may go without a tag saying so.
  const rideable = !["footway", "pedestrian", "steps", "bridleway"].includes(highway);
  let bike = rideable && !closed;
  if (tags.bicycle !== undefined) bike = YES.has(tags.bicycle) || (!NO.has(tags.bicycle) && bike);
  if (highway === "steps") bike = false;

  if (!foot && !bike) return null;

  const cycleTags = [
    tags.cycleway,
    tags["cycleway:left"],
    tags["cycleway:right"],
    tags["cycleway:both"],
  ];
  const lane =
    highway === "cycleway" ||
    tags.bicycle === "designated" ||
    cycleTags.some((v) => v !== undefined && LANE.test(v));

  const oneway = tags.oneway ?? (tags.junction === "roundabout" ? "yes" : "no");
  const contraflow =
    tags["oneway:bicycle"] === "no" || cycleTags.some((v) => v?.startsWith("opposite"));
  let bikeForward = bike;
  let bikeBackward = bike;
  if (!contraflow) {
    if (oneway === "yes" || oneway === "true" || oneway === "1") bikeBackward = false;
    else if (oneway === "-1" || oneway === "reverse") bikeForward = false;
  }
  return { kind, foot, bikeForward, bikeBackward, lane };
}

interface RawEdge {
  from: number;
  to: number;
  flags: number;
  name: number;
}

/** The members of the largest group of nodes that can reach one another, ignoring direction. */
function largestComponent(nodeCount: number, edges: RawEdge[]): Uint8Array {
  const parent = new Int32Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) parent[i] = i;
  const find = (start: number): number => {
    let root = start;
    while (parent[root] !== root) root = parent[root] as number;
    let x = start;
    while (parent[x] !== root) {
      const next = parent[x] as number;
      parent[x] = root;
      x = next;
    }
    return root;
  };
  for (const e of edges) {
    const a = find(e.from);
    const b = find(e.to);
    if (a !== b) parent[a] = b;
  }
  const size = new Int32Array(nodeCount);
  let best = 0;
  for (let i = 0; i < nodeCount; i++) {
    const r = find(i);
    size[r] = (size[r] as number) + 1;
    if ((size[r] as number) > (size[best] as number)) best = r;
  }
  const keep = new Uint8Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) if (find(i) === best) keep[i] = 1;
  return keep;
}

export function buildGraph(elements: OsmElement[]): Graph {
  const position = new Map<number, [number, number]>();
  const ways: OsmWay[] = [];
  for (const el of elements) {
    if (el.type === "node") {
      const n = el as OsmNode;
      position.set(n.id, [n.lat, n.lon]);
    } else if (el.type === "way") ways.push(el as OsmWay);
  }

  const index = new Map<number, number>();
  const ids: number[] = [];
  const nodeOf = (id: number): number => {
    let n = index.get(id);
    if (n === undefined) {
      n = ids.length;
      index.set(id, n);
      ids.push(id);
    }
    return n;
  };
  const names: string[] = [""];
  const nameIndex = new Map<string, number>([["", 0]]);
  const nameOf = (text: string | undefined): number => {
    const name = (text ?? "").replaceAll("\n", " ").trim();
    let i = nameIndex.get(name);
    if (i === undefined) {
      // The index is 16 bits wide: past that, a street simply goes unnamed.
      if (names.length >= 0xffff) return 0;
      i = names.length;
      nameIndex.set(name, i);
      names.push(name);
    }
    return i;
  };

  const raw: RawEdge[] = [];
  for (const way of ways) {
    const use = wayUse(way.tags);
    if (!use) continue;
    const name = nameOf(way.tags?.name);
    const base = use.kind | (use.lane ? CYCLE_LANE : 0) | (use.foot ? FOOT : 0);
    for (let i = 1; i < way.nodes.length; i++) {
      const a = way.nodes[i - 1] as number;
      const b = way.nodes[i] as number;
      if (a === b || !position.has(a) || !position.has(b)) continue;
      const from = nodeOf(a);
      const to = nodeOf(b);
      const forward = base | (use.bikeForward ? BIKE : 0);
      const backward = base | (use.bikeBackward ? BIKE : 0);
      if (forward & (FOOT | BIKE)) raw.push({ from, to, flags: forward, name });
      if (backward & (FOOT | BIKE)) raw.push({ from: to, to: from, flags: backward, name });
    }
  }

  const keep = largestComponent(ids.length, raw);
  const renumber = new Int32Array(ids.length).fill(-1);
  let nodeCount = 0;
  for (let i = 0; i < ids.length; i++) if (keep[i]) renumber[i] = nodeCount++;
  const edges = raw.filter((e) => keep[e.from] && keep[e.to]);

  const lat = new Int32Array(nodeCount);
  const lng = new Int32Array(nodeCount);
  for (let i = 0; i < ids.length; i++) {
    const n = renumber[i] as number;
    if (n === -1) continue;
    const p = position.get(ids[i] as number) as [number, number];
    lat[n] = Math.round(p[0] * 1e6);
    lng[n] = Math.round(p[1] * 1e6);
  }

  const first = new Uint32Array(nodeCount + 1);
  for (const e of edges) {
    const n = renumber[e.from] as number;
    first[n + 1] = (first[n + 1] as number) + 1;
  }
  for (let n = 0; n < nodeCount; n++)
    first[n + 1] = (first[n + 1] as number) + (first[n] as number);
  const cursor = first.slice(0, nodeCount);
  const to = new Uint32Array(edges.length);
  const flags = new Uint8Array(edges.length);
  const name = new Uint16Array(edges.length);
  for (const e of edges) {
    const n = renumber[e.from] as number;
    const at = cursor[n] as number;
    cursor[n] = at + 1;
    to[at] = renumber[e.to] as number;
    flags[at] = e.flags;
    name[at] = e.name;
  }
  return { nodeCount, edgeCount: edges.length, lat, lng, first, to, flags, name, names };
}
