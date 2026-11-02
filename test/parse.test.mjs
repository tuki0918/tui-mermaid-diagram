import assert from "node:assert/strict";
import test from "node:test";
import { parseMermaid } from "../src/parse.mjs";
import { renderMermaid, toAnsi } from "../src/index.mjs";

const edges = (src) => parseMermaid(src).edges.map((e) => [e.from, e.to, e.style, e.endHead, e.label]);

test("link operators", () => {
  assert.deepEqual(
    edges("graph TD\nA-->B\nA---C\nA-.->D\nA==>E\nA--oF\nA--xG\nA~~~H"),
    [
      ["A", "B", "solid", "arrow", null],
      ["A", "C", "solid", null, null],
      ["A", "D", "dashed", "arrow", null],
      ["A", "E", "thick", "arrow", null],
      ["A", "F", "solid", "circle", null],
      ["A", "G", "solid", "cross", null],
      ["A", "H", "invisible", null, null],
    ],
  );
});

test("link labels, chains and &", () => {
  assert.deepEqual(edges("flowchart LR\nA -- yes --> B -->|no| C & D"), [
    ["A", "B", "solid", "arrow", ["yes"]],
    ["B", "C", "solid", "arrow", ["no"]],
    ["B", "D", "solid", "arrow", ["no"]],
  ]);
  assert.deepEqual(edges("graph TD\nA -. maybe .-> B\nA == sure ==> C"), [
    ["A", "B", "dashed", "arrow", ["maybe"]],
    ["A", "C", "thick", "arrow", ["sure"]],
  ]);
});

test("shapes and quoted labels", () => {
  const { nodes } = parseMermaid('graph TD\nA["a [b] (c)"] --> B{ok?}\nC[(db)] --> D((x))\nE[[sub]] --> F([pill])');
  assert.deepEqual(
    [...nodes.values()].map((n) => [n.id, n.shape, n.lines.join("|")]),
    [
      ["A", "rect", "a [b] (c)"],
      ["B", "diamond", "ok?"],
      ["C", "cylinder", "db"],
      ["D", "circle", "x"],
      ["E", "subroutine", "sub"],
      ["F", "stadium", "pill"],
    ],
  );
});

test("subgraphs and styles", () => {
  const graph = parseMermaid("graph TD\nsubgraph g1 [Group]\nA-->B\nend\nclassDef red stroke:#f00\nclass A red\nstyle B stroke:#0f0");
  assert.deepEqual(graph.subgraphs, [{ id: "g1", title: "Group", parent: null }]);
  assert.equal(graph.nodes.get("A").parent, "g1");
  assert.equal(graph.nodes.get("A").style.stroke, "#f00");
  assert.equal(graph.nodes.get("B").style.stroke, "#0f0");
});

test("renders wide characters without shifting the box", () => {
  const out = toAnsi(renderMermaid("graph LR\nA[日本語] --> B[ok]"), false);
  assert.match(out, /│ 日本語 │───▶│ ok │/);
});

test("title, footer and rich labels", () => {
  const out = toAnsi(renderMermaid("---\ntitle: Demo\n---\ngraph LR\naccDescr: a; b\nA[\"BOX<br># HEAD<br>*muted*<br>✓ ok\"] -->|\"up<br>down\"| B"), false);
  const lines = out.split("\n");
  assert.match(lines[0], /Demo/);
  assert.match(out, /─ BOX ─/);
  assert.match(out, /│ HEAD +│/);
  assert.match(out, /│ muted +│/);
  assert.match(out, /│ ✓ ok +│/);
  assert.match(out, /up/);
  assert.match(out, /down/);
  assert.equal(lines.at(-1), "a; b");
});

test("rejects other diagram types", () => {
  assert.throws(() => parseMermaid("sequenceDiagram\nA->>B: hi"), /Unsupported diagram type `sequenceDiagram`/);
  assert.throws(() => parseMermaid("  \n"), /input is empty/);
});

test("block-beta grid placement and routing", () => {
  const out = toAnsi(renderMermaid('block-beta\ncolumns 2\na["A"] b["B"]\nc["C"]:2\na -->|go| b\na --> c'), false);
  const lines = out.split("\n");
  // a and b share a row, joined by a straight arrow with the label above it.
  assert.match(out, /│ A │─+▶│ B │/);
  assert.match(lines[0], /go/);
  // c spans both columns: its box runs from a's left edge to b's right edge.
  const top = lines[1];
  const cTop = lines.find((l, i) => i > 3 && l.startsWith("┌"));
  assert.equal(cTop.length, top.trimEnd().length);
  assert.match(out, /▼/);
});

test("block-beta groups become titled frames", () => {
  const graph = parseMermaid('block-beta\ncolumns 2\nblock:g["Group"]:2\ncolumns 2\nx y\nend\nspace z');
  assert.equal(graph.type, "block");
  assert.deepEqual(graph.root.children.map((k) => k.kind), ["group", "space", "node"]);
  const out = toAnsi(renderMermaid('block-beta\nblock:g["Group"]\nx\nend'), false);
  assert.match(out, /┌╌ Group ╌/);
});

test("svg output draws lines as vectors and text on the grid", async () => {
  const { toSvg } = await import("../src/image.mjs");
  const { svg, width, height } = toSvg([renderMermaid('graph LR\nA["日本"] -->|go| B')]);
  assert.ok(width > 0 && height > 0);
  assert.match(svg, /^<svg [^>]*width="\d+" height="\d+"/);
  assert.match(svg, /<path d="M[^"]+" stroke="rgb\(/);
  assert.match(svg, />日本</);
  assert.match(svg, />go</);
  // Box-drawing glyphs never appear as text.
  assert.doesNotMatch(svg, /<text[^>]*>[^<]*[─│┌┐└┘▶]/);
});

test("v11 shape syntax, hyphenated ids and edge ids", () => {
  const graph = parseMermaid(
    'flowchart TD\nmy-node --> db-1@{ shape: cyl, label: "Main, DB" }\nA e1@--> B@{ shape: diam }\ne1@{ animate: true }\nC@{ shape: docs }',
  );
  assert.deepEqual(
    [...graph.nodes.values()].map((n) => [n.id, n.shape, n.lines.join("|")]),
    [
      ["my-node", "rect", "my-node"],
      ["db-1", "cylinder", "Main, DB"],
      ["A", "rect", "A"],
      ["B", "diamond", "B"],
      ["C", "rect", "C"],
    ],
  );
  assert.deepEqual(graph.edges.map((e) => [e.from, e.to]), [["my-node", "db-1"], ["A", "B"]]);
  assert.deepEqual(graph.warnings, []);
});

test("entities in labels", () => {
  const { nodes } = parseMermaid('graph TD\nA["a&nbsp;b #9829; &amp; #quot;q#quot;"]');
  assert.equal(nodes.get("A").lines[0], 'a b ♥ & "q"');
});

test("unparsed text is reported, not silently dropped", () => {
  const warnings = [];
  renderMermaid("graph TD\nA --> B junk\n-->", { onWarning: (w) => warnings.push(w) });
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /Ignored `junk`/);
});

test("emoji take two cells", () => {
  const out = toAnsi(renderMermaid('graph LR\nA["🚀 go"]'), false).split("\n");
  // The right border lines up on every row.
  const ends = out.map((line) => [...line].reduce((w, ch) => w + (/\p{Extended_Pictographic}/u.test(ch) ? 2 : 1), 0));
  assert.equal(new Set(ends).size, 1);
});

test("block arrows and edges to a group", () => {
  const graph = parseMermaid('block-beta\ncolumns 1\nup<["&nbsp;"]>(down)\nblock:G\nx\nend\nd\nG --> d');
  assert.equal(graph.nodes.get("up").shape, "arrow");
  assert.equal(graph.nodes.has("G"), false);
  const out = toAnsi(renderMermaid('block-beta\ncolumns 1\nup<["&nbsp;"]>(down)\nblock:G\nx\nend\nd\nG --> d'), false);
  assert.match(out, /┃\n\s*▼/);
  // The edge leaves the group's frame (bottom border) and ends at d.
  assert.match(out, /└╌*┘\n\s*│/);
});
