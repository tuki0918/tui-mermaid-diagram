import { layoutBlocks } from "./grid.mjs";
import { layoutGraph } from "./layout.mjs";
import { parseMermaid } from "./parse.mjs";
import { drawScene, toAnsi, toHtml } from "./render.mjs";

export { toPng, toSvg } from "./image.mjs";
export { parseMermaid, layoutGraph, layoutBlocks, drawScene, toAnsi, toHtml };

// Mermaid source → canvas (call toAnsi / toHtml on the result).
// `onWarning(message)` hears about statements that were skipped because they could not be parsed.
export function renderMermaid(source, options = {}) {
  const graph = parseMermaid(source);
  for (const warning of graph.warnings) options.onWarning?.(warning);
  if (!graph.nodes.size) throw new Error("The diagram has no nodes.");
  const scene = graph.type === "block" ? layoutBlocks(graph, options) : layoutGraph(graph, options);
  return drawScene(scene, { title: graph.title, footer: graph.footer });
}

// Pulls ```mermaid fenced blocks out of a Markdown document.
export function mermaidBlocks(markdown) {
  return [...markdown.matchAll(/^```mermaid[^\n]*\n([\s\S]*?)^```/gm)].map((m) => ({ source: m[1], match: m[0], index: m.index }));
}
