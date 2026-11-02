#!/usr/bin/env node
// Renders Mermaid flowcharts as terminal box drawings.
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { toPng, toSvg } from "../src/image.mjs";
import { mermaidBlocks, renderMermaid, toAnsi, toHtml } from "../src/index.mjs";

const HELP = `Usage: tui-mermaid [file ...] [options]

Reads Mermaid flowchart / block-beta source (or Markdown with \`\`\`mermaid blocks) from files or stdin.

Options:
  -f, --format <ansi|plain|html|md|svg|png>
                    ansi   colored terminal output (default on a TTY)
                    plain  text only (default when piped, or with NO_COLOR)
                    html   dark-mode HTML page
                    md     the Markdown input with each mermaid block followed by a text rendering
                    svg    vector image (no dependencies)
                    png    raster image via headless Chrome (set CHROME_PATH if it isn't found)
  -o, --output <file>
                    write to a file instead of stdout; the format follows the extension
                    (.png .svg .html .md .txt) unless -f is given
      --scale <n>   PNG pixel density (default 2)
      --no-titles   keep multi-line labels inside the box instead of
                    putting the first line on the top border
  -q, --quiet       don't warn about statements that were skipped
  -v, --version     show the version
  -h, --help        show this help
`;

function parseArgs(argv) {
  const opts = { files: [], format: null, output: null, scale: 2, titles: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg === "-v" || arg === "--version") opts.version = true;
    else if (arg === "-q" || arg === "--quiet") opts.quiet = true;
    else if (arg === "-f" || arg === "--format") opts.format = argv[++i];
    else if (arg.startsWith("--format=")) opts.format = arg.slice(9);
    else if (arg === "-o" || arg === "--output") opts.output = argv[++i];
    else if (arg.startsWith("--output=")) opts.output = arg.slice(9);
    else if (arg === "--scale") opts.scale = Number(argv[++i]);
    else if (arg.startsWith("--scale=")) opts.scale = Number(arg.slice(8));
    else if (arg === "--no-titles") opts.titles = false;
    else if (arg === "--color") opts.format = "ansi";
    else if (arg === "--no-color") opts.format = "plain";
    else if (arg.startsWith("-") && arg !== "-") throw new Error(`Unknown option: ${arg}`);
    else opts.files.push(arg);
  }
  const byExtension = { ".png": "png", ".svg": "svg", ".html": "html", ".htm": "html", ".md": "md", ".txt": "plain" };
  if (!opts.format && opts.output) opts.format = byExtension[extname(opts.output).toLowerCase()] ?? "plain";
  if (!opts.format) {
    const color = process.env.NO_COLOR === undefined && (process.stdout.isTTY || process.env.FORCE_COLOR);
    opts.format = color ? "ansi" : "plain";
  }
  if (!["ansi", "plain", "html", "md", "svg", "png"].includes(opts.format)) throw new Error(`Unknown format: ${opts.format}`);
  if (!(opts.scale > 0)) throw new Error("--scale must be a positive number");
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }
  if (opts.version) {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
    process.stdout.write(`${pkg.version}\n`);
    return;
  }
  const inputs = opts.files.length ? opts.files : ["-"];
  const write = (data) => (opts.output ? writeFileSync(opts.output, data) : process.stdout.write(data));
  let current = "";
  const onWarning = opts.quiet ? undefined : (message) => process.stderr.write(`tui-mermaid: warning: ${current}${message}\n`);
  const render = (source) => renderMermaid(source, { titles: opts.titles, onWarning });

  if (opts.format === "md") {
    for (const file of inputs) {
      current = file === "-" ? "" : `${file}: `;
      let text = readFileSync(file === "-" ? 0 : file, "utf8");
      for (const block of mermaidBlocks(text).reverse()) {
        const rendered = "\n\n```text\n" + toAnsi(render(block.source), false) + "\n```";
        const end = block.index + block.match.length;
        text = text.slice(0, end) + rendered + text.slice(end);
      }
      write(text);
    }
    return;
  }

  const canvases = [];
  for (const file of inputs) {
    current = file === "-" ? "" : `${file}: `;
    const text = readFileSync(file === "-" ? 0 : file, "utf8");
    const blocks = mermaidBlocks(text);
    if (!blocks.length && /\.(md|markdown)$/i.test(file)) throw new Error(`${file}: no \`\`\`mermaid blocks found`);
    for (const source of blocks.length ? blocks.map((b) => b.source) : [text]) canvases.push(render(source));
  }
  if (opts.format === "png") {
    if (!opts.output && process.stdout.isTTY) throw new Error("PNG output needs -o <file> (or a redirect).");
    write(toPng(canvases, { scale: opts.scale }));
  } else if (opts.format === "svg") write(toSvg(canvases).svg);
  else if (opts.format === "html") write(toHtml(canvases));
  else write(canvases.map((c) => toAnsi(c, opts.format === "ansi")).join("\n\n") + "\n");
}

try {
  main();
} catch (error) {
  process.stderr.write(`tui-mermaid: ${error.message}\n`);
  process.exit(1);
}
