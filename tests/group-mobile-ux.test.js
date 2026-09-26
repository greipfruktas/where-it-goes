import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

assert.match(styles, /\.category-picker\s*\{/);
assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.group-date-row\s*\{[^}]*grid-template-columns:\s*1fr/);
assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.repayment-people\s*\{[^}]*grid-template-columns:\s*1fr/);
assert.match(styles, /\.group-expense-form input[\s\S]*?max-width:\s*100%/);
assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.category-picker\s*\{[^}]*grid-template-columns:\s*repeat\(5/);
assert.match(styles, /\.group-date-control\s*\{[^}]*overflow:\s*hidden/);
assert.match(styles, /\.group-date-control input\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/);
