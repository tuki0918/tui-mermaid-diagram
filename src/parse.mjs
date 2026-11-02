// Parses the Mermaid flowchart subset: nodes with shapes, edges with labels, subgraphs, and color styles.

const SHAPES = [
  ["(((", [")))"], "circle"],
  ["((", ["))"], "circle"],
  ["([", ["])"], "stadium"],
  ["[[", ["]]"], "subroutine"],
  ["[(", [")]"], "cylinder"],
  ["[/", ["/]", "\\]"], "parallelogram"],
  ["[\\", ["\\]", "/]"], "parallelogram"],
  ["{{", ["}}"], "hexagon"],
  ["[", ["]"], "rect"],
  ["(", [")"], "round"],
  ["{", ["}"], "diamond"],
  [">", ["]"], "asymmetric"],
];

// Ids may contain "-" between other characters (`my-node`); "--" and "-." always start a link.
const ID = /[^\s[\](){}<>|&;:"'=~.,@-]+(?:-[^\s[\](){}<>|&;:"'=~.,@-]+)*/y;
// Edge ids: `A e1@--> B`.
const EDGE_ID = /\s*([^\s@]+)@(?=[<ox]?[-=~])/y;
const LINK = /\s*([<ox]?)(-{2,}[>ox]|-{3,}|={2,}[>ox]|={3,}|-\.+-[>ox]?|~{3,})/y;
const LINK_TEXT_START = /\s*([<ox]?)(--|==|-\.)\s+/y;
const LINK_TEXT_END = { "--": /\s*(-{2,}[>ox]|-{3,})/g, "==": /\s*(={2,}[>ox]|={3,})/g, "-.": /\s*(\.-+[>ox]?)/g };
const PIPE_LABEL = /\s*\|([^|]*)\|/y;

const HEADS = { ">": "arrow", "<": "arrow", o: "circle", x: "cross" };

// Mermaid v11 `id@{ shape: ... }` names, folded onto the shapes a terminal can draw; the rest become rectangles.
const SHAPE_NAMES = {
  round: ["rounded", "event"],
  stadium: ["stadium", "pill", "terminal"],
  circle: ["circle", "circ", "dbl-circ", "double-circle", "sm-circ", "small-circle", "start", "f-circ", "filled-circle", "junction", "fr-circ", "framed-circle", "stop", "cross-circ", "crossed-circle", "summary"],
  diamond: ["diam", "diamond", "decision", "question"],
  hexagon: ["hex", "hexagon", "prepare"],
  cylinder: ["cyl", "cylinder", "database", "db", "h-cyl", "das", "horizontal-cylinder", "lin-cyl", "disk", "lined-cylinder"],
  subroutine: ["fr-rect", "subprocess", "subproc", "framed-rectangle", "subroutine"],
  parallelogram: ["lean-r", "lean-right", "in-out", "lean-l", "lean-left", "out-in", "trap-b", "priority", "trapezoid", "trapezoid-bottom", "trap-t", "manual", "inv-trapezoid", "trapezoid-top", "sl-rect", "manual-input", "sloped-rectangle"],
  asymmetric: ["odd"],
};
const SHAPE_BY_NAME = new Map(Object.entries(SHAPE_NAMES).flatMap(([shape, names]) => names.map((name) => [name, shape])));

// `shape: cyl, label: "a, b"` → { shape: "cyl", label: "a, b" }
function parseProps(text) {
  const props = {};
  for (const m of text.matchAll(/([\w-]+)\s*:\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^,]*)/g)) {
    props[m[1]] = m[2].trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
  }
  return props;
}

// Index of the "}" that closes the "{" at `open`, skipping quoted text.
function closingBrace(text, open) {
  let quoted = false;
  for (let i = open + 1; i < text.length; i += 1) {
    if (text[i] === '"') quoted = !quoted;
    else if (!quoted && text[i] === "}") return i;
  }
  return -1;
}

function matchAt(re, text, i) {
  re.lastIndex = i;
  return re.exec(text);
}

// "a<br>b" and literal "\n" become separate lines; other HTML tags and entities are dropped.
export function labelLines(raw) {
  return raw
    // Markdown strings: "`**bold** text`"
    .replace(/^`([\s\S]*)`$/, "$1")
    .replace(/#quot;|&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/[#&]#?(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/#amp;|&amp;/g, "&")
    .replace(/#lt;|&lt;/g, "\u0000lt")
    .replace(/#gt;|&gt;/g, "\u0000gt")
    .replace(/<br\s*\/?>|\\n/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/fa[bsr]?:fa-[\w-]+\s*/g, "")
    .replace(/\u0000lt/g, "<")
    .replace(/\u0000gt/g, ">")
    .trim()
    .split("\n")
    // Indentation after a <br> is kept on purpose.
    .map((line) => line.trimEnd());
}

function parseNodeRef(text, start) {
  let i = start;
  while (text[i] === " " || text[i] === "\t") i += 1;
  const idMatch = matchAt(ID, text, i);
  if (!idMatch) return null;
  const ref = { id: idMatch[0], label: null, shape: null, cls: null };
  i += idMatch[0].length;

  const shape = SHAPES.find(([open]) => text.startsWith(open, i));
  if (text.startsWith("@{", i)) {
    const close = closingBrace(text, i + 1);
    if (close < 0) return null;
    const props = parseProps(text.slice(i + 2, close));
    if (props.label !== undefined) ref.label = props.label;
    if (props.shape !== undefined) ref.shape = SHAPE_BY_NAME.get(props.shape.toLowerCase()) ?? "rect";
    i = close + 1;
  } else if (shape) {
    const [open, closers, name] = shape;
    let j = i + open.length;
    let label;
    let end = -1;
    let closer = "";
    const afterQuote = text.slice(j).match(/^\s*"([^"]*)"\s*/);
    if (afterQuote) {
      label = afterQuote[1];
      j += afterQuote[0].length;
      closer = closers.find((c) => text.startsWith(c, j));
      if (closer) end = j;
    }
    if (end < 0) {
      for (const c of closers) {
        const at = text.indexOf(c, i + open.length);
        if (at >= 0 && (end < 0 || at < end)) [end, closer] = [at, c];
      }
      if (end < 0) return null;
      label = text.slice(i + open.length, end);
    }
    ref.label = label;
    ref.shape = name;
    i = end + closer.length;
  }

  const cls = text.slice(i).match(/^:::([\w-]+)/);
  if (cls) {
    ref.cls = cls[1];
    i += cls[0].length;
  }
  return { ref, end: i };
}

function parseGroup(text, start) {
  const refs = [];
  let first = parseNodeRef(text, start);
  if (!first) return null;
  refs.push(first.ref);
  let i = first.end;
  for (;;) {
    const amp = text.slice(i).match(/^\s*&\s*/);
    if (!amp) break;
    const next = parseNodeRef(text, i + amp[0].length);
    if (!next) break;
    refs.push(next.ref);
    i = next.end;
  }
  return { refs, end: i };
}

function linkStyle(op) {
  if (op.startsWith("~")) return "invisible";
  if (op.includes(".")) return "dashed";
  if (op.includes("=")) return "thick";
  return "solid";
}

function parseLink(text, start) {
  const edgeId = matchAt(EDGE_ID, text, start);
  if (edgeId) start += edgeId[0].length;
  let m = matchAt(LINK, text, start);
  let link;
  if (m) {
    const [, pre, op] = m;
    link = {
      style: linkStyle(op),
      startHead: HEADS[pre] ?? null,
      endHead: HEADS[op.at(-1)] ?? null,
      label: null,
      end: start + m[0].length,
    };
  } else {
    m = matchAt(LINK_TEXT_START, text, start);
    if (!m) return null;
    const [, pre, open] = m;
    const endRe = LINK_TEXT_END[open];
    endRe.lastIndex = start + m[0].length;
    const close = endRe.exec(text);
    if (!close) return null;
    const op = close[1];
    link = {
      style: linkStyle(open + op),
      startHead: HEADS[pre] ?? null,
      endHead: HEADS[op.at(-1)] ?? null,
      label: text.slice(start + m[0].length, close.index).trim(),
      end: close.index + close[0].length,
    };
  }
  const pipe = matchAt(PIPE_LABEL, text, link.end);
  if (pipe) {
    link.label = pipe[1].trim();
    link.end += pipe[0].length;
  }
  link.label = link.label ? labelLines(link.label.replace(/^"(.*)"$/, "$1")) : null;
  link.id = edgeId?.[1] ?? null;
  return link;
}

// Splits on ";" and newlines outside quotes and brackets.
function statements(source) {
  const out = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/%%.*$/, "");
    if (/^\s*acc(Title|Descr)\s*:/.test(line)) {
      out.push(line);
      continue;
    }
    let depth = 0;
    let quoted = false;
    let current = "";
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && "[({".includes(ch)) depth += 1;
      else if (!quoted && "])}".includes(ch)) depth = Math.max(0, depth - 1);
      if (ch === ";" && !quoted && depth === 0) {
        out.push(current);
        current = "";
      } else current += ch;
    }
    out.push(current);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

function parseStyle(text) {
  const props = {};
  for (const part of text.split(",")) {
    const [key, value] = part.split(":").map((s) => s?.trim());
    if (key && value) props[key] = value.replace(/;$/, "");
  }
  return props;
}

export function parseMermaid(source) {
  // YAML front matter: only `title:` is used.
  let title = null;
  const footer = [];
  const front = source.match(/^\s*---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  if (front) {
    source = source.slice(front[0].length);
    title = front[1].match(/^title:\s*(.+)$/m)?.[1].trim().replace(/^(["'])(.*)\1$/, "$2") ?? null;
  }
  const lines = statements(source);
  const headerLine = lines.shift() ?? "";
  const header = headerLine.match(/^(flowchart(?:-elk)?|graph)(?:\s+(TB|TD|BT|LR|RL))?\s*$/i);
  const isBlock = /^block(-beta)?$/i.test(headerLine);
  if (!header && !isBlock) {
    if (!headerLine) throw new Error("No Mermaid diagram found (the input is empty).");
    const type = headerLine.split(/\s/)[0];
    throw new Error(`Unsupported diagram type \`${type}\`: only flowchart / graph and block-beta are supported (first line: \`flowchart TD\`, \`graph LR\`, \`block-beta\`).`);
  }
  const warnings = [];
  const warn = (message, line) => warnings.push(`${message}: ${line}`);
  const direction = (header?.[2] ?? "TB").toUpperCase().replace("TD", "TB");

  // block-beta: a tree of groups laid out as grids; nodes are placed where they are first written.
  const root = { kind: "group", id: null, title: null, frame: false, span: 1, columns: null, children: [] };
  const groups = [];
  const blockStack = [root];
  const placed = new Set();

  const nodes = new Map();
  const edges = [];
  const subgraphs = [];
  const classDefs = new Map();
  const nodeStyles = new Map();
  const nodeClasses = new Map();
  const linkStyles = new Map();
  const edgeIds = new Set();
  const stack = [];

  const touch = (ref) => {
    let node = nodes.get(ref.id);
    if (!node) {
      node = { id: ref.id, lines: [ref.id], shape: "rect", parent: stack.at(-1)?.id ?? null, explicit: false };
      nodes.set(ref.id, node);
    }
    if (ref.label !== null) {
      node.lines = labelLines(ref.label);
      node.explicit = true;
    }
    if (ref.shape) {
      node.shape = ref.shape;
      node.explicit = true;
    }
    if (node.parent === null && stack.length) node.parent = stack.at(-1).id;
    if (ref.cls) nodeClasses.set(ref.id, [...(nodeClasses.get(ref.id) ?? []), ref.cls]);
    stack.at(-1)?.members.add(ref.id);
    return node;
  };

  function resolveStyle(id) {
    const style = {};
    for (const cls of nodeClasses.get(id) ?? []) Object.assign(style, classDefs.get(cls));
    return Object.assign(style, nodeStyles.get(id));
  }

  // Handles the block-beta-only statements; returns false for lines shared with flowcharts.
  function parseBlockLine(line) {
    const current = blockStack.at(-1);
    let m;
    if ((m = line.match(/^columns\s+(\d+|auto)$/))) {
      current.columns = m[1] === "auto" ? null : Number(m[1]);
      return true;
    }
    if ((m = line.match(/^block(?::([^\s:[\]"]+))?\s*(?:\[\s*"?(.*?)"?\s*\])?(?::(\d+))?\s*(?:\[\s*"?(.*?)"?\s*\])?\s*$/))) {
      const label = m[2] ?? m[4];
      const group = { kind: "group", id: m[1] ?? null, title: label ? labelLines(label).join(" ") : null, span: Number(m[3] ?? 1), columns: null, children: [] };
      group.frame = Boolean(group.id || group.title);
      current.children.push(group);
      groups.push(group);
      blockStack.push(group);
      return true;
    }
    if (line === "end") {
      if (blockStack.length > 1) blockStack.pop();
      return true;
    }
    if (/^(classDef|class|style|linkStyle|acc(Title|Descr))\b/.test(line)) return false;
    const first = parseGroup(line, 0);
    if (first && parseLink(line, first.end)) return false;

    // A row of blocks: `a["label"]:2 space b`
    let i = 0;
    while (i < line.length) {
      const rest = line.slice(i);
      const ws = rest.match(/^\s+/);
      if (ws) {
        i += ws[0].length;
        continue;
      }
      const space = rest.match(/^space(?::(\d+))?(?=\s|$)/);
      if (space) {
        current.children.push({ kind: "space", span: Number(space[1] ?? 1) });
        i += space[0].length;
        continue;
      }
      const ref = parseNodeRef(line, i);
      if (!ref) {
        const token = rest.match(/^\S+/)[0];
        warn(`Ignored \`${token}\``, line);
        i += token.length;
        continue;
      }
      i = ref.end;
      // Block arrows: `id<["label"]>(right)`; the direction is right, left, up, down, x or y.
      const arrow = line.slice(i).match(/^<\[\s*"?(.*?)"?\s*\]>\(\s*([\w\s,]+?)\s*\)/);
      if (arrow) {
        Object.assign(ref.ref, { label: arrow[1], shape: "arrow" });
        i += arrow[0].length;
      }
      const span = line.slice(i).match(/^:(\d+)/);
      if (span) i += span[0].length;
      const extra = line.slice(i).match(/^\S*/)[0];
      if (extra) warn(`Ignored \`${extra}\``, line);
      i += extra.length;
      const node = touch(ref.ref);
      if (arrow) node.arrow = arrow[2].replace(/\s/g, "").split(",")[0].toLowerCase();
      if (!placed.has(node.id)) {
        placed.add(node.id);
        current.children.push({ kind: "node", id: node.id, span: span ? Number(span[1]) : 1 });
      }
    }
    return true;
  }

  for (const line of lines) {
    let m;
    if (isBlock && parseBlockLine(line)) continue;
    if ((m = line.match(/^subgraph\s+(.+)$/))) {
      const rest = m[1].trim();
      let id;
      let title;
      const bracket = rest.match(/^([^\s[]+)\s*\[\s*"?(.*?)"?\s*\]$/);
      if (bracket) [, id, title] = bracket;
      else if (/^".*"$/.test(rest)) id = title = rest.slice(1, -1);
      else id = title = rest;
      const sg = { id, title: labelLines(title).join(" "), parent: stack.at(-1)?.id ?? null, members: new Set() };
      subgraphs.push(sg);
      stack.push(sg);
    } else if (line === "end") {
      stack.pop();
    } else if ((m = line.match(/^accTitle\s*:\s*(.+)$/))) {
      title = m[1].trim();
    } else if ((m = line.match(/^accDescr\s*:\s*(.+)$/))) {
      footer.push(...labelLines(m[1]));
    } else if (/^direction\s+/.test(line) || /^(click|accDescr|accTitle)\b/.test(line) || /^[^\s@]+@\{/.test(line) && edgeIds.has(line.split("@")[0])) {
      // Not representable in a terminal layout.
    } else if ((m = line.match(/^classDef\s+(\S+)\s+(.+)$/))) {
      for (const name of m[1].split(",")) classDefs.set(name, parseStyle(m[2]));
    } else if ((m = line.match(/^class\s+(\S+)\s+(\S+)$/))) {
      for (const id of m[1].split(",")) nodeClasses.set(id, [...(nodeClasses.get(id) ?? []), m[2]]);
    } else if ((m = line.match(/^style\s+(\S+)\s+(.+)$/))) {
      nodeStyles.set(m[1], parseStyle(m[2]));
    } else if ((m = line.match(/^linkStyle\s+(\S+)\s+(.+)$/))) {
      for (const index of m[1].split(",")) linkStyles.set(index, parseStyle(m[2]));
    } else {
      const first = parseGroup(line, 0);
      if (!first) {
        warn("Ignored a statement that could not be parsed", line);
        continue;
      }
      let group = first.refs.map(touch);
      let i = first.end;
      for (;;) {
        const link = parseLink(line, i);
        if (!link) break;
        const next = parseGroup(line, link.end);
        if (!next) break;
        const targets = next.refs.map(touch);
        for (const from of group) {
          for (const to of targets) {
            edges.push({ from: from.id, to: to.id, style: link.style, startHead: link.startHead, endHead: link.endHead, label: link.label });
          }
        }
        if (link.id) edgeIds.add(link.id);
        group = targets;
        i = next.end;
      }
      const rest = line.slice(i).trim();
      if (rest) warn(`Ignored \`${rest}\``, line);
    }
  }

  if (isBlock) {
    // An edge to a block group's id connects to the group's frame, not to a new block.
    const groupIds = new Set(groups.map((g) => g.id).filter(Boolean));
    for (const node of nodes.values()) {
      if (placed.has(node.id)) continue;
      if (groupIds.has(node.id) && !node.explicit) nodes.delete(node.id);
      else root.children.push({ kind: "node", id: node.id, span: 1 });
    }
    for (const node of nodes.values()) node.style = resolveStyle(node.id);
    for (const g of groups) if (g.id) g.color = resolveStyle(g.id).stroke;
    edges.forEach((edge, index) => {
      edge.styleProps = { ...linkStyles.get("default"), ...linkStyles.get(String(index)) };
    });
    return { type: "block", title, footer, warnings, root, nodes, edges };
  }

  // An edge to a subgraph id points at the subgraph: attach it to a member node instead.
  for (const sg of subgraphs) {
    const stub = nodes.get(sg.id);
    if (!stub || stub.explicit) continue;
    const members = [...nodes.values()].filter((n) => n.id !== sg.id && insideSubgraph(n, sg.id, subgraphs));
    if (!members.length) continue;
    nodes.delete(sg.id);
    for (const edge of edges) {
      if (edge.to === sg.id) edge.to = members[0].id;
      if (edge.from === sg.id) edge.from = members.at(-1).id;
    }
  }

  for (const node of nodes.values()) node.style = resolveStyle(node.id);
  edges.forEach((edge, index) => {
    edge.styleProps = { ...linkStyles.get("default"), ...linkStyles.get(String(index)) };
  });

  return { type: "flowchart", direction, title, footer, warnings, nodes, edges, subgraphs: subgraphs.map(({ members, ...sg }) => sg) };
}

function insideSubgraph(node, sgId, subgraphs) {
  let parent = node.parent;
  while (parent) {
    if (parent === sgId) return true;
    parent = subgraphs.find((s) => s.id === parent)?.parent ?? null;
  }
  return false;
}
