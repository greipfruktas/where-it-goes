import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

assert.match(html, /class="total-card pocket-ledger-card"/, "monthly total card should opt into the Pocket Ledger treatment");
assert.match(css, /--paper:\s*#f3ecdc/, "Pocket Ledger should use a warmer paper background");
assert.match(css, /\.pocket-ledger-card::before/, "Pocket Ledger total card should have a tactile paper/highlight layer");
assert.match(css, /\.expense-item:active/, "expense rows should have a touch-friendly pressed state");
assert.match(html, /id="styleButton"/, "header should include a style menu button");
assert.match(html, /data-style-option="pocket"/, "style menu should include Option A");
assert.match(html, /data-style-option="neon"/, "style menu should include Option B");
assert.match(html, /data-style-option="swiss"/, "style menu should include Option C");
assert.match(css, /body\[data-style="neon"\]/, "Option B should have a Neon Night theme hook");
assert.match(css, /body\[data-style="swiss"\]/, "Option C should have a Minimal Swiss theme hook");
assert.match(js, /STYLE_KEY/, "selected style should be saved separately from expenses");
assert.match(js, /function applyAppStyle/, "style selection should be applied through a named helper");
assert.match(html, /id="rangeStartInput"/, "overview should include a from-date input");
assert.match(html, /id="rangeEndInput"/, "overview should include a to-date input");
assert.match(html, /data-period-mode="range"/, "overview should include a custom dates mode");
assert.match(css, /\.date-range-controls/, "custom date inputs should be styled for mobile");
assert.match(html, /class="date-range-card"/, "custom date inputs should sit in one connected card");
assert.match(html, /class="range-connector"/, "custom date fields should have a visual from-to connector");
assert.match(css, /\.date-field span/, "date labels should be straight above their date inputs");
