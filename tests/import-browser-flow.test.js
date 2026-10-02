import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createImportController } from "../src/import/controller.js";

const require = createRequire(import.meta.url);
const XLSX = require("../vendor/xlsx.full.min.js");
const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const values = new Map();
const element = () => ({ value: "", hidden: false, innerHTML: "", textContent: "", addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {}, setAttribute() {}, reset() {}, showPicker() {}, focus() {} });
const sandbox = {
  Intl, console, structuredClone, crypto,
  localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) },
  document: { body: { dataset: {}, style: {} }, querySelector: () => element(), querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ click() {} }) },
  window: { addEventListener() {}, scrollTo() {} }, navigator: {}, setTimeout: () => 1, clearTimeout() {}
};
vm.createContext(sandbox);
vm.runInContext(appSource, sandbox);

const listeners = {};
const root = {
  hidden: true, innerHTML: "",
  addEventListener(type, listener) { listeners[type] = listener; },
  querySelector() { return null; }
};
const notices = [];
const controller = createImportController({ root, XLSX, personalData: sandbox.whereItGoesPersonalData, notify: (message) => notices.push(message), documentState: sandbox.document });
const file = (name) => ({ name, size: fs.statSync(new URL(`./fixtures/${name}`, import.meta.url)).size, arrayBuffer: async () => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url)) });

controller.open();
await listeners.change({ target: { matches: (selector) => selector === "[data-import-file]", files: [file("swedbank-sanitized.xlsx")] } });
assert.equal(controller.getState().rows.length, 4);
const other = controller.getState().rows.find(({ category }) => category === "Other");
await listeners.change({ target: { matches: () => false, dataset: { rowCategory: other.id }, value: "Home" } });
assert.equal(controller.getState().pendingRules[0].category, "Home");
listeners.click({ target: { closest: (selector) => selector === "[data-import-save]" ? {} : null } });
assert.equal(sandbox.whereItGoesPersonalData.snapshot().expenses.length, 4);
assert.match(values.get("where-it-goes-expenses-v1"), /swedbank:/);

controller.open();
await listeners.change({ target: { matches: (selector) => selector === "[data-import-file]", files: [file("swedbank-sanitized.xls")] } });
assert.equal(controller.getState().rows.filter(({ duplicate }) => duplicate).length, 4);
assert.equal(controller.getState().rows.filter(({ selected }) => selected).length, 0);
const duplicate = controller.getState().rows[0];
await listeners.change({ target: { matches: () => false, dataset: { rowSelected: duplicate.id }, checked: true } });
listeners.click({ target: { closest: (selector) => selector === "[data-import-save]" ? {} : null } });
assert.equal(sandbox.whereItGoesPersonalData.snapshot().expenses.length, 4, "duplicate override replaces instead of appending");
assert.ok(notices.some((message) => /saved locally/.test(message)));
