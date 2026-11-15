/**
 * The street network of a region, small enough to download and route on in
 * the browser: every OpenStreetMap node of a walkable or cyclable way is a
 * vertex, every stretch between two nodes a directed edge that says what it is
 * and who may use it. Stored as a few typed arrays behind a short header.
 *
 * Lengths are not stored: they are worked out from the coordinates, which a
 * flat-earth approximation gives to well under a metre at street scale.
 */

/** What a street is, which decides how pleasant it is to walk or ride. */
export const Kind = {
  street: 0,
  living: 1,
  footway: 2,
  steps: 3,
  cycleway: 4,
  track: 5,
  service: 6,
  tertiary: 7,
  secondary: 8,
  primary: 9,
} as const;

export type KindName = keyof typeof Kind;

const KIND_MASK = 0x0f;
/** May be walked along. */
export const FOOT = 0x10;
/** May be ridden along, in this direction. */
export const BIKE = 0x20;
/** A lane or track for bikes runs along this street. */
export const CYCLE_LANE = 0x40;

export interface Graph {
  nodeCount: number;
  edgeCount: number;
  /** Positions in millionths of a degree. */
  lat: Int32Array;
  lng: Int32Array;
  /** Edges of node `n` are `to[first[n]]` to `to[first[n + 1] - 1]`. */
  first: Uint32Array;
  to: Uint32Array;
  /** Per edge: its kind in the low four bits, then the FOOT, BIKE and CYCLE_LANE flags. */
  flags: Uint8Array;
  /** Per edge: the index of its street name in `names`; 0 is "no name". */
  name: Uint16Array;
  names: string[];
}

export type StreetMode = "walk" | "bike";

export interface StreetOptions {
  /** Metres per second on foot. */
  walkSpeed?: number;
  /** Ramps only: stairs are not taken. */
  stepFree?: boolean;
}

const MAGIC = 0x53594157; // "WAYS", little-endian
const VERSION = 1;
const HEADER_WORDS = 5;

const align4 = (n: number): number => (n + 3) & ~3;

/** The graph as one block of bytes: header, arrays, then the names one per line. */
export function encodeGraph(g: Graph): Uint8Array {
  const names = new TextEncoder().encode(g.names.join("\n"));
  const parts: [ArrayBufferView, number][] = [
    [g.lat, g.nodeCount * 4],
    [g.lng, g.nodeCount * 4],
    [g.first, (g.nodeCount + 1) * 4],
    [g.to, g.edgeCount * 4],
    [g.name, g.edgeCount * 2],
    [g.flags, g.edgeCount],
    [names, names.length],
  ];
  let size = HEADER_WORDS * 4;
  for (const [, bytes] of parts) size = align4(size) + bytes;
  const out = new Uint8Array(align4(size));
  new Uint32Array(out.buffer, 0, HEADER_WORDS).set([
    MAGIC,
    VERSION,
    g.nodeCount,
    g.edgeCount,
    names.length,
  ]);
  let offset = HEADER_WORDS * 4;
  for (const [view, bytes] of parts) {
    offset = align4(offset);
    out.set(new Uint8Array(view.buffer, view.byteOffset, bytes), offset);
    offset += bytes;
  }
  return out;
}

/** Reads a graph back. Throws on anything that is not one, or that is cut short. */
export function decodeGraph(bytes: Uint8Array): Graph {
  // Typed arrays over the buffer need it aligned and whole: copy when it is a slice of another.
  const buffer =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? (bytes.buffer as ArrayBuffer)
      : (bytes.slice().buffer as ArrayBuffer);
  if (buffer.byteLength < HEADER_WORDS * 4) throw new Error("streets: file too short");
  const header = new Uint32Array(buffer, 0, HEADER_WORDS);
  if (header[0] !== MAGIC) throw new Error("streets: not a ways street file");
  if (header[1] !== VERSION) throw new Error(`streets: unknown version ${header[1]}`);
  const nodeCount = header[2] as number;
  const edgeCount = header[3] as number;
  const namesLength = header[4] as number;
  let offset = HEADER_WORDS * 4;
  const take = (bytesNeeded: number): number => {
    const at = align4(offset);
    offset = at + bytesNeeded;
    if (offset > buffer.byteLength) throw new Error("streets: file cut short");
    return at;
  };
  const lat = new Int32Array(buffer, take(nodeCount * 4), nodeCount);
  const lng = new Int32Array(buffer, take(nodeCount * 4), nodeCount);
  const first = new Uint32Array(buffer, take((nodeCount + 1) * 4), nodeCount + 1);
  const to = new Uint32Array(buffer, take(edgeCount * 4), edgeCount);
  const name = new Uint16Array(buffer, take(edgeCount * 2), edgeCount);
  const flags = new Uint8Array(buffer, take(edgeCount), edgeCount);
  const names = new TextDecoder().decode(new Uint8Array(buffer, take(namesLength), namesLength));
  if (first[nodeCount] !== edgeCount) throw new Error("streets: edges do not add up");
  return { nodeCount, edgeCount, lat, lng, first, to, flags, name, names: names.split("\n") };
}

const RAD = Math.PI / 180;
const METRES_PER_MICRODEGREE = 0.111195;

/** Metres between two nodes. */
export function nodeDistance(g: Graph, a: number, b: number): number {
  const latA = g.lat[a] as number;
  const latB = g.lat[b] as number;
  const dy = (latB - latA) * METRES_PER_MICRODEGREE;
  const dx =
    ((g.lng[b] as number) - (g.lng[a] as number)) *
    METRES_PER_MICRODEGREE *
    Math.cos(((latA + latB) / 2e6) * RAD);
  return Math.sqrt(dx * dx + dy * dy);
}

const USE: Record<StreetMode, number> = { walk: FOOT, bike: BIKE };

/** How much longer a metre of each kind of street feels, on foot. Below 1 is pleasant. */
const WALK_FEEL: number[] = [];
WALK_FEEL[Kind.street] = 1;
WALK_FEEL[Kind.living] = 0.95;
WALK_FEEL[Kind.footway] = 0.95;
WALK_FEEL[Kind.steps] = 1.5;
WALK_FEEL[Kind.cycleway] = 1.1;
WALK_FEEL[Kind.track] = 1.05;
WALK_FEEL[Kind.service] = 1.05;
WALK_FEEL[Kind.tertiary] = 1.05;
WALK_FEEL[Kind.secondary] = 1.15;
WALK_FEEL[Kind.primary] = 1.3;

/** The same by bike: cycle tracks are sought, busy roads avoided unless they carry a lane. */
const BIKE_FEEL: number[] = [];
BIKE_FEEL[Kind.street] = 1;
BIKE_FEEL[Kind.living] = 1;
BIKE_FEEL[Kind.footway] = 1.6;
BIKE_FEEL[Kind.steps] = 20;
BIKE_FEEL[Kind.cycleway] = 0.8;
BIKE_FEEL[Kind.track] = 1.4;
BIKE_FEEL[Kind.service] = 1.2;
BIKE_FEEL[Kind.tertiary] = 1.15;
BIKE_FEEL[Kind.secondary] = 1.45;
BIKE_FEEL[Kind.primary] = 1.9;
const LANE_FEEL = 0.85;
const BEST_FEEL = 0.8;

export const WALK_SPEED = 1.42;
/** 16 km/h: a city ride with its stops. */
export const BIKE_SPEED = 4.4;

function feel(flags: number, mode: StreetMode): number {
  const kind = flags & KIND_MASK;
  if (mode === "walk") return WALK_FEEL[kind] ?? 1;
  const base = BIKE_FEEL[kind] ?? 1;
  return flags & CYCLE_LANE ? Math.min(base, LANE_FEEL) : base;
}

/** For each node, the ways of travelling that can leave it or reach it. */
export function nodeUses(g: Graph): Uint8Array {
  const uses = new Uint8Array(g.nodeCount);
  for (let n = 0; n < g.nodeCount; n++) {
    for (let e = g.first[n] as number; e < (g.first[n + 1] as number); e++) {
      const f = (g.flags[e] as number) & (FOOT | BIKE);
      uses[n] = (uses[n] as number) | f;
      const t = g.to[e] as number;
      uses[t] = (uses[t] as number) | f;
    }
  }
  return uses;
}

/** A grid over the nodes, to find the ones near a point without looking at all of them. */
export interface Index {
  uses: Uint8Array;
  cell: number;
  cells: Map<number, number[]>;
}

const CELL = 2000; // microdegrees, about 200 m
const cellKey = (lat: number, lng: number): number =>
  Math.floor(lat / CELL) * 400_000 + Math.floor(lng / CELL);

export function indexGraph(g: Graph): Index {
  const cells = new Map<number, number[]>();
  for (let n = 0; n < g.nodeCount; n++) {
    const key = cellKey(g.lat[n] as number, g.lng[n] as number);
    const list = cells.get(key);
    if (list) list.push(n);
    else cells.set(key, [n]);
  }
  return { uses: nodeUses(g), cell: CELL, cells };
}

/** The node nearest to a point that the mode can use, within about a kilometre; -1 when none. */
export function nearestNode(
  g: Graph,
  index: Index,
  lat: number,
  lng: number,
  mode: StreetMode,
): number {
  const la = Math.round(lat * 1e6);
  const lo = Math.round(lng * 1e6);
  const need = USE[mode];
  const cosLat = Math.cos(lat * RAD);
  let best = -1;
  let bestD = Infinity;
  for (let ring = 0; ring <= 5; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const list = index.cells.get(cellKey(la + dy * CELL, lo + dx * CELL));
        if (!list) continue;
        for (const n of list) {
          if (!((index.uses[n] as number) & need)) continue;
          const y = (g.lat[n] as number) - la;
          const x = ((g.lng[n] as number) - lo) * cosLat;
          const d = x * x + y * y;
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
      }
    }
    // A hit in ring r can still be beaten by a node in ring r + 1, never further.
    if (best !== -1 && ring >= 1 && Math.sqrt(bestD) < ring * CELL) break;
  }
  return best;
}

export type Turn =
  | "depart"
  | "continue"
  | "left"
  | "right"
  | "slightLeft"
  | "slightRight"
  | "hardLeft"
  | "hardRight"
  | "uturn"
  | "stairs";

export interface Manoeuvre {
  turn: Turn;
  /** The street taken, or "" when it has no name. */
  street: string;
  /** Metres until the next manoeuvre. */
  distance: number;
}

export interface StreetRoute {
  /** [lng, lat] pairs. */
  path: [number, number][];
  /** Metres. */
  distance: number;
  /** Seconds. */
  duration: number;
  manoeuvres: Manoeuvre[];
}

function bearing(g: Graph, a: number, b: number): number {
  const dy = (g.lat[b] as number) - (g.lat[a] as number);
  const dx =
    ((g.lng[b] as number) - (g.lng[a] as number)) * Math.cos(((g.lat[a] as number) / 1e6) * RAD);
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/** The turn a change of heading amounts to; positive angles are to the right. */
export function turnOf(angle: number): Turn {
  let a = ((angle + 540) % 360) - 180;
  if (a === -180) a = 180;
  const abs = Math.abs(a);
  if (abs < 25) return "continue";
  if (abs > 165) return "uturn";
  const side = a > 0 ? "Right" : "Left";
  if (abs < 55) return `slight${side}`;
  if (abs > 125) return `hard${side}`;
  return a > 0 ? "right" : "left";
}

/** The shortest stretch worth an instruction of its own, in metres. */
const WORTH_SAYING = 15;

/** A few metres across a junction or a forecourt are folded into the stretch before them. */
export function mergeShort(manoeuvres: Manoeuvre[]): Manoeuvre[] {
  const out: Manoeuvre[] = [];
  for (const m of manoeuvres) {
    const last = out[out.length - 1];
    if (last && m.distance < WORTH_SAYING && m.turn !== "stairs") last.distance += m.distance;
    else out.push({ ...m });
  }
  return out;
}

/** A binary heap of nodes ordered by a score held in a parallel array. */
class Heap {
  private nodes: number[] = [];
  private scores: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, score: number): void {
    let i = this.nodes.length;
    this.nodes.push(node);
    this.scores.push(score);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.scores[parent] as number) <= score) break;
      this.nodes[i] = this.nodes[parent] as number;
      this.scores[i] = this.scores[parent] as number;
      i = parent;
    }
    this.nodes[i] = node;
    this.scores[i] = score;
  }

  pop(): number {
    const top = this.nodes[0] as number;
    const node = this.nodes.pop() as number;
    const score = this.scores.pop() as number;
    const n = this.nodes.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && (this.scores[child + 1] as number) < (this.scores[child] as number))
          child++;
        if ((this.scores[child] as number) >= score) break;
        this.nodes[i] = this.nodes[child] as number;
        this.scores[i] = this.scores[child] as number;
        i = child;
      }
      this.nodes[i] = node;
      this.scores[i] = score;
    }
    return top;
  }
}

/**
 * The most pleasant way between two nodes for a mode (A*): the shortest once
 * each stretch is weighted by how it feels. Null when they are not connected.
 */
export function route(
  g: Graph,
  from: number,
  to: number,
  mode: StreetMode,
  opts: StreetOptions = {},
): StreetRoute | null {
  if (from < 0 || to < 0 || from >= g.nodeCount || to >= g.nodeCount) return null;
  const need = USE[mode];
  const cost = new Float32Array(g.nodeCount).fill(Infinity);
  const prev = new Int32Array(g.nodeCount).fill(-1);
  const via = new Int32Array(g.nodeCount).fill(-1);
  const done = new Uint8Array(g.nodeCount);
  const heap = new Heap();
  cost[from] = 0;
  heap.push(from, 0);
  while (heap.size > 0) {
    const n = heap.pop();
    if (done[n]) continue;
    done[n] = 1;
    if (n === to) break;
    const base = cost[n] as number;
    for (let e = g.first[n] as number; e < (g.first[n + 1] as number); e++) {
      const f = g.flags[e] as number;
      if (!(f & need)) continue;
      if (opts.stepFree && (f & KIND_MASK) === Kind.steps) continue;
      const t = g.to[e] as number;
      if (done[t]) continue;
      const next = base + nodeDistance(g, n, t) * feel(f, mode);
      if (next < (cost[t] as number)) {
        cost[t] = next;
        prev[t] = n;
        via[t] = e;
        heap.push(t, next + nodeDistance(g, t, to) * BEST_FEEL);
      }
    }
  }
  if (from !== to && prev[to] === -1) return null;

  const nodes: number[] = [];
  const edges: number[] = [];
  for (let n = to; n !== -1; n = prev[n] as number) {
    nodes.push(n);
    if (via[n] !== -1) edges.push(via[n] as number);
    if (n === from) break;
  }
  nodes.reverse();
  edges.reverse();

  const speed = mode === "walk" ? (opts.walkSpeed ?? WALK_SPEED) : BIKE_SPEED;
  const manoeuvres: Manoeuvre[] = [];
  let distance = 0;
  let duration = 0;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i] as number;
    const a = nodes[i] as number;
    const b = nodes[i + 1] as number;
    const d = nodeDistance(g, a, b);
    const f = g.flags[e] as number;
    const steps = (f & KIND_MASK) === Kind.steps;
    distance += d;
    // Stairs are slow on foot, and a bike is carried up them.
    duration += d / (steps ? Math.min(speed, 0.7) : speed);
    const street = g.names[g.name[e] as number] ?? "";
    const last = manoeuvres[manoeuvres.length - 1];
    if (!last) {
      manoeuvres.push({ turn: "depart", street, distance: d });
      continue;
    }
    const before = nodes[i - 1] as number;
    const turn = steps ? "stairs" : turnOf(bearing(g, a, b) - bearing(g, before, a));
    const prevEdge = edges[i - 1] as number;
    const sameStreet = g.name[e] === g.name[prevEdge];
    const wasSteps = ((g.flags[prevEdge] as number) & KIND_MASK) === Kind.steps;
    // Following a street round its bends is not a manoeuvre; leaving it, or turning hard, is.
    if (
      steps === wasSteps &&
      (sameStreet ? turn === "continue" || turn.startsWith("slight") : false)
    ) {
      last.distance += d;
    } else if (!sameStreet && turn === "continue" && !street) {
      last.distance += d;
    } else {
      manoeuvres.push({ turn, street, distance: d });
    }
  }

  return {
    path: nodes.map((n) => [(g.lng[n] as number) / 1e6, (g.lat[n] as number) / 1e6]),
    distance,
    duration,
    manoeuvres: mergeShort(manoeuvres),
  };
}
