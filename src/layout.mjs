// Layered (Sugiyama-style) layout on a character grid.
// Everything is computed on an abstract "main" axis (rank direction) and "cross" axis,
// then mapped to x/y: TB/BT use main = y, LR/RL use main = x.
import { plain } from "./rich.mjs";
import { strWidth } from "./text.mjs";

// Cells between a frame and what it encloses, per nesting level.
const FRAME_PAD = 2;

// Natural box size; with `titles`, a multi-line label's first line moves to the top border.
export function sizeNode(n, titles = true) {
  if (n.shape === "arrow") {
    // Block arrows: a shaft long enough to read as an arrow, with the label beside or over it.
    n.title = null;
    n.body = n.lines.filter((line) => line.trim());
    const label = Math.max(0, ...n.body.map((line) => strWidth(plain(line))));
    const vertical = n.arrow === "up" || n.arrow === "down" || n.arrow === "y";
    return vertical ? { w: Math.max(5, label + 4), h: Math.max(3, n.body.length + 2) } : { w: Math.max(8, label + 6), h: 3 };
  }
  n.title = titles && n.lines.length > 1 ? plain(n.lines[0]) : null;
  n.body = n.title ? n.lines.slice(1) : n.lines;
  let w = Math.max(...n.body.map((line) => strWidth(plain(line)))) + 4;
  if (n.title) w = Math.max(w, strWidth(n.title) + 6);
  if (n.shape === "diamond" || n.shape === "hexagon") w += 2;
  return { w, h: n.body.length + 2 + (n.shape === "cylinder" ? 1 : 0) };
}

export function layoutGraph(graph, { titles = true } = {}) {
  const horizontal = graph.direction === "LR" || graph.direction === "RL";
  const flip = graph.direction === "BT" || graph.direction === "RL";

  // ------------------------------------------------------------ subgraph tree
  const sgById = new Map(graph.subgraphs.map((s) => [s.id, { ...s, children: [] }]));
  for (const sg of sgById.values()) if (sg.parent) sgById.get(sg.parent)?.children.push(sg);
  const level = (sg) => 1 + Math.max(0, ...sg.children.map(level));
  for (const sg of sgById.values()) sg.level = level(sg);
  const ancestry = (id) => {
    const out = [];
    while (id && sgById.has(id)) {
      out.unshift(id);
      id = sgById.get(id).parent;
    }
    return out;
  };

  // ------------------------------------------------------------ nodes and edges
  const nodes = [...graph.nodes.values()].map((n, index) => ({
    ...n,
    index,
    dummy: false,
    groups: ancestry(n.parent),
    inSegs: [],
    outSegs: [],
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = graph.edges
    .map((e) => ({ ...e, source: byId.get(e.from), target: byId.get(e.to) }))
    .filter((e) => e.source && e.target);
  const selfLoops = edges.filter((e) => e.source === e.target);
  const real = edges.filter((e) => e.source !== e.target);

  // Break cycles: edges that close a DFS cycle are laid out reversed.
  const outgoing = new Map(nodes.map((n) => [n, []]));
  for (const e of real) outgoing.get(e.source).push(e);
  const state = new Map();
  const visit = (n) => {
    state.set(n, 1);
    for (const e of outgoing.get(n)) {
      const s = state.get(e.target);
      if (s === 1) e.reversed = true;
      else if (!s) visit(e.target);
    }
    state.set(n, 2);
  };
  for (const n of nodes) if (!state.get(n)) visit(n);
  for (const e of real) {
    e.u = e.reversed ? e.target : e.source;
    e.v = e.reversed ? e.source : e.target;
  }

  // ------------------------------------------------------------ ranks (longest path)
  const preds = new Map(nodes.map((n) => [n, []]));
  const succs = new Map(nodes.map((n) => [n, []]));
  for (const e of real) {
    preds.get(e.v).push(e.u);
    succs.get(e.u).push(e.v);
  }
  const indegree = new Map(nodes.map((n) => [n, preds.get(n).length]));
  const queue = nodes.filter((n) => indegree.get(n) === 0);
  for (const n of nodes) n.rank = 0;
  while (queue.length) {
    const n = queue.shift();
    for (const v of succs.get(n)) {
      v.rank = Math.max(v.rank, n.rank + 1);
      indegree.set(v, indegree.get(v) - 1);
      if (indegree.get(v) === 0) queue.push(v);
    }
  }
  // Sources sit right above their nearest child instead of at the very top.
  for (const n of nodes) {
    if (preds.get(n).length === 0 && succs.get(n).length) n.rank = Math.min(...succs.get(n).map((v) => v.rank)) - 1;
  }

  // ------------------------------------------------------------ dummies for long edges
  const all = [...nodes];
  const segments = [];
  for (const e of real) {
    const common = [];
    for (let i = 0; i < e.u.groups.length && e.u.groups[i] === e.v.groups[i]; i += 1) common.push(e.u.groups[i]);
    let prev = e.u;
    e.segs = [];
    for (let r = e.u.rank + 1; r <= e.v.rank; r += 1) {
      const next = r === e.v.rank ? e.v : { id: `·${all.length}`, dummy: true, rank: r, groups: common, inSegs: [], outSegs: [], index: all.length };
      if (next.dummy) all.push(next);
      const seg = { u: prev, v: next, edge: e };
      prev.outSegs.push(seg);
      next.inSegs.push(seg);
      segments.push(seg);
      e.segs.push(seg);
      prev = next;
    }
  }

  const rankCount = Math.max(0, ...all.map((n) => n.rank)) + 1;
  let layers = Array.from({ length: rankCount }, () => []);
  for (const n of all) layers[n.rank].push(n);

  // ------------------------------------------------------------ ordering (barycenter, grouped by subgraph)
  const position = new Map();
  const indexLayers = () => layers.forEach((layer) => layer.forEach((n, i) => position.set(n, i)));
  indexLayers();

  const groupSort = (layer, key) => {
    const root = { items: [], children: new Map() };
    for (const n of layer) {
      let t = root;
      for (const g of n.groups) {
        if (!t.children.has(g)) t.children.set(g, { items: [], children: new Map() });
        t = t.children.get(g);
      }
      t.items.push(n);
    }
    const flatten = (t) => {
      const entries = [
        ...t.items.map((n) => ({ bc: key(n), nodes: [n] })),
        ...[...t.children.values()].map((c) => {
          const ns = flatten(c);
          return { bc: ns.reduce((s, n) => s + key(n), 0) / ns.length, nodes: ns };
        }),
      ];
      entries.sort((a, b) => a.bc - b.bc);
      return entries.flatMap((e) => e.nodes);
    };
    return flatten(root);
  };

  const crossings = () => {
    let count = 0;
    for (const segs of layers.map((layer) => layer.flatMap((n) => n.outSegs))) {
      for (let i = 0; i < segs.length; i += 1) {
        for (let j = i + 1; j < segs.length; j += 1) {
          const du = position.get(segs[i].u) - position.get(segs[j].u);
          const dv = position.get(segs[i].v) - position.get(segs[j].v);
          if (du * dv < 0) count += 1;
        }
      }
    }
    return count;
  };

  const mean = (values, fallback) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : fallback);
  layers = layers.map((layer) => groupSort(layer, (n) => position.get(n)));
  indexLayers();
  let best = { score: crossings(), layers: layers.map((l) => [...l]) };
  for (let iter = 0; iter < 24 && best.score > 0; iter += 1) {
    const down = iter % 2 === 0;
    const order = down ? [...layers.keys()].slice(1) : [...layers.keys()].reverse().slice(1);
    for (const r of order) {
      const key = (n) => mean((down ? n.inSegs.map((s) => s.u) : n.outSegs.map((s) => s.v)).map((m) => position.get(m)), position.get(n));
      layers[r] = groupSort(layers[r], key);
      layers[r].forEach((n, i) => position.set(n, i));
    }
    const score = crossings();
    if (score < best.score) best = { score, layers: layers.map((l) => [...l]) };
  }
  layers = best.layers;
  indexLayers();

  // ------------------------------------------------------------ node sizes and ports
  for (const n of all) {
    n.outSegs.sort((a, b) => position.get(a.v) - position.get(b.v));
    n.inSegs.sort((a, b) => position.get(a.u) - position.get(b.u));
    if (n.dummy) {
      Object.assign(n, { cSize: 1, mSize: 0, outPorts: [0], inPorts: [0] });
      continue;
    }
    let { w, h } = sizeNode(n, titles);
    const ports = Math.max(n.inSegs.length, n.outSegs.length);
    if (horizontal) h = Math.max(h, ports + 2);
    else w = Math.max(w, ports * 2 + 3);
    Object.assign(n, { w, h, cSize: horizontal ? h : w, mSize: horizontal ? w : h });
    // k ports spread evenly along the side, never on a corner.
    const spread = (k) =>
      Array.from({ length: k }, (_, i) => Math.min(n.cSize - 2, Math.max(1, Math.round(((i + 1) * (n.cSize - 1)) / (k + 1)))));
    n.outPorts = spread(n.outSegs.length);
    n.inPorts = spread(n.inSegs.length);
  }
  for (const s of segments) {
    s.a = () => s.u.c + s.u.outPorts[s.u.outSegs.indexOf(s)];
    s.b = () => s.v.c + s.v.inPorts[s.v.inSegs.indexOf(s)];
  }

  // ------------------------------------------------------------ cross coordinates
  const outerLevel = (n, other) => {
    let i = 0;
    while (i < n.groups.length && n.groups[i] === other.groups[i]) i += 1;
    return i < n.groups.length ? sgById.get(n.groups[i]).level : 0;
  };
  const gap = (a, b) => {
    const base = horizontal ? 1 : a.dummy || b.dummy ? 2 : 4;
    const frames = outerLevel(a, b) + outerLevel(b, a);
    return frames ? Math.max(base, frames * FRAME_PAD + 1) : base;
  };

  for (const layer of layers) {
    let c = 0;
    layer.forEach((n, i) => {
      n.c = c;
      c += n.cSize + (layer[i + 1] ? gap(n, layer[i + 1]) : 0);
    });
  }

  const place = (layer, desired) => {
    const k = layer.length;
    const L = [];
    const R = [];
    for (let i = 0; i < k; i += 1) L[i] = i ? Math.max(desired[i], L[i - 1] + layer[i - 1].cSize + gap(layer[i - 1], layer[i])) : desired[i];
    for (let i = k - 1; i >= 0; i -= 1) R[i] = i < k - 1 ? Math.min(desired[i], R[i + 1] - gap(layer[i], layer[i + 1]) - layer[i].cSize) : desired[i];
    for (let i = 0; i < k; i += 1) {
      let c = Math.round((L[i] + R[i]) / 2);
      if (i) c = Math.max(c, layer[i - 1].c + layer[i - 1].cSize + gap(layer[i - 1], layer[i]));
      layer[i].c = c;
    }
  };

  const wish = (n, useIn, useOut) => {
    const targets = [];
    if (useIn) n.inSegs.forEach((s, i) => targets.push(s.a() - n.inPorts[i]));
    if (useOut) n.outSegs.forEach((s, i) => targets.push(s.b() - n.outPorts[i]));
    return mean(targets, n.c);
  };

  for (let iter = 0; iter < 20; iter += 1) {
    const both = iter >= 16;
    const down = iter % 2 === 0;
    const order = down ? [...layers.keys()] : [...layers.keys()].reverse();
    for (const r of order) {
      const layer = layers[r];
      place(layer, layer.map((n) => wish(n, down || both, !down || both)));
    }
  }

  // ------------------------------------------------------------ keep frames apart
  // Per-layer gaps can't see a frame that spans several ranks, so sibling frames (and stray nodes)
  // may still overlap. Push the right-hand block, and everything right of it, past the left one.
  const separation = horizontal ? 1 : 2;
  const blocks = () => {
    const out = [];
    for (const sg of sgById.values()) {
      const members = nodes.filter((n) => n.groups.includes(sg.id));
      if (!members.length) continue;
      const pad = sg.level * FRAME_PAD;
      const lo = Math.min(...members.map((n) => n.c)) - pad;
      let hi = Math.max(...members.map((n) => n.c + n.cSize)) + pad;
      if (!horizontal) hi = Math.max(hi, lo + strWidth(sg.title) + 6);
      const ranks = members.map((n) => n.rank);
      out.push({ members: new Set(members), lo, hi, r0: Math.min(...ranks), r1: Math.max(...ranks) });
    }
    for (const n of nodes) out.push({ members: new Set([n]), lo: n.c, hi: n.c + n.cSize, r0: n.rank, r1: n.rank });
    return out;
  };
  const contains = (x, y) => [...y.members].every((n) => x.members.has(n));
  for (let pass = 0; pass < 100; pass += 1) {
    const list = blocks();
    let conflict = null;
    for (let i = 0; i < list.length && !conflict; i += 1) {
      for (let j = i + 1; j < list.length && !conflict; j += 1) {
        const [x, y] = [list[i], list[j]];
        if (x.r1 < y.r0 || y.r1 < x.r0 || contains(x, y) || contains(y, x)) continue;
        if (x.hi + separation <= y.lo || y.hi + separation <= x.lo) continue;
        conflict = x.lo + x.hi <= y.lo + y.hi ? [x, y] : [y, x];
      }
    }
    if (!conflict) break;
    const [left, right] = conflict;
    const delta = left.hi + separation - right.lo;
    for (const n of all) if (n.c >= right.lo && !left.members.has(n)) n.c += delta;
  }

  // ------------------------------------------------------------ main coordinates
  const memberRanks = (sg) => {
    const ranks = nodes.filter((n) => n.groups.includes(sg.id)).map((n) => n.rank);
    return ranks.length ? [Math.min(...ranks), Math.max(...ranks)] : null;
  };
  const frameRanks = new Map([...sgById.values()].map((sg) => [sg, memberRanks(sg)]));

  const band = layers.map((layer) => Math.max(1, ...layer.filter((n) => !n.dummy).map((n) => n.mSize)));
  const lastSegs = (r) => segments.filter((s) => s.u.rank === r && s.edge.segs.at(-1) === s && s.edge.label);

  // Channels: a segment that shifts across gets its own row (or column) in the gap.
  // When one segment leaves on the line another arrives on, the leaving one must turn first
  // (nearer the source), or the two would run over each other.
  const channels = layers.map((layer) => {
    const pending = layer.flatMap((n) => n.outSegs).filter((s) => s.a() !== s.b());
    // Among segments heading the same way, the one starting farther ahead turns first: no needless crossings.
    const key = (s) => (s.a() < s.b() ? [0, -s.a()] : [1, s.a()]);
    pending.sort((x, y) => key(x)[0] - key(y)[0] || key(x)[1] - key(y)[1]);
    const mustPrecede = new Map(pending.map((t) => [t, pending.filter((s) => s !== t && s.a() === t.b())]));
    const rows = [];
    while (pending.length) {
      const ready = pending.findIndex((t) => mustPrecede.get(t).every((s) => s.channel !== undefined && !pending.includes(s)));
      const [s] = pending.splice(Math.max(0, ready), 1);
      const lo = Math.min(s.a(), s.b()) - 1;
      const hi = Math.max(s.a(), s.b()) + 1;
      const floor = Math.max(-1, ...mustPrecede.get(s).filter((p) => p.channel !== undefined).map((p) => p.channel)) + 1;
      let row = floor;
      while (rows[row]?.some(([l, h]) => lo <= h && l <= hi)) row += 1;
      (rows[row] ??= []).push([lo, hi]);
      s.channel = row;
    }
    for (let i = 0; i < rows.length; i += 1) rows[i] ??= [];
    return Math.max(1, rows.length);
  });

  const M = [];
  const gapInfo = [];
  let m = 0;
  for (let r = 0; r < rankCount; r += 1) {
    const topPad = Math.max(0, ...[...frameRanks].filter(([, rr]) => rr && rr[0] === r).map(([sg]) => sg.level * FRAME_PAD));
    if (r > 0) gapInfo[r - 1].topPad = topPad;
    m += r > 0 ? topPad : 0;
    M[r] = m;
    m += band[r];
    if (r === rankCount - 1) break;
    const bottomPad = Math.max(0, ...[...frameRanks].filter(([, rr]) => rr && rr[1] === r).map(([sg]) => sg.level * FRAME_PAD));
    const labelled = lastSegs(r);
    // LR: columns wide enough for the longest label line. TB: one row per label line.
    const labelSize = !labelled.length
      ? 0
      : horizontal
        ? Math.max(...labelled.flatMap((s) => s.edge.label.map((l) => strWidth(plain(l))))) + 2
        : Math.max(...labelled.map((s) => s.edge.label.length));
    const info = { start: m, bottomPad, labelSize, channelStart: m + bottomPad + 1 };
    info.labelStart = info.channelStart + channels[r];
    gapInfo[r] = info;
    m += bottomPad + 1 + channels[r] + labelSize + (horizontal ? 2 : 1);
  }
  for (const n of all) {
    if (n.dummy) Object.assign(n, { m: M[n.rank], mSize: band[n.rank] });
    else n.m = M[n.rank] + Math.floor((band[n.rank] - n.mSize) / 2);
  }

  // ------------------------------------------------------------ routes
  const routes = [];
  const labels = [];
  for (const e of real) {
    const pts = [];
    for (const s of e.segs) {
      const a = s.a();
      const b = s.b();
      const info = gapInfo[s.u.rank];
      const arrive = s.v.m - 1;
      pts.push([s.u.m + s.u.mSize, a]);
      if (a !== b) {
        const ch = info.channelStart + s.channel;
        pts.push([ch, a], [ch, b]);
      }
      pts.push([arrive, b]);

      // Each label gets candidate spots in order of preference; the renderer takes the first free one.
      // "inline" candidates sit on the connector itself, the others beside it.
      if (e.label && s === e.segs.at(-1)) {
        const lines = e.label.map(plain);
        const item = (pm, pc, text) => ({ m: pm, c: pc, mSize: horizontal ? strWidth(text) : 1, text });
        const cands = [];
        if (horizontal) {
          const at = (text) => info.labelStart + Math.floor((info.labelSize - strWidth(text)) / 2);
          if (lines.length === 1) {
            const [t] = lines;
            cands.push({ items: [item(at(t), b - 1, t)] }, { items: [item(at(t), b + 1, t)] }, { inline: true, items: [item(at(` ${t} `), b, ` ${t} `)] });
          } else {
            // First line above the connector, the rest below it.
            cands.push({ items: lines.map((t, i) => item(at(t), i === 0 ? b - 1 : b + i, t)) });
            cands.push({ items: lines.map((t, i) => item(at(t), b + 1 + i, t)) });
            cands.push({ items: lines.map((t, i) => item(at(t), b - lines.length + i, t)) });
          }
        } else {
          const ordered = flip ? [...lines].reverse() : lines;
          const width = strWidth(lines[0]) + 2;
          if (lines.length === 1 && a !== b && Math.abs(a - b) - 1 >= width + 2) {
            const t = ` ${lines[0]} `;
            cands.push({ inline: true, items: [item(info.channelStart + s.channel, Math.round((a + b) / 2 - width / 2), t)] });
          }
          cands.push({ items: ordered.map((t, i) => item(info.labelStart + i, b + 2, t)) });
          cands.push({ items: ordered.map((t, i) => item(info.labelStart + i, b - 1 - strWidth(t), t)) });
        }
        labels.push(cands);
      }
    }
    routes.push({ edge: e, points: pts });
  }

  // ------------------------------------------------------------ frames
  const frames = [];
  for (const sg of sgById.values()) {
    const rr = frameRanks.get(sg);
    if (!rr) continue;
    const members = nodes.filter((n) => n.groups.includes(sg.id));
    const pad = sg.level * FRAME_PAD;
    const c0 = Math.min(...members.map((n) => n.c)) - pad;
    let c1 = Math.max(...members.map((n) => n.c + n.cSize)) + pad;
    const m0 = M[rr[0]] - pad;
    let m1 = M[rr[1]] + band[rr[1]] + pad;
    const need = strWidth(sg.title) + 6;
    if (horizontal) m1 = Math.max(m1, m0 + need);
    else c1 = Math.max(c1, c0 + need);
    frames.push({ sg, m: m0, c: c0, mSize: m1 - m0, cSize: c1 - c0 });
  }

  // ------------------------------------------------------------ map to x/y
  const totalM = m;
  const fm = (v, size = 1) => (flip ? totalM - v - size : v);
  const rect = (o) => {
    const mm = fm(o.m, o.mSize);
    return horizontal ? { x: mm, y: o.c, w: o.mSize, h: o.cSize } : { x: o.c, y: mm, w: o.cSize, h: o.mSize };
  };
  const pt = ([pm, pc]) => (horizontal ? [fm(pm), pc] : [pc, fm(pm)]);

  const scene = {
    boxes: nodes.map((n) => ({ node: n, ...rect(n) })),
    frames: frames.map((f) => ({ title: f.sg.title, sg: f.sg, ...rect(f) })),
    routes: routes.map((r) => ({ edge: r.edge, points: r.points.map(pt) })),
    labels: labels.map((cands) =>
      cands.map((cand) => ({
        inline: Boolean(cand.inline),
        items: cand.items.map((l) => {
          const { x, y } = rect({ ...l, cSize: 1 });
          return { x, y, text: l.text };
        }),
      })),
    ),
    selfLoops,
  };

  // Shift everything to start at (0, 0); only each label's first choice counts toward the bounds.
  const preferred = scene.labels.flatMap((cands) => cands[0].items);
  const allLabelItems = scene.labels.flatMap((cands) => cands.flatMap((c) => c.items));
  const xs = [...scene.boxes, ...scene.frames, ...preferred].map((b) => b.x).concat(scene.routes.flatMap((r) => r.points.map((p) => p[0])));
  const ys = [...scene.boxes, ...scene.frames, ...preferred].map((b) => b.y).concat(scene.routes.flatMap((r) => r.points.map((p) => p[1])));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  for (const b of [...scene.boxes, ...scene.frames, ...allLabelItems]) {
    b.x -= minX;
    b.y -= minY;
  }
  for (const r of scene.routes) r.points = r.points.map(([x, y]) => [x - minX, y - minY]);
  return scene;
}
