import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");

assert.match(html, /class="total-card pocket-ledger-card"/, "monthly total card should opt into the Pocket Ledger treatment");
assert.match(css, /--paper:\s*#f3ecdc/, "Pocket Ledger should use a warmer paper background");
assert.match(css, /\.pocket-ledger-card::before/, "Pocket Ledger total card should have a tactile paper/highlight layer");
assert.match(css, /\.expense-item:active/, "expense rows should have a touch-friendly pressed state");
