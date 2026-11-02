// Draws a laid-out scene onto a character canvas, in the style of rounded boxes and orthogonal connectors.
import { plain, spans } from "./rich.mjs";
import { charWidth, strWidth } from "./text.mjs";

export const palette = {
  cyan: [127, 216, 232],
  blue: [106, 168, 240],
  green: [127, 217, 154],
  yellow: [232, 200, 110],
  purple: [185, 160, 240],
  red: [240, 128, 128],
  gray: [138, 147, 166],
  dim: [92, 99, 115],
  white: [230, 233, 240],
};

const SHAPE_COLOR = {
  rect: "blue",
  round: "green",
  stadium: "green",
  circle: "green",
  diamond: "yellow",
  hexagon: "yellow",
  cylinder: "purple",
  subroutine: "cyan",
  parallelogram: "cyan",
  asymmetric: "cyan",
  arrow: "gray",
};
const FRAME_COLORS = ["purple", "cyan", "green", "yellow", "blue", "red"];

// top-left, top-right, bottom-left, bottom-right, horizontal, vertical
const BORDERS = {
  rect: "┌┐└┘─│",
  round: "╭╮╰╯─│",
  stadium: "╭╮╰╯─│",
  circle: "╭╮╰╯─│",
  cylinder: "╭╮╰╯─│",
  diamond: "╱╲╲╱─│",
  hexagon: "╱╲╲╱─│",
  subroutine: "╔╗╚╝═║",
  parallelogram: "┌┐└┘─│",
  asymmetric: "┌┐└┘─│",
};

const U = 1;
const D = 2;
const L = 4;
const R = 8;
const SOLID = { [U]: "│", [D]: "│", [U | D]: "│", [L]: "─", [R]: "─", [L | R]: "─", [D | R]: "╭", [D | L]: "╮", [U | R]: "╰", [U | L]: "╯", [U | D | R]: "├", [U | D | L]: "┤", [D | L | R]: "┬", [U | L | R]: "┴", [U | D | L | R]: "┼" };
const THICK = { [U]: "┃", [D]: "┃", [U | D]: "┃", [L]: "━", [R]: "━", [L | R]: "━", [D | R]: "┏", [D | L]: "┓", [U | R]: "┗", [U | L]: "┛", [U | D | R]: "┣", [U | D | L]: "┫", [D | L | R]: "┳", [U | L | R]: "┻", [U | D | L | R]: "╋" };
const DASHED = { ...SOLID, [U]: "╎", [D]: "╎", [U | D]: "╎", [L]: "╌", [R]: "╌", [L | R]: "╌" };
const LINE_CHARS = { solid: SOLID, thick: THICK, dashed: DASHED };

const HEADS = {
  arrow: { r: "▶", l: "◀", u: "▲", d: "▼" },
  circle: { r: "●", l: "●", u: "●", d: "●" },
  cross: { r: "✕", l: "✕", u: "✕", d: "✕" },
};

function hexColor(value) {
  const hex = value?.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return palette[value] ? value : null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.cells = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ ch: " ", color: null, bold: false })));
    this.lines = new Map();
  }

  put(x, y, text, color = "white", bold = false) {
    const row = this.cells[y];
    if (!row) return;
    for (const ch of text) {
      const w = charWidth(ch);
      // Combining marks, variation selectors and modifiers ride on the previous character.
      if (w === 0) {
        const prev = row[x - 1]?.cont ? row[x - 2] : row[x - 1];
        if (prev && prev.ch !== " ") prev.ch += ch;
        continue;
      }
      if (x >= 0 && x + w <= this.width) {
        // Writing over half of a wide character blanks the other half.
        if (row[x].cont && row[x - 1]) row[x - 1].ch = " ";
        if (row[x + w - 1]?.wide && row[x + w]) Object.assign(row[x + w], { ch: " ", cont: false });
        row[x] = { ch, color, bold, wide: w === 2, cont: false };
        if (w === 2) row[x + 1] = { ch: "", color, bold, cont: true };
      }
      x += w;
    }
  }

  // Connectors are kept as direction bits so crossings and bends get the right junction glyph.
  stroke(points, style, color) {
    const mark = (x, y, bit) => {
      const key = `${x},${y}`;
      const cell = this.lines.get(key) ?? { x, y, bits: 0 };
      cell.bits |= bit;
      cell.style = style;
      cell.color = color;
      this.lines.set(key, cell);
    };
    for (let i = 0; i < points.length - 1; i += 1) {
      let [x, y] = points[i];
      const [x1, y1] = points[i + 1];
      const sx = Math.sign(x1 - x);
      const sy = Math.sign(y1 - y);
      const fwd = sx > 0 ? R : sx < 0 ? L : sy > 0 ? D : U;
      const back = { [R]: L, [L]: R, [D]: U, [U]: D }[fwd];
      while (x !== x1 || y !== y1) {
        mark(x, y, fwd);
        x += sx;
        y += sy;
        mark(x, y, back);
      }
    }
  }

  flushLines() {
    this.lineCells = new Set(this.lines.keys());
    for (const { x, y, bits, style, color } of this.lines.values()) this.put(x, y, LINE_CHARS[style][bits] ?? "·", color);
    this.lines.clear();
  }

  // Free means blank; an inline label may also cover plain connector cells.
  isFree(x, y, text, inline) {
    const width = strWidth(text);
    if (x < 0 || y < 0 || y >= this.height || x + width > this.width) return false;
    for (let i = 0; i < width; i += 1) {
      const cell = this.cells[y][x + i];
      if (cell.cont || (cell.ch !== " " && !(inline && this.lineCells.has(`${x + i},${y}`)))) return false;
    }
    return true;
  }
}

// Block arrows are drawn as a heavy shaft spanning the cell, with the label over its middle.
function drawArrow(canvas, box, color) {
  const { x, y, w, h, node } = box;
  const lines = node.body.map(plain);
  if (node.arrow === "up" || node.arrow === "down" || node.arrow === "y") {
    const cx = x + Math.floor((w - 1) / 2);
    for (let row = y; row < y + h; row += 1) canvas.put(cx, row, "┃", color);
    if (node.arrow !== "up") canvas.put(cx, y + h - 1, "▼", color);
    if (node.arrow !== "down") canvas.put(cx, y, "▲", color);
    const top = y + Math.floor((h - lines.length) / 2);
    lines.forEach((line, i) => canvas.put(x + Math.floor((w - strWidth(line)) / 2) - 1, top + i, ` ${line} `, "white", true));
  } else {
    const cy = y + Math.floor((h - 1) / 2);
    canvas.put(x, cy, "━".repeat(w), color);
    if (node.arrow !== "left") canvas.put(x + w - 1, cy, "▶", color);
    if (node.arrow !== "right") canvas.put(x, cy, "◀", color);
    if (lines[0]) canvas.put(x + Math.floor((w - strWidth(lines[0])) / 2), cy - 1, lines[0], "white", true);
  }
  return color;
}

function drawBox(canvas, box) {
  const { x, y, w, h, node } = box;
  const color = hexColor(node.style.stroke) ?? hexColor(node.style.fill) ?? SHAPE_COLOR[node.shape] ?? "blue";
  if (node.shape === "arrow") return drawArrow(canvas, box, color);
  const textColor = hexColor(node.style.color) ?? "white";
  const [tl, tr, bl, br, hz, vt] = [...BORDERS[node.shape]];
  canvas.put(x, y, tl + hz.repeat(w - 2) + tr, color);
  for (let row = 1; row < h - 1; row += 1) canvas.put(x, y + row, vt + " ".repeat(w - 2) + vt, color);
  canvas.put(x, y + h - 1, bl + hz.repeat(w - 2) + br, color);
  let top = y + 1;
  if (node.shape === "cylinder") {
    canvas.put(x, y + 1, "├" + "─".repeat(w - 2) + "┤", color);
    top += 1;
  }
  if (node.title) canvas.put(x + 2, y, ` ${node.title} `, color, true);
  const inner = y + h - 1 - top;
  // Titled boxes read like panels (body from the top); plain ones are centered.
  const first = node.title ? top : top + Math.floor((inner - node.body.length) / 2);
  const roles = { text: textColor, strong: textColor, muted: "gray", accent: color, ok: "green", ng: "red" };
  node.body.forEach((line, i) => {
    let lx = node.title ? x + 2 : x + Math.floor((w - strWidth(plain(line))) / 2);
    for (const part of spans(line)) {
      const bold = part.role === "strong" || part.role === "accent" || (!node.title && part.role === "text");
      canvas.put(lx, first + i, part.text, roles[part.role], bold);
      lx += strWidth(part.text);
    }
  });
  return color;
}

function drawFrame(canvas, frame, color) {
  const { x, y, w, h, title } = frame;
  canvas.put(x, y, `┌${"╌".repeat(w - 2)}┐`, "dim");
  for (let row = 1; row < h - 1; row += 1) {
    canvas.put(x, y + row, "╎", "dim");
    canvas.put(x + w - 1, y + row, "╎", "dim");
  }
  canvas.put(x, y + h - 1, `└${"╌".repeat(w - 2)}┘`, "dim");
  if (title) canvas.put(x + 2, y, ` ${title} `, color, true);
}

const direction = ([x0, y0], [x1, y1]) => (x1 > x0 ? "r" : x1 < x0 ? "l" : y1 > y0 ? "d" : "u");

export function drawScene(scene, { title = null, footer = [] } = {}) {
  // A title takes the first row plus a blank one; everything else moves down.
  const top = title ? 2 : 0;
  for (const b of [...scene.boxes, ...scene.frames]) b.y += top;
  for (const r of scene.routes) r.points = r.points.map(([x, y]) => [x, y + top]);
  for (const item of scene.labels.flatMap((cands) => cands.flatMap((c) => c.items))) item.y += top;

  const extents = [
    ...[...scene.boxes, ...scene.frames].map((b) => [b.x + b.w, b.y + b.h]),
    ...scene.routes.flatMap((r) => r.points.map(([x, y]) => [x + 1, y + 1])),
    ...scene.labels.flatMap((cands) => cands[0].items).map((l) => [l.x + strWidth(l.text), l.y + 1]),
  ];
  const diagramWidth = Math.max(1, ...extents.map((e) => e[0]));
  const diagramHeight = Math.max(top, ...extents.map((e) => e[1]));
  const width = Math.max(diagramWidth + 24, ...footer.map(strWidth), title ? strWidth(title) : 0);
  const height = diagramHeight + (footer.length ? footer.length + 1 : 0);
  const canvas = new Canvas(width, height);

  // Frames go underneath so connectors can cross their borders.
  const frameOrder = [...scene.frames].sort((a, b) => b.w * b.h - a.w * a.h);
  frameOrder.forEach((f) => drawFrame(canvas, f, hexColor(f.sg.color) ?? FRAME_COLORS[scene.frames.indexOf(f) % FRAME_COLORS.length]));

  const nodeColor = (node) => hexColor(node.style.stroke) ?? hexColor(node.style.fill) ?? SHAPE_COLOR[node.shape] ?? "blue";
  const heads = [];
  for (const { edge, points } of scene.routes) {
    if (edge.style === "invisible") continue;
    const pts = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
    const color = hexColor(edge.styleProps?.stroke) ?? nodeColor(edge.source);
    canvas.stroke(pts, edge.style, color);
    // A reversed edge was routed target → source, so its heads swap ends.
    const [atEnd, atStart] = edge.reversed ? [edge.startHead, edge.endHead] : [edge.endHead, edge.startHead];
    if (pts.length > 1) {
      if (atEnd) heads.push([pts.at(-1), HEADS[atEnd][direction(pts.at(-2), pts.at(-1))], color]);
      if (atStart) heads.push([pts[0], HEADS[atStart][direction(pts[1], pts[0])], color]);
    }
  }
  canvas.flushLines();
  for (const [[x, y], ch, color] of heads) {
    canvas.put(x, y, ch, color);
    canvas.lineCells.delete(`${x},${y}`);
  }
  for (const box of scene.boxes) drawBox(canvas, box);
  // Frame titles stay readable even where a connector crosses them.
  frameOrder.forEach((f) => {
    if (f.title) canvas.put(f.x + 2, f.y, ` ${f.title} `, hexColor(f.sg.color) ?? FRAME_COLORS[scene.frames.indexOf(f) % FRAME_COLORS.length], true);
  });
  for (const cands of scene.labels) {
    const chosen = cands.find((c) => c.items.every((l) => canvas.isFree(l.x, l.y, l.text, c.inline))) ?? cands[0];
    for (const l of chosen.items) canvas.put(l.x, l.y, l.text, "gray");
  }
  // Self-loops are marked on the top-right border, where no connector ends.
  for (const edge of scene.selfLoops) {
    const box = scene.boxes.find((b) => b.node === edge.source);
    canvas.put(box.x + box.w - 2, box.y, "↺", nodeColor(edge.source), true);
  }
  if (title) canvas.put(Math.max(0, Math.floor((diagramWidth - strWidth(title)) / 2)), 0, title, "white", true);
  footer.forEach((line, i) => canvas.put(0, diagramHeight + 1 + i, line, "gray"));
  return canvas;
}

const paint = (color, text, bold) => {
  const [r, g, b] = Array.isArray(color) ? color : palette[color];
  return `\x1b[${bold ? "1;" : ""}38;2;${r};${g};${b}m${text}\x1b[0m`;
};

// Each row becomes runs of same-styled cells; trailing blanks are trimmed.
function runs(canvas) {
  const rows = canvas.cells.map((row) => {
    const out = [];
    for (const cell of row) {
      if (cell.cont) continue;
      const color = cell.ch === " " ? null : cell.color;
      const last = out.at(-1);
      if (last && String(last.color) === String(color) && last.bold === cell.bold) last.text += cell.ch;
      else out.push({ text: cell.ch, color, bold: cell.bold });
    }
    while (out.length && !out.at(-1).text.trim()) out.pop();
    if (out.length) out.at(-1).text = out.at(-1).text.replace(/\s+$/, "");
    return out;
  });
  while (rows.length && !rows.at(-1).length) rows.pop();
  return rows;
}

export function toAnsi(canvas, color = true) {
  return runs(canvas)
    .map((row) => row.map((r) => (color && r.color ? paint(r.color, r.text, r.bold) : r.text)).join(""))
    .join("\n");
}

const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function toHtml(canvases) {
  const body = canvases
    .map((canvas) =>
      runs(canvas)
        .map((row) =>
          row
            .map((r) => {
              if (!r.color) return escapeHtml(r.text);
              const [red, green, blue] = Array.isArray(r.color) ? r.color : palette[r.color];
              return `<span style="color:rgb(${red},${green},${blue})${r.bold ? ";font-weight:700" : ""}">${escapeHtml(r.text)}</span>`;
            })
            .join(""),
        )
        .join("\n"),
    )
    .map((pre) => `<pre>${pre}</pre>`)
    .join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>tui-mermaid</title>
<style>
  body { margin: 0; padding: 24px 28px; background: #0d1117; color: rgb(230,233,240); }
  pre { margin: 0 0 32px; font: 14px/17px Menlo, "SF Mono", Consolas, monospace; }
</style></head>
<body>
${body}
</body></html>
`;
}
