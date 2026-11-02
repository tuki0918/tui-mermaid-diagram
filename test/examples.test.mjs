// Every bundled example must render without throwing or skipping anything.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { renderMermaid, toAnsi } from "../src/index.mjs";

const dirs = ["examples/use-cases", "examples/mermaid-docs"];

for (const dir of dirs) {
  for (const file of readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((f) => f.endsWith(".mmd"))) {
    test(`${dir}/${file}`, () => {
      const warnings = [];
      const source = readFileSync(new URL(`../${dir}/${file}`, import.meta.url), "utf8");
      const out = toAnsi(renderMermaid(source, { onWarning: (w) => warnings.push(w) }), false);
      assert.deepEqual(warnings, []);
      assert.ok(out.trim().length > 0);
    });
  }
}
