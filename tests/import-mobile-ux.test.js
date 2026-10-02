import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

assert.match(css, /\.import-control\s*\{[^}]*height:\s*48px[^}]*font-size:\s*16px/s,
  "import editor controls should share a fixed touch size and avoid iPhone input zoom");
assert.match(css, /@media\s*\(max-width:\s*699px\)[\s\S]*?\.import-backdrop\s*\{[^}]*overflow-y:\s*auto/s,
  "the mobile importer should have one viewport scroll surface");
assert.match(css, /@media\s*\(max-width:\s*699px\)[\s\S]*?\.import-sheet\s*\{[^}]*min-height:\s*100dvh[^}]*overflow:\s*visible/s,
  "the mobile import sheet should be a full-screen workspace rather than a nested scroller");
