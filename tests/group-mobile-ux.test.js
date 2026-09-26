import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

assert.match(styles, /\.category-picker\s*\{/);
assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.group-date-row\s*\{[^}]*grid-template-columns:\s*1fr/);
assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.repayment-people\s*\{[^}]*grid-template-columns:\s*1fr/);
assert.match(styles, /\.group-expense-form input[\s\S]*?max-width:\s*100%/);
