// block-beta layout: the author places blocks on nested grids; only connectors are routed.
import { sizeNode } from "./layout.mjs";
import { plain } from "./rich.mjs";
import { strWidth } from "./text.mjs";

const COL_GAP = 8;
const ROW_GAP = 4;
// A framed group: border + blank column on each side, border + blank row above and below.
const PAD_X = 3;
const PAD_Y = 2;
const SPACE_SIZE = { w: 8, h: 1 };

const sum = (values) => values.reduce((a, b) => a + b, 0);

// Spreads `extra` cells over `sizes` as evenly as integers allow.
function spread(sizes, extra) {
  for (let i = 0; i < sizes.length && extra > 0; i += 1) {
    const share = Math.ceil(extra / (sizes.length - i));
    sizes[i] += share;
    extra -= share;
  }
}

// ------------------------------------------------------------ grid cells

function assignCells(group, parent = null) {
  group.parent = parent;
  const kids = group.children;
  const cols = group.columns ?? Math.max(1, sum(kids.map((k) => k.span)));
  let row = 0;
  let col = 0;
  for (const k of kids) {
    k.span = Math.min(Math.max(1, k.span), cols);
    if (col + k.span > cols) {
      row += 1;
      col = 0;
    }
    Object.assign(k, { row, col, parent: group });
    col += k.span;
    if (k.kind === "group") assignCells(k, group);
  }
  group.cols = cols;
  group.rows = kids.length ? row + 1 : 0;
  group.colGaps = Array(Math.max(0, cols - 1)).fill(COL_GAP);
  group.rowGaps = Array(Math.max(0, group.rows - 1)).fill(ROW_GAP);
}

const ancestry = (item) => {
  const out = [];
  for (let x = item; x; x = x.parent) out.push(x);
  return out;
};

// Widens the gap between two neighbouring cells so an edge label fits.
function reserveLabelSpace(cellA, cellB, label) {
  const upA = ancestry(cellA);
  const upB = new Set(ancestry(cellB));
  const common = upA.find((g) => upB.has(g) && g.kind === "group");
  if (!common) return;
  const a = upA[upA.indexOf(common) - 1];
  const b = ancestry(cellB)[ancestry(cellB).indexOf(common) - 1];
  if (!a || !b) return;
  const width = label ? Math.max(...label.map((l) => strWidth(plain(l)))) : 0;
  if (a.row === b.row) {
    const [l, r] = a.col < b.col ? [a, b] : [b, a];
    if (l.col + l.span === r.col) common.colGaps[r.col - 1] = Math.max(common.colGaps[r.col - 1], width + 6);
  } else if (Math.abs(a.row - b.row) === 1 && label) {
    const top = Math.min(a.row, b.row);
    common.rowGaps[top] = Math.max(common.rowGaps[top], label.length + 2);
  }
}

// ------------------------------------------------------------ sizes and positions

function measure(group, titles) {
  for (const k of group.children) {
    if (k.kind === "group") k.size = measure(k, titles);
    else if (k.kind === "space") k.size = { ...SPACE_SIZE };
    else k.size = sizeNode(k.node, titles);
  }
  const colW = Array(group.cols).fill(0);
  const rowH = Array(group.rows).fill(0);
  // Boxes in a row share the tallest box's height; a taller framed group doesn't stretch them.
  const boxH = Array(group.rows).fill(0);
  for (const k of group.children) {
    rowH[k.row] = Math.max(rowH[k.row], k.size.h);
    if (k.kind === "node") boxH[k.row] = Math.max(boxH[k.row], k.size.h);
    if (k.span === 1) colW[k.col] = Math.max(colW[k.col], k.size.w);
  }
  for (const k of group.children.filter((c) => c.span > 1)) {
    const have = sum(colW.slice(k.col, k.col + k.span)) + sum(group.colGaps.slice(k.col, k.col + k.span - 1));
    if (have < k.size.w) {
      const part = colW.slice(k.col, k.col + k.span);
      spread(part, k.size.w - have);
      part.forEach((w, i) => (colW[k.col + i] = w));
    }
  }
  const [px, py] = group.frame ? [PAD_X, PAD_Y] : [0, 0];
  let w = sum(colW) + sum(group.colGaps) + 2 * px;
  if (group.title) {
    const need = strWidth(group.title) + 6;
    if (w < need) {
      colW[colW.length - 1] += need - w;
      w = need;
    }
  }
  Object.assign(group, { colW, rowH, boxH });
  return { w, h: sum(rowH) + sum(group.rowGaps) + 2 * py };
}

function place(group, x, y, w, h, out) {
  group.rect = { x, y, w, h };
  const [px, py] = group.frame ? [PAD_X, PAD_Y] : [0, 0];
  const colW = [...group.colW];
  const rowH = [...group.rowH];
  spread(colW, w - 2 * px - sum(colW) - sum(group.colGaps));
  spread(rowH, h - 2 * py - sum(rowH) - sum(group.rowGaps));
  const colX = colW.map((_, c) => x + px + sum(colW.slice(0, c)) + sum(group.colGaps.slice(0, c)));
  const rowY = rowH.map((_, r) => y + py + sum(rowH.slice(0, r)) + sum(group.rowGaps.slice(0, r)));
  if (group.frame) out.frames.push(group);
  for (const k of group.children) {
    const kx = colX[k.col];
    const kw = sum(colW.slice(k.col, k.col + k.span)) + sum(group.colGaps.slice(k.col, k.col + k.span - 1));
    if (k.kind === "group") place(k, kx, rowY[k.row], kw, rowH[k.row], out);
    else if (k.kind === "node") out.boxes.push({ node: k.node, x: kx, y: rowY[k.row], w: kw, h: group.boxH[k.row] });
  }
}

// ------------------------------------------------------------ connectors

const center = (lo, size) => lo + Math.floor((size - 1) / 2);

// Cell just outside a box side, at position p along that side.
function outside(box, side, p) {
  if (side === "l") return [box.x - 1, p];
  if (side === "r") return [box.x + box.w, p];
  if (side === "t") return [p, box.y - 1];
  return [p, box.y + box.h];
}

// First row a side connector may use: below the border, and below a cylinder's lid.
const firstRow = (box) => box.y + (box.node.shape === "cylinder" ? 2 : 1);

// Positions along a side that a connector may use (never a corner).
function sideRange(box, side) {
  return side === "l" || side === "r" ? [firstRow(box), box.y + box.h - 2] : [box.x + 1, box.x + box.w - 2];
}

function cells(points) {
  const out = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    let [x, y] = points[i];
    const [x1, y1] = points[i + 1];
    out.push([x, y]);
    while (x !== x1 || y !== y1) {
      x += Math.sign(x1 - x);
      y += Math.sign(y1 - y);
      out.push([x, y]);
    }
  }
  return out;
}

function router(boxes, frames) {
  const used = new Map();
  const lineCells = new Set();
  const frameCells = new Set();
  const titleCells = new Set();
  for (const f of frames) {
    for (let x = f.x; x < f.x + (f.title ? strWidth(f.title) + 4 : 0); x += 1) titleCells.add(`${x},${f.y}`);
    for (let x = f.x; x < f.x + f.w; x += 1) frameCells.add(`${x},${f.y}`).add(`${x},${f.y + f.h - 1}`);
    for (let y = f.y; y < f.y + f.h; y += 1) frameCells.add(`${f.x},${y}`).add(`${f.x + f.w - 1},${y}`);
  }
  const key = (box, side) => `${box.node.id}:${side}`;
  const taken = (box, side, p) => used.get(key(box, side))?.has(p);

  // Free positions on a side, nearest to `pref` first; ones with free neighbours come first.
  const portOrder = (box, side, pref, [lo, hi] = sideRange(box, side)) => {
    const all = [];
    for (let p = lo; p <= hi; p += 1) if (!taken(box, side, p)) all.push(p);
    // A narrow side that is full gets shared rather than skipped.
    if (!all.length) for (let p = lo; p <= hi; p += 1) all.push(p);
    const roomy = (p) => !taken(box, side, p - 1) && !taken(box, side, p + 1);
    return all.sort((a, b) => Number(roomy(b)) - Number(roomy(a)) || Math.abs(a - pref) - Math.abs(b - pref));
  };

  const score = (points, a, b) => {
    let s = 0;
    const path = cells(points);
    for (const [x, y] of path) {
      for (const box of boxes) {
        if (box === a || box === b) continue;
        if (x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h) s += 100;
        // Hugging another box's border reads as touching it.
        else if (x >= box.x - 1 && x <= box.x + box.w && y >= box.y - 1 && y <= box.y + box.h) s += 2;
      }
      if (titleCells.has(`${x},${y}`)) s += 30;
      if (lineCells.has(`${x},${y}`)) s += 8;
      // Crossing a frame border is fine; running along or right beside one is not.
      if (frameCells.has(`${x},${y}`)) s += 3;
      else if (frameCells.has(`${x - 1},${y}`) || frameCells.has(`${x + 1},${y}`) || frameCells.has(`${x},${y - 1}`) || frameCells.has(`${x},${y + 1}`)) s += 2;
    }
    return s + path.length + (points.length - 2) * 4;
  };

  return function route(a, b) {
    const options = [];
    const acx = center(a.x, a.w);
    const acy = center(a.y, a.h);
    const bcx = center(b.x, b.w);
    const bcy = center(b.y, b.h);
    const right = b.x >= a.x + a.w + 2;
    const left = a.x >= b.x + b.w + 2;
    const below = b.y >= a.y + a.h + 2;
    const above = a.y >= b.y + b.h + 2;

    // Straight across, on a row (or column) both boxes share.
    if (right || left) {
      const [sa, sb] = right ? ["r", "l"] : ["l", "r"];
      const lo = Math.max(firstRow(a), firstRow(b));
      const hi = Math.min(a.y + a.h - 2, b.y + b.h - 2);
      const y = portOrder(a, sa, Math.floor((lo + hi) / 2), [lo, hi]).find((p) => !taken(b, sb, p));
      if (y !== undefined) options.push({ points: [outside(a, sa, y), outside(b, sb, y)], ports: [[a, sa, y], [b, sb, y]] });
    }
    if (below || above) {
      const [sa, sb] = below ? ["b", "t"] : ["t", "b"];
      const lo = Math.max(a.x + 1, b.x + 1);
      const hi = Math.min(a.x + a.w - 2, b.x + b.w - 2);
      const x = portOrder(a, sa, Math.floor((lo + hi) / 2), [lo, hi]).find((p) => !taken(b, sb, p));
      if (x !== undefined) options.push({ points: [outside(a, sa, x), outside(b, sb, x)], ports: [[a, sa, x], [b, sb, x]] });
    }
    // One bend: across then down/up into the target, or down/up then across.
    if ((right || left) && (below || above)) {
      const sa = right ? "r" : "l";
      const sb = below ? "t" : "b";
      const y = portOrder(a, sa, acy)[0];
      const x = portOrder(b, sb, bcx)[0];
      if (y !== undefined && x !== undefined) options.push({ points: [outside(a, sa, y), [x, y], outside(b, sb, x)], ports: [[a, sa, y], [b, sb, x]] });
      const sa2 = below ? "b" : "t";
      const sb2 = right ? "l" : "r";
      const x2 = portOrder(a, sa2, acx)[0];
      const y2 = portOrder(b, sb2, bcy)[0];
      if (x2 !== undefined && y2 !== undefined) options.push({ points: [outside(a, sa2, x2), [x2, y2], outside(b, sb2, y2)], ports: [[a, sa2, x2], [b, sb2, y2]] });
    }
    // Two bends through a gap: across, along a free column, across again (or the vertical mirror).
    if (right || left) {
      const [sa, sb] = right ? ["r", "l"] : ["l", "r"];
      const y1 = portOrder(a, sa, acy)[0];
      const y2 = portOrder(b, sb, bcy)[0];
      const [x0, x1] = right ? [a.x + a.w + 1, b.x - 2] : [b.x + b.w + 1, a.x - 2];
      if (y1 !== undefined && y2 !== undefined && y1 !== y2) {
        for (let gx = x0; gx <= x1; gx += 1) {
          options.push({ points: [outside(a, sa, y1), [gx, y1], [gx, y2], outside(b, sb, y2)], ports: [[a, sa, y1], [b, sb, y2]] });
        }
      }
    }
    if (below || above) {
      const [sa, sb] = below ? ["b", "t"] : ["t", "b"];
      const x1 = portOrder(a, sa, acx)[0];
      const x2 = portOrder(b, sb, bcx)[0];
      const [y0, y1] = below ? [a.y + a.h + 1, b.y - 2] : [b.y + b.h + 1, a.y - 2];
      if (x1 !== undefined && x2 !== undefined && x1 !== x2) {
        for (let gy = y0; gy <= y1; gy += 1) {
          options.push({ points: [outside(a, sa, x1), [x1, gy], [x2, gy], outside(b, sb, x2)], ports: [[a, sa, x1], [b, sb, x2]] });
        }
      }
    }
    // Around: out of the same side of both boxes and back in through the gap beyond them.
    for (const side of ["t", "b", "l", "r"]) {
      const pa = portOrder(a, side, side === "t" || side === "b" ? acx : acy)[0];
      const pb = portOrder(b, side, side === "t" || side === "b" ? bcx : bcy)[0];
      if (pa === undefined || pb === undefined) continue;
      const [ax, ay] = outside(a, side, pa);
      const [bx, by] = outside(b, side, pb);
      const points =
        side === "t" ? [[ax, ay], [ax, Math.min(ay, by) - 1], [bx, Math.min(ay, by) - 1], [bx, by]]
        : side === "b" ? [[ax, ay], [ax, Math.max(ay, by) + 1], [bx, Math.max(ay, by) + 1], [bx, by]]
        : side === "l" ? [[ax, ay], [Math.min(ax, bx) - 2, ay], [Math.min(ax, bx) - 2, by], [bx, by]]
        : [[ax, ay], [Math.max(ax, bx) + 2, ay], [Math.max(ax, bx) + 2, by], [bx, by]];
      options.push({ points, ports: [[a, side, pa], [b, side, pb]], detour: true });
    }

    let best = null;
    for (const option of options) {
      option.score = score(option.points, a, b) + (option.detour ? 12 : 0);
      if (!best || option.score < best.score) best = option;
    }
    if (!best) return null;
    for (const [box, side, p] of best.ports) {
      if (!used.has(key(box, side))) used.set(key(box, side), new Set());
      used.get(key(box, side)).add(p);
    }
    for (const [x, y] of cells(best.points)) lineCells.add(`${x},${y}`);
    return best.points;
  };
}

// Label spots along the longest horizontal run (above/below), then beside the longest vertical run.
function labelCandidates(points, label) {
  const lines = label.map(plain);
  const width = Math.max(...lines.map(strWidth));
  let hRun = null;
  let vRun = null;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [[x0, y0], [x1, y1]] = [points[i], points[i + 1]];
    const length = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    if (y0 === y1 && (!hRun || length > hRun.length)) hRun = { length, y: y0, lo: Math.min(x0, x1), hi: Math.max(x0, x1) };
    if (x0 === x1 && (!vRun || length > vRun.length)) vRun = { length, x: x0, lo: Math.min(y0, y1), hi: Math.max(y0, y1) };
  }
  const cands = [];
  if (hRun && hRun.length - 2 >= width) {
    const at = (t) => Math.round((hRun.lo + hRun.hi) / 2 - strWidth(t) / 2);
    const { y } = hRun;
    if (lines.length === 1) {
      cands.push({ items: [{ x: at(lines[0]), y: y - 1, text: lines[0] }] }, { items: [{ x: at(lines[0]), y: y + 1, text: lines[0] }] });
    } else {
      cands.push({ items: lines.map((t, i) => ({ x: at(t), y: i === 0 ? y - 1 : y + i, text: t })) });
      cands.push({ items: lines.map((t, i) => ({ x: at(t), y: y - lines.length + i, text: t })) });
      cands.push({ items: lines.map((t, i) => ({ x: at(t), y: y + 1 + i, text: t })) });
    }
  }
  if (vRun) {
    const top = Math.round((vRun.lo + vRun.hi) / 2 - (lines.length - 1) / 2);
    cands.push({ items: lines.map((t, i) => ({ x: vRun.x + 2, y: top + i, text: t })) });
    cands.push({ items: lines.map((t, i) => ({ x: vRun.x - 1 - strWidth(t), y: top + i, text: t })) });
  }
  if (hRun && lines.length === 1) {
    const t = ` ${lines[0]} `;
    cands.push({ inline: true, items: [{ x: Math.round((hRun.lo + hRun.hi) / 2 - strWidth(t) / 2), y: hRun.y, text: t }] });
  }
  return cands;
}

export function layoutBlocks(graph, { titles = true } = {}) {
  const cellOf = new Map();
  const groupOf = new Map();
  const walk = (group) => {
    for (const k of group.children) {
      if (k.kind === "group") {
        if (k.id) {
          cellOf.set(k.id, k);
          groupOf.set(k.id, k);
        }
        walk(k);
      } else if (k.kind === "node") {
        k.node = graph.nodes.get(k.id);
        cellOf.set(k.id, k);
      }
    }
  };
  walk(graph.root);
  assignCells(graph.root);
  for (const e of graph.edges) {
    const [a, b] = [cellOf.get(e.from), cellOf.get(e.to)];
    if (a && b && a !== b) reserveLabelSpace(a, b, e.label);
  }
  const size = measure(graph.root, titles);
  const scene = { boxes: [], frames: [], routes: [], labels: [], selfLoops: [] };
  const placed = { boxes: scene.boxes, frames: [] };
  place(graph.root, 0, 0, size.w, size.h, placed);
  scene.frames = placed.frames.map((g) => ({ title: g.title, sg: { color: g.color }, ...g.rect }));

  const boxOf = new Map(scene.boxes.map((b) => [b.node.id, b]));
  // A group's frame is an edge endpoint like any box.
  for (const [id, g] of groupOf) {
    if (!boxOf.has(id)) boxOf.set(id, { node: { id, shape: "rect", style: { stroke: g.color } }, ...g.rect });
  }
  const route = router(scene.boxes, scene.frames);
  for (const e of graph.edges) {
    if (!boxOf.has(e.from) || !boxOf.has(e.to)) continue;
    const edge = { ...e, source: boxOf.get(e.from).node, target: boxOf.get(e.to).node };
    if (e.from === e.to) {
      scene.selfLoops.push(edge);
      continue;
    }
    const points = route(boxOf.get(e.from), boxOf.get(e.to));
    if (!points) continue;
    scene.routes.push({ edge, points });
    if (e.label) {
      const cands = labelCandidates(points, e.label);
      if (cands.length) scene.labels.push(cands);
    }
  }

  // Detours may leave the grid; shift so everything starts at (0, 0).
  const preferred = scene.labels.flatMap((c) => c[0].items);
  const xs = [...scene.boxes, ...scene.frames, ...preferred].map((b) => b.x).concat(scene.routes.flatMap((r) => r.points.map((p) => p[0])));
  const ys = [...scene.boxes, ...scene.frames, ...preferred].map((b) => b.y).concat(scene.routes.flatMap((r) => r.points.map((p) => p[1])));
  const [dx, dy] = [Math.min(0, ...xs), Math.min(0, ...ys)];
  for (const b of [...scene.boxes, ...scene.frames, ...scene.labels.flatMap((c) => c.flatMap((x) => x.items))]) {
    b.x -= dx;
    b.y -= dy;
  }
  for (const r of scene.routes) r.points = r.points.map(([x, y]) => [x - dx, y - dy]);
  return scene;
}
