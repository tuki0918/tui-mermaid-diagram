// Image output. Box-drawing glyphs become vector strokes so lines join cleanly at any font;
// everything else stays text, placed cell by cell on the character grid.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { palette } from "./render.mjs";

// Cell metrics for 14px Menlo.
const CELL_W = 8.43;
const CELL_H = 17;
const FONT_SIZE = 14;
const PAD_X = 28;
const PAD_Y = 24;
const GAP_ROWS = 3;
const BACKGROUND = "#0d1117";
const FONT = `Menlo, "SF Mono", Consolas, "DejaVu Sans Mono", monospace`;

// Which half-lines (up, down, left, right) each glyph draws from the cell center.
const LIGHT = { "─": "lr", "│": "ud", "┌": "dr", "┐": "dl", "└": "ur", "┘": "ul", "├": "udr", "┤": "udl", "┬": "dlr", "┴": "ulr", "┼": "udlr" };
const ROUND = { "╭": "dr", "╮": "dl", "╰": "ur", "╯": "ul" };
const HEAVY = { "━": "lr", "┃": "ud", "┏": "dr", "┓": "dl", "┗": "ur", "┛": "ul", "┣": "udr", "┫": "udl", "┳": "dlr", "┻": "ulr", "╋": "udlr" };
const DOUBLE = { "═": "lr", "║": "ud", "╔": "dr", "╗": "dl", "╚": "ur", "╝": "ul" };
const DASHED = { "╌": "lr", "╎": "ud" };
const HEADS = new Set(["▶", "◀", "▲", "▼", "●", "✕", "╱", "╲"]);

const isVector = (ch) => ch in LIGHT || ch in ROUND || ch in HEAVY || ch in DOUBLE || ch in DASHED || HEADS.has(ch);

const rgb = (color) => {
  const [r, g, b] = Array.isArray(color) ? color : palette[color ?? "white"];
  return `rgb(${r},${g},${b})`;
};
const escapeXml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (v) => Math.round(v * 100) / 100;

// Path data for one glyph, keyed by stroke kind. `right` is the glyph in the next cell.
function glyph(ch, x0, y0, right = " ") {
  const [x1, y1] = [x0 + CELL_W, y0 + CELL_H];
  const [cx, cy] = [x0 + CELL_W / 2, y0 + CELL_H / 2];
  const edge = { u: [cx, y0], d: [cx, y1], l: [x0, cy], r: [x1, cy] };
  const halves = (dirs) => [...dirs].map((d) => `M${n(cx)} ${n(cy)}L${n(edge[d][0])} ${n(edge[d][1])}`).join("");

  if (ch in LIGHT) return { light: halves(LIGHT[ch]) };
  if (ch in HEAVY) return { heavy: halves(HEAVY[ch]) };
  if (ch in ROUND) {
    const dirs = ROUND[ch];
    const v = edge[dirs[0]];
    const h = edge[dirs[1]];
    const r = Math.min(CELL_W, CELL_H) / 2;
    const vy = cy + Math.sign(v[1] - cy) * r;
    const hx = cx + Math.sign(h[0] - cx) * r;
    return { light: `M${n(v[0])} ${n(v[1])}L${n(cx)} ${n(vy)}Q${n(cx)} ${n(cy)} ${n(hx)} ${n(cy)}L${n(h[0])} ${n(h[1])}` };
  }
  if (ch in DASHED) {
    return DASHED[ch] === "lr" ? { dashH: `M${n(x0)} ${n(cy)}H${n(x1)}` } : { dashV: `M${n(cx)} ${n(y0)}V${n(y1)}` };
  }
  if (ch in DOUBLE) {
    const dirs = DOUBLE[ch];
    const d = 1.6;
    if (dirs === "lr") return { double: `M${n(x0)} ${n(cy - d)}H${n(x1)}M${n(x0)} ${n(cy + d)}H${n(x1)}` };
    if (dirs === "ud") return { double: `M${n(cx - d)} ${n(y0)}V${n(y1)}M${n(cx + d)} ${n(y0)}V${n(y1)}` };
    // Corner: the outer line bends on the far side of the center, the inner one on the near side.
    const [vd, hd] = dirs;
    const ox = hd === "r" ? -d : d;
    const oy = vd === "d" ? -d : d;
    const hx = edge[hd][0];
    const vy = edge[vd][1];
    const l = (k) => `M${n(hx)} ${n(cy + k * oy)}H${n(cx + k * ox)}V${n(vy)}`;
    return { double: l(1) + l(-1) };
  }
  const s = 4.2;
  if (ch === "▶") return { fill: `M${n(x0 + 1)} ${n(cy - s)}L${n(x1)} ${n(cy)}L${n(x0 + 1)} ${n(cy + s)}Z` };
  if (ch === "◀") return { fill: `M${n(x1 - 1)} ${n(cy - s)}L${n(x0)} ${n(cy)}L${n(x1 - 1)} ${n(cy + s)}Z` };
  if (ch === "▼") return { fill: `M${n(cx - s)} ${n(y0 + 4)}L${n(cx)} ${n(y1)}L${n(cx + s)} ${n(y0 + 4)}Z` };
  if (ch === "▲") return { fill: `M${n(cx - s)} ${n(y1 - 4)}L${n(cx)} ${n(y0)}L${n(cx + s)} ${n(y1 - 4)}Z` };
  if (ch === "●") return { fill: `M${n(cx - 3)} ${n(cy)}a3 3 0 1 0 6 0a3 3 0 1 0 -6 0Z` };
  if (ch === "✕") return { light: `M${n(cx - 3)} ${n(cy - 3)}L${n(cx + 3)} ${n(cy + 3)}M${n(cx + 3)} ${n(cy - 3)}L${n(cx - 3)} ${n(cy + 3)}` };
  // Diamond corners join the border line beside them to the side line above or below.
  const besideLine = right in LIGHT || right in ROUND;
  if (ch === "╱") return { light: besideLine ? `M${n(x1)} ${n(cy)}L${n(cx)} ${n(y1)}` : `M${n(cx)} ${n(y0)}L${n(x0)} ${n(cy)}` };
  if (ch === "╲") return { light: besideLine ? `M${n(cx)} ${n(y0)}L${n(x1)} ${n(cy)}` : `M${n(x0)} ${n(cy)}L${n(cx)} ${n(y1)}` };
  return {};
}

const STROKES = {
  light: `fill="none" stroke-width="1.3" stroke-linecap="square"`,
  heavy: `fill="none" stroke-width="2.6" stroke-linecap="square"`,
  double: `fill="none" stroke-width="1"`,
  dashH: `fill="none" stroke-width="1.3" stroke-dasharray="${n(CELL_W / 4)} ${n(CELL_W / 4)}" stroke-dashoffset="${n(-CELL_W / 8)}"`,
  dashV: `fill="none" stroke-width="1.3" stroke-dasharray="${n(CELL_H / 4)} ${n(CELL_H / 4)}" stroke-dashoffset="${n(-CELL_H / 8)}"`,
};

export function toSvg(canvases) {
  const paths = new Map();
  const texts = [];
  let rowOffset = 0;
  let columns = 1;

  for (const canvas of canvases) {
    let used = 0;
    canvas.cells.forEach((row, y) => {
      let run = null;
      const flush = () => {
        if (!run) return;
        const weight = run.bold ? ` font-weight="700"` : "";
        texts.push(`<text x="${run.xs.join(" ")}" y="${n(run.y)}" fill="${run.fill}"${weight}>${escapeXml(run.text)}</text>`);
        run = null;
      };
      row.forEach((cell, x) => {
        if (cell.cont) return;
        if (cell.ch !== " ") {
          used = Math.max(used, y + 1);
          columns = Math.max(columns, x + (cell.wide ? 2 : 1));
        }
        const px = PAD_X + x * CELL_W;
        const py = PAD_Y + (rowOffset + y) * CELL_H;
        if (cell.ch === " " || isVector(cell.ch)) {
          flush();
          for (const [kind, d] of Object.entries(glyph(cell.ch, px, py, row[x + 1]?.ch))) {
            const key = `${rgb(cell.color)}|${kind}`;
            paths.set(key, (paths.get(key) ?? "") + d);
          }
          return;
        }
        const fill = rgb(cell.color);
        const bold = Boolean(cell.bold);
        if (!run || run.fill !== fill || run.bold !== bold) {
          flush();
          // Baseline sits about three quarters down the cell.
          run = { fill, bold, xs: [], text: "", y: py + CELL_H * 0.76 };
        }
        run.xs.push(n(px));
        run.text += cell.ch;
      });
      flush();
    });
    rowOffset += Math.max(used, 1) + GAP_ROWS;
  }
  rowOffset -= GAP_ROWS;

  const width = Math.ceil(columns * CELL_W + PAD_X * 2);
  const height = Math.ceil(rowOffset * CELL_H + PAD_Y * 2);
  const shapes = [...paths].map(([key, d]) => {
    const [color, kind] = key.split("|");
    return kind === "fill" ? `<path d="${d}" fill="${color}"/>` : `<path d="${d}" stroke="${color}" ${STROKES[kind]}/>`;
  });
  return {
    width,
    height,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="${BACKGROUND}"/>
${shapes.join("\n")}
<g font-family='${FONT}' font-size="${FONT_SIZE}" xml:space="preserve">
${texts.join("\n")}
</g>
</svg>
`,
  };
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (found) return found;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      return execFileSync("which", [name], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      // Try the next name.
    }
  }
  throw new Error("PNG output needs Chrome or Chromium. Set CHROME_PATH to its executable, or use -f svg.");
}

// Rasterizes the SVG with headless Chrome; returns the PNG bytes.
export function toPng(canvases, { scale = 2 } = {}) {
  const { width, height, svg } = toSvg(canvases);
  const chrome = findChrome();
  const dir = mkdtempSync(join(tmpdir(), "tui-mermaid-"));
  try {
    const page = join(dir, "page.html");
    const out = join(dir, "out.png");
    writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${BACKGROUND}}svg{display:block}</style>${svg}`);
    execFileSync(
      chrome,
      ["--headless", "--disable-gpu", "--hide-scrollbars", `--force-device-scale-factor=${scale}`, `--window-size=${width},${height}`, `--screenshot=${out}`, `file://${page}`],
      { stdio: "ignore" },
    );
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
