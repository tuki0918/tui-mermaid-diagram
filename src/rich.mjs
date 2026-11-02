// Light markup inside labels:
//   "# HEADING"   → bold, in the box color
//   "*note*"      → gray
//   "**strong**"  → bold
//   leading ✓ / ✕ → green / red marker
const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*/g;

export function spans(line) {
  const heading = line.match(/^#+\s+(.*)$/);
  if (heading) return [{ text: heading[1], role: "accent" }];
  const out = [];
  let rest = line;
  const mark = rest.match(/^([✓✔]|[✕✗×])\s*/);
  if (mark) {
    out.push(/[✓✔]/.test(mark[1]) ? { text: "✓ ", role: "ok" } : { text: "✕ ", role: "ng" });
    rest = rest.slice(mark[0].length);
  }
  let last = 0;
  for (const m of rest.matchAll(INLINE)) {
    if (m.index > last) out.push({ text: rest.slice(last, m.index), role: "text" });
    out.push(m[1] !== undefined ? { text: m[1], role: "strong" } : { text: m[2], role: "muted" });
    last = m.index + m[0].length;
  }
  if (last < rest.length) out.push({ text: rest.slice(last), role: "text" });
  return out;
}

export const plain = (line) => spans(line).map((s) => s.text).join("");
