import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { parseSwedbankWorkbook } from "../src/import/swedbank-parser.js";

const require = createRequire(import.meta.url);
const XLSX = require("../vendor/xlsx.full.min.js");
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

for (const name of ["swedbank-sanitized.xlsx", "swedbank-sanitized.xls"]) {
  const result = parseSwedbankWorkbook(fixture(name), XLSX);
  assert.deepEqual(result.transactions.map(({ date, signedAmount, merchant, description }) => ({ date, signedAmount, merchant, description })), [
    { date: "2026-09-01", signedAmount: -12.34, merchant: "GREEN MARKET", description: "Card purchase" },
    { date: "2026-09-02", signedAmount: 500, merchant: "SANITIZED EMPLOYER", description: "Incoming transfer" },
    { date: "2026-09-03", signedAmount: -1234.56, merchant: "CITY HOTEL", description: "Weekend" },
    { date: "2026-09-04", signedAmount: -4.5, merchant: "CITY BUS", description: "Ticket" },
    { date: "2026-09-04", signedAmount: -4.5, merchant: "CITY BUS", description: "Ticket" }
  ], `${name} should normalize the same transactions`);
  assert.equal(result.unreadableRows, 1);
}

function workbook(rows) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Statement");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

assert.throws(() => parseSwedbankWorkbook(workbook([["Not", "Swedbank"]]), XLSX), /required Swedbank headers/i);
assert.throws(() => parseSwedbankWorkbook(workbook([["Data", "Gavėjas\/Mokėtojas", "Paaiškinimai", "Apyvarta"]]), XLSX), /no transaction rows/i);
assert.throws(() => parseSwedbankWorkbook(workbook([
  ["Data", "Gavėjas\/Mokėtojas", "Paaiškinimai", "Apyvarta"],
  ["bad-date", "Merchant", "Text", "bad-amount"]
]), XLSX), /no valid transaction rows/i);

const previousTZ = process.env.TZ;
for (const timezone of ["America/Los_Angeles", "Pacific/Auckland"]) {
  process.env.TZ = timezone;
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Data", "Gavėjas/Mokėtojas", "Paaiškinimai", "Apyvarta"],
    [46266, "MIDNIGHT SERIAL", "Timezone test", -1]
  ]);
  sheet.A2.z = "yyyy-mm-dd";
  XLSX.utils.book_append_sheet(book, sheet, "Statement");
  const bytes = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  assert.equal(parseSwedbankWorkbook(bytes, XLSX).transactions[0].date, "2026-09-01", timezone);
}
process.env.TZ = previousTZ;

const brokenRangeSheet = XLSX.utils.aoa_to_sheet([
  ["Data", "Gavėjas/Mokėtojas", "Paaiškinimai", "Apyvarta"],
  ["2026-09-05", "RANGE TEST", "Still visible", -2]
]);
brokenRangeSheet["!ref"] = "A1";
const brokenRangeXLSX = {
  ...XLSX,
  read: () => ({ SheetNames: ["Statement"], Sheets: { Statement: brokenRangeSheet } })
};
assert.equal(parseSwedbankWorkbook(new ArrayBuffer(0), brokenRangeXLSX).transactions[0].merchant, "RANGE TEST");
