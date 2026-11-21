// sokoban-solver: a push-optimal Sokoban solver for make.fun's sokoban-solver-01.
// One program, five levels: each level is a hallway with 1-4 rooms off it, and a box
// pushed out of a room through its door can never come back, so every room is an
// independent subproblem and a level's push-optimum P* is the sum of its rooms'.
// Strategy: split the level into rooms, solve each room with push-based A* (cost 1
// per push, state = boxes + the player's reachable region, admissible heuristic =
// min-cost matching of boxes to goals over true shortest-path distances), stitch
// the rooms with BFS walks through the hallway. Deadlock pruning: dead squares
// (pull-back from the goals) and frozen 2x2 blocks. Budgets are counted in node
// expansions, never in wall-clock time, so two runs write identical bytes.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// [dx, dy, step letter, push letter]
const DIRS: [number, number, string, string][] = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];

interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

/** A level in XSB text: # wall, space floor, . goal, $ box, * box on goal, @ player. */
function parse(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if ('.*+'.includes(ch)) goals.push(i);
      if ('$*'.includes(ch)) boxes.push(i);
      if ('@+'.includes(ch)) player = i;
    }
  });
  return { w, h, wall, goals, boxes: boxes.sort((a, b) => a - b), player };
}

/** Squares from which a box can still be pushed onto some goal, pulled back from
 *  the goals ignoring the other boxes: a square y is live when the square beyond it
 *  (where the player must stand to push toward the goal) is open floor. */
function liveSquares(lv: Level): Uint8Array {
  const { w, wall, goals } = lv;
  const live = new Uint8Array(wall.length);
  const queue = [...goals];
  for (const g of goals) live[g] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi]!;
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const y = x - d;
      if (y >= 0 && y < wall.length && !wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/** Walking distances from `from` over open floor (walls only), -1 unreachable. */
function bfsDist(lv: Level, from: number): Int32Array {
  const { w, wall } = lv;
  const dist = new Int32Array(wall.length).fill(-1);
  const queue = [from];
  dist[from] = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    for (const [dx, dy] of DIRS) {
      const q = p + dy * w + dx;
      if (q >= 0 && q < wall.length && !wall[q] && dist[q] < 0) {
        dist[q] = dist[p]! + 1;
        queue.push(q);
      }
    }
  }
  return dist;
}

const BIG = 1_000_000;
/** Min-cost assignment of rows to columns (square cost matrix, BIG = forbidden):
 *  the classic O(n^3) Hungarian algorithm with potentials. Returns Infinity when
 *  no complete assignment exists. */
function hungarian(cost: number[][]): number {
  const n = cost.length;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }
  const total = -v[0]!;
  return total >= BIG / 2 ? Infinity : total;
}

/** Whether the box just pushed to `t` sits in a frozen 2x2 block: four squares of
 *  walls and boxes, one of them a box off its goal. Such a box can never move again. */
function frozenBlock(lv: Level, occupied: Uint8Array, goal: Uint8Array, t: number): boolean {
  const { w, wall } = lv;
  const size = wall.length;
  const solid = (i: number): boolean => i < 0 || i >= size || !!wall[i] || !!occupied[i];
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (!solid(a) || !solid(b) || !solid(c) || !solid(d)) continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) || (occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) return true;
  }
  return false;
}

/** Flood fill from `from` around walls and `occupied`, stamping `seen` with `stamp`;
 *  returns the lowest square reached (the region's canonical name). */
function regionLow(lv: Level, occupied: Uint8Array, from: number, seen: Int32Array, stamp: number, stack: Int32Array): number {
  const { w, wall } = lv;
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n]!;
    if (p < low) low = p;
    for (const [dx, dy] of DIRS) {
      const q = p + dy * w + dx;
      if (q >= 0 && q < wall.length && !wall[q] && !occupied[q] && seen[q] !== stamp) {
        seen[q] = stamp;
        stack[n++] = q;
      }
    }
  }
  return low;
}

/** Shortest walk from `from` to `to` around walls and boxes, lower LURD letters;
 *  ties go to the first direction (u, d, l, r). Throws when unreachable. */
function walkTo(lv: Level, occupied: Uint8Array, from: number, to: number): string {
  const { w, wall } = lv;
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how: string[] = new Array(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    if (p === to) break;
    for (const [dx, dy, letter] of DIRS) {
      const q = p + dy * w + dx;
      if (q < 0 || q >= wall.length || wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = letter;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: push square out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]!) s = how[p]! + s;
  return s;
}

/** The square the player stands on after `moves` from `from` on a board `w` wide. */
function endOf(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  return p;
}

/** Replay `moves` on the level: true only when every step is legal and every box
 *  ends on a goal. The final gate before an answer is written. */
function verify(text: string, moves: string): boolean {
  const lv = parse(text);
  const { w, wall } = lv;
  const goal = new Uint8Array(wall.length);
  for (const g of lv.goals) goal[g] = 1;
  const box = new Uint8Array(wall.length);
  for (const b of lv.boxes) box[b] = 1;
  let player = lv.player;
  for (const ch of moves.toLowerCase()) {
    if (!'udlr'.includes(ch)) return false;
    const [dx, dy] = DIRS['udlr'.indexOf(ch)]!;
    const d = dy * w + dx;
    const next = player + d;
    if (next < 0 || next >= wall.length || wall[next]) return false;
    if (box[next]) {
      const beyond = next + d;
      if (beyond < 0 || beyond >= wall.length || wall[beyond] || box[beyond]) return false;
      box[next] = 0;
      box[beyond] = 1;
    }
    player = next;
  }
  for (let i = 0; i < box.length; i++) if (box[i] && !goal[i]) return false;
  return true;
}

export interface RoomResult {
  pushes: number;
  moves: string;
  expansions: number;
  states: number;
}

/**
 * Push-optimal A* over one room (or a whole level): a state is the sorted boxes
 * plus the player's reachable region (named by its lowest square); every push
 * costs 1; the heuristic is the min-cost matching of boxes to goals over true
 * shortest-path distances, which never overestimates the pushes still needed,
 * so the first solved state generated is push-optimal: it is reached from a
 * popped node of minimum f, and any other solution costs at least that f,
 * which is at least the generated solution's pushes (the heuristic of an
 * unsolved state is at least 1). Dead squares and frozen 2x2 blocks are pruned. The search stops after `budget` expansions, never on
 * the clock. Returns null when the budget runs out or the room is unsolvable.
 */
export function solveRoom(lv: Level, budget: number): RoomResult | null {
  const { w, wall, goals } = lv;
  const size = wall.length;
  const n = lv.boxes.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(lv);
  for (const b of lv.boxes) if (!live[b]) return null;
  const solved = (bs: number[]): boolean => {
    for (const b of bs) if (!goal[b]) return false;
    return true;
  };
  if (solved(lv.boxes)) return { pushes: 0, moves: '', expansions: 0, states: 1 };
  // Distances from each goal, for the matching heuristic.
  const dist = goals.map((g) => bfsDist(lv, g));
  const hCache = new Map<string, number>();
  const heuristic = (bs: number[]): number => {
    const k = bs.join(',');
    const cached = hCache.get(k);
    if (cached !== undefined) return cached;
    const cost: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row: number[] = [];
      for (let j = 0; j < n; j++) {
        const d = dist[j]![bs[i]!]!;
        row.push(d < 0 ? BIG : d);
      }
      cost.push(row);
    }
    const h = hungarian(cost);
    hCache.set(k, h);
    return h;
  };

  // The states, in discovery order: boxes, player square after the push that
  // made them, parent, push direction, pushes so far, and the region key.
  const nBoxes: number[][] = [lv.boxes.slice()];
  const nPlayer: number[] = [lv.player];
  const nParent: number[] = [-1];
  const nPush: number[] = [-1];
  const nKey: string[] = [];
  const occupied = new Uint8Array(size);
  const occ2 = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;
  // NB: keyOf floods into `mark`, never `seen`: the expansion's region marks in
  // `seen` must survive while its pushes are enumerated, or every push after
  // the first would read a clobbered region and be skipped.
  const keyOf = (bs: number[], from: number): string => {
    occ2.fill(0);
    for (const b of bs) occ2[b] = 1;
    const low = regionLow(lv, occ2, from, mark, ++stamp, stack);
    return `${low}:${bs.join(',')}`;
  };
  nKey.push(keyOf(lv.boxes, lv.player));
  const best = new Map<string, number>([[nKey[0]!, 0]]);
  const h0 = heuristic(lv.boxes);
  if (!Number.isFinite(h0)) return null;

  // Binary heap on [f, g, seq, node]: lowest f first, deeper g first on a tie,
  // then earliest discovered — fully deterministic.
  const heap: [number, number, number, number][] = [[h0, 0, 0, 0]];
  let seq = 1;
  const less = (a: [number, number, number, number], b: [number, number, number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] < b[2])));
  const heapPush = (e: [number, number, number, number]): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const heapPop = (): [number, number, number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1]!, heap[c]!)) c++;
        if (!less(heap[c]!, heap[i]!)) break;
        [heap[i], heap[c]] = [heap[c]!, heap[i]!];
        i = c;
      }
    }
    return top;
  };

  let expanded = 0;
  let found = -1;
  while (heap.length > 0) {
    const [, g, , idx] = heapPop();
    if (best.get(nKey[idx]!) !== g) continue;
    const bs = nBoxes[idx]!;
    if (solved(bs)) {
      found = idx;
      break;
    }
    if (expanded >= budget) return null;
    expanded++;
    const pl = nPlayer[idx]!;
    for (const b of bs) occupied[b] = 1;
    const here = ++stamp;
    regionLow(lv, occupied, pl, seen, here, stack);
    for (let bi = 0; bi < bs.length; bi++) {
      const b = bs[bi]!;
      for (let di = 0; di < 4; di++) {
        const [dx, dy] = DIRS[di]!;
        const d = dy * w + dx;
        if (seen[b - d] !== here) continue;
        const t = b + d;
        if (t < 0 || t >= size || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen = frozenBlock(lv, occupied, goal, t);
        occupied[t] = 0;
        occupied[b] = 1;
        if (frozen) continue;
        const next = bs.slice();
        next[bi] = t;
        next.sort((x, y) => x - y);
        const key = keyOf(next, b);
        const ng = g + 1;
        const prev = best.get(key);
        if (prev !== undefined && prev <= ng) continue;
        const h = heuristic(next);
        if (!Number.isFinite(h)) continue;
        best.set(key, ng);
        const ni = nBoxes.length;
        nBoxes.push(next);
        nPlayer.push(b);
        nParent.push(idx);
        nPush.push(di);
        nKey.push(key);
        heapPush([ng + h, ng, seq++, ni]);
        if (solved(next)) {
          found = ni;
          break;
        }
      }
      if (found >= 0) break;
    }
    for (const b of bs) occupied[b] = 0;
    if (found >= 0) break;
  }
  if (found < 0) return null;
  // Rebuild the pushes, then expand each into a walk plus its push.
  const path: number[] = [];
  for (let s = found; s > 0; s = nParent[s]!) path.push(s);
  path.reverse();
  let moves = '';
  let player = lv.player;
  let boxes = lv.boxes;
  for (const s of path) {
    const next = nBoxes[s]!;
    const di = nPush[s]!;
    const [dx, dy] = DIRS[di]!;
    const d = dy * w + dx;
    const from = boxes.find((b) => !next.includes(b))!;
    const to = next.find((b) => !boxes.includes(b))!;
    if (to - from !== d) throw new Error('solveRoom: inconsistent push');
    for (const b of boxes) occupied[b] = 1;
    moves += walkTo(lv, occupied, player, from - d);
    for (const b of boxes) occupied[b] = 0;
    moves += DIRS[di]![3];
    player = from;
    boxes = next;
  }
  return { pushes: path.length, moves, expansions: expanded, states: nBoxes.length };
}

interface Room {
  boxes: number[];
  goals: number[];
}

/**
 * Split a level into rooms: cut the dead squares of the player's row (the
 * hallway — a box there reaches no goal) out of the floor, and each remaining
 * part holding a box is a room. Null when the level is no set of rooms: a box
 * starts in the hallway, a goal is cut off, or some part's boxes and goals
 * do not match. Rooms come back in scan order, which is deterministic.
 */
function decompose(lv: Level): Room[] | null {
  const { w, wall, goals, boxes } = lv;
  const size = wall.length;
  const live = liveSquares(lv);
  const row = Math.floor(lv.player / w);
  const cut = new Uint8Array(size);
  for (let x = 0; x < w; x++) {
    const i = row * w + x;
    if (!wall[i] && !live[i]) cut[i] = 1;
  }
  if (boxes.some((b) => cut[b])) return null;
  const comp = new Int32Array(size).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < size; s++) {
    if (wall[s] || cut[s] || comp[s] >= 0) continue;
    const idx = rooms.length;
    const squares = [s];
    comp[s] = idx;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = squares[i]! + dy * w + dx;
        if (q >= 0 && q < size && !wall[q] && !cut[q] && comp[q] < 0) {
          comp[q] = idx;
          squares.push(q);
        }
      }
    }
    rooms.push({ boxes: [], goals: [] });
  }
  for (const b of boxes) rooms[comp[b]!]!.boxes.push(b);
  for (const g of goals) {
    if (comp[g]! < 0) return null;
    rooms[comp[g]!]!.goals.push(g);
  }
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/** Node budgets, counted in expansions — work, never the clock. */
const ROOM_BUDGET = 300_000;
const ROOM_RETRY_BUDGET = 1_200_000;
const WHOLE_BUDGET = 1_000_000;

function solveWhole(lv: Level): RoomResult | null {
  return solveRoom(lv, WHOLE_BUDGET);
}

/** Solve one level: room by room, the other rooms' boxes standing as walls
 *  (on their goals once their room is done), the player walking on from where
 *  the last room left it. A room that exhausts its budget gets one retry with
 *  a bigger one; a level that is no set of rooms, or a room that still fails,
 *  falls back to a search over the whole level. An empty answer is the last
 *  resort: valid, worth 0, never illegal. */
function solveLevel(text: string): { moves: string; stats: RoomResult[] } {
  const lv = parse(text);
  const goal = new Uint8Array(lv.wall.length);
  for (const g of lv.goals) goal[g] = 1;
  if (lv.boxes.every((b) => goal[b])) return { moves: '', stats: [] };
  const rooms = decompose(lv);
  if (rooms !== null) {
    let player = lv.player;
    let moves = '';
    const stats: RoomResult[] = [];
    const done: boolean[] = rooms.map(() => false);
    for (let ri = 0; ri < rooms.length; ri++) {
      const wall2 = lv.wall.slice();
      for (let oj = 0; oj < rooms.length; oj++) {
        if (oj === ri) continue;
        const src = done[oj] ? rooms[oj]!.goals : rooms[oj]!.boxes;
        for (const b of src) wall2[b] = 1;
      }
      const sub: Level = {
        w: lv.w,
        h: lv.h,
        wall: wall2,
        goals: rooms[ri]!.goals.slice().sort((a, b) => a - b),
        boxes: rooms[ri]!.boxes.slice().sort((a, b) => a - b),
        player,
      };
      let r = solveRoom(sub, ROOM_BUDGET);
      if (r === null) r = solveRoom(sub, ROOM_RETRY_BUDGET);
      if (r === null) {
        const whole = solveWhole(lv);
        if (whole !== null && verify(text, whole.moves)) return { moves: whole.moves, stats: [whole] };
        return { moves: '', stats };
      }
      stats.push(r);
      moves += r.moves;
      player = endOf(lv.w, player, r.moves);
      done[ri] = true;
    }
    if (verify(text, moves)) return { moves, stats };
    const whole = solveWhole(lv);
    if (whole !== null && verify(text, whole.moves)) return { moves: whole.moves, stats: [whole] };
    return { moves: '', stats };
  }
  const whole = solveWhole(lv);
  if (whole !== null && verify(text, whole.moves)) return { moves: whole.moves, stats: [whole] };
  return { moves: '', stats: [] };
}

for (const id of readdirSync(I).sort()) {
  const text = readFileSync(join(I, id, 'level.txt'), 'utf8');
  const { moves } = solveLevel(text);
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
