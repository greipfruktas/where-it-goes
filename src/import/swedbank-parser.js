const REQUIRED_HEADERS = new Map([
  ["DATA", "date"],
  ["GAVEJAS MOKETOJAS", "merchant"],
  ["PAAISKINIMAI", "description"],
  ["APYVARTA", "amount"]
]);

function normalizedHeader(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function localDate(year, month, day) {
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDate(value, XLSX) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return localDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? localDate(parsed.y, parsed.m, parsed.d) : null;
  }
  const text = String(value ?? "").trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return localDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  return match ? localDate(Number(match[3]), Number(match[2]), Number(match[1])) : null;
}

function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").replace(/[\s\u00a0\u202f]/g, "").replace(/,/g, ".").replace(/[^0-9+.-]/g, "");
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : null;
}

function populatedBounds(sheet, XLSX) {
  const cells = Object.keys(sheet).filter((key) => !key.startsWith("!") && /^[A-Z]+\d+$/.test(key));
  if (!cells.length) return null;
  const points = cells.map((key) => XLSX.utils.decode_cell(key));
  return {
    minRow: Math.min(...points.map((point) => point.r)),
    maxRow: Math.max(...points.map((point) => point.r)),
    minColumn: Math.min(...points.map((point) => point.c)),
    maxColumn: Math.max(...points.map((point) => point.c))
  };
}

function cellValue(sheet, row, column, XLSX) {
  return sheet[XLSX.utils.encode_cell({ r: row, c: column })]?.v;
}

export function parseSwedbankWorkbook(arrayBuffer, XLSX) {
  let workbook;
  try {
    workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true, raw: true });
  } catch {
    throw new Error("The statement is unreadable or encrypted");
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const bounds = sheet && populatedBounds(sheet, XLSX);
  if (!bounds) throw new Error("The statement has no transaction rows");

  let headerRow = -1;
  let columns = null;
  for (let row = bounds.minRow; row <= bounds.maxRow; row += 1) {
    const found = {};
    for (let column = bounds.minColumn; column <= bounds.maxColumn; column += 1) {
      const field = REQUIRED_HEADERS.get(normalizedHeader(cellValue(sheet, row, column, XLSX)));
      if (field) found[field] = column;
    }
    if (Object.keys(found).length === REQUIRED_HEADERS.size) {
      headerRow = row;
      columns = found;
      break;
    }
  }
  if (headerRow < 0) throw new Error("Required Swedbank headers were not found");

  const transactions = [];
  let unreadableRows = 0;
  let candidateRows = 0;
  for (let row = headerRow + 1; row <= bounds.maxRow; row += 1) {
    const values = {
      date: cellValue(sheet, row, columns.date, XLSX),
      merchant: cellValue(sheet, row, columns.merchant, XLSX),
      description: cellValue(sheet, row, columns.description, XLSX),
      amount: cellValue(sheet, row, columns.amount, XLSX)
    };
    const hasTransactionData = String(values.merchant ?? "").trim() || String(values.description ?? "").trim();
    if (!hasTransactionData) continue;
    candidateRows += 1;
    const date = parseDate(values.date, XLSX);
    const signedAmount = parseAmount(values.amount);
    if (!date || signedAmount == null) {
      unreadableRows += 1;
      continue;
    }
    transactions.push({
      date,
      signedAmount,
      merchant: String(values.merchant ?? "").trim(),
      description: String(values.description ?? "").trim(),
      sourceRow: row + 1
    });
  }
  if (!candidateRows) throw new Error("The statement has no transaction rows");
  if (!transactions.length) throw new Error("The statement has no valid transaction rows");
  return { transactions, unreadableRows };
}
