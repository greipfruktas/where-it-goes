const LABELS = ["Must", "Work", "Family", "Treat", "Subscription"];

function escapeHTML(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function filePicker(filename = "") {
  return `<label class="import-file-picker">
    <span>${filename ? escapeHTML(filename) : "Choose Swedbank statement"}</span>
    <input type="file" accept=".xlsx,.xls" data-import-file aria-label="Choose Swedbank statement" />
  </label>`;
}

function rowMarkup(row, categories) {
  const active = categories.find(({ name }) => name === row.category) || categories.find(({ name }) => name === "Other") || { emoji: "✨", name: "Other" };
  return `<article class="import-row${row.error ? " has-error" : ""}" data-import-row="${escapeHTML(row.id)}">
    <div class="import-row-summary">
      <label class="import-check"><input type="checkbox" data-row-selected="${escapeHTML(row.id)}" ${row.selected ? "checked" : ""} ${row.inRange ? "" : "disabled"} /><span>Include</span></label>
      <span class="category-icon">${escapeHTML(active.emoji)}</span>
      <div class="import-row-title"><strong>${escapeHTML(row.merchant || row.description || "Expense")}</strong><small>${escapeHTML(row.date)} · €${Number(row.amount).toFixed(2)}</small></div>
      <div class="import-statuses">${row.duplicate ? '<span class="import-status">Duplicate</span>' : ""}${row.possibleDuplicate ? '<span class="import-status possible">Possible duplicate</span>' : ""}${row.needsReview ? '<span class="import-status warning">Other</span>' : ""}</div>
    </div>
    <div class="import-row-editor">
      <label><span>Date</span><input class="import-control" type="date" data-row-date="${escapeHTML(row.id)}" value="${escapeHTML(row.date)}" /></label>
      <label><span>Amount</span><input class="import-control" type="number" inputmode="decimal" min="0.01" step="0.01" data-row-amount="${escapeHTML(row.id)}" value="${escapeHTML(row.amount)}" /></label>
      <label class="import-wide"><span>Description</span><input class="import-control" type="text" maxlength="60" data-row-note="${escapeHTML(row.id)}" value="${escapeHTML(row.note)}" /></label>
      <label><span>Category</span><select class="import-control" data-row-category="${escapeHTML(row.id)}">${categories.map(({ name, emoji }) => `<option value="${escapeHTML(name)}" ${name === row.category ? "selected" : ""}>${escapeHTML(emoji)} ${escapeHTML(name)}</option>`).join("")}</select></label>
      <label><span>Coming back %</span><input class="import-control" type="number" inputmode="numeric" min="0" max="100" step="1" data-row-reimbursement="${escapeHTML(row.id)}" value="${escapeHTML(row.reimbursementPercent)}" /></label>
      <fieldset class="import-wide"><legend>Labels</legend><div class="import-labels">${LABELS.map((label) => `<label><input type="checkbox" data-row-label="${escapeHTML(row.id)}" value="${label}" ${(row.labels || []).includes(label) ? "checked" : ""} /><span>${label}</span></label>`).join("")}</div></fieldset>
    </div>
    ${row.error ? `<p class="import-row-error" role="alert">${escapeHTML(row.error)}</p>` : ""}
  </article>`;
}

export function renderImportSheet(root, state, categories = []) {
  const summary = state?.summary;
  root.innerHTML = `<section class="sheet import-sheet" role="dialog" aria-modal="true" aria-labelledby="importTitle">
    <div class="sheet-handle"></div>
    <div class="sheet-header"><div><p class="eyebrow">BANK STATEMENT</p><h2 id="importTitle">Import expenses</h2></div><button type="button" class="close-button" data-import-close aria-label="Close">×</button></div>
    ${filePicker(state?.filename)}
    <p class="import-privacy">Your statement stays on this device. Only expenses you save are added to Personal.</p>
    ${state?.error ? `<p class="import-error" role="alert">${escapeHTML(state.error)}</p>` : ""}
    ${state?.rows ? `<div class="import-review">
      <div class="import-range"><label><span>From</span><input class="import-control" type="date" data-import-from value="${escapeHTML(state.from)}" /></label><span aria-hidden="true">→</span><label><span>To</span><input class="import-control" type="date" data-import-to value="${escapeHTML(state.to)}" /></label></div>
      <div class="import-summary">
        <span><b>${summary.outgoing}</b>Expenses found</span><span><b>${summary.incomingIgnored}</b>Incoming ignored</span><span><b>${summary.outsideRange}</b>Outside dates</span>
        <span><b>${summary.duplicatesExcluded}</b>Duplicates</span><span><b>${summary.possibleDuplicatesExcluded}</b>Possible duplicates</span><span><b>${summary.other}</b>Needs category</span><span><b>${summary.unreadableRows}</b>Unreadable rows</span>
      </div>
      <div class="import-bulk-actions"><button type="button" data-import-select-new>Select all new</button><button type="button" data-import-exclude-all>Exclude all</button></div>
      <div class="import-rows">${state.rows.map((row) => rowMarkup(row, categories)).join("")}</div>
      <div class="import-actions"><button type="button" class="delete-button" data-import-close>Cancel</button><button type="button" class="save-button" data-import-save>Save selected expenses</button></div>
    </div>` : ""}
  </section>`;
}
