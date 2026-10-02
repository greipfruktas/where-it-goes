import { upsertLearnedRule } from "./categorizer.js";
import { buildImportBatch, createReviewState, filterReviewRows, reviewSummary, updateReviewRow } from "./domain.js";
import { parseSwedbankWorkbook } from "./swedbank-parser.js";
import { renderImportSheet } from "./view.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function createImportController({
  root,
  fileReader = (file) => file.arrayBuffer(),
  XLSX,
  personalData,
  digest,
  notify = () => {},
  parseWorkbook = parseSwedbankWorkbook,
  createState = createReviewState,
  buildBatch = buildImportBatch,
  now = () => Date.now(),
  documentState = globalThis.document
}) {
  let state = null;
  let generation = 0;
  let previousFocus = null;

  function render() {
    const snapshot = personalData.snapshot();
    const visible = state?.rows ? { ...state, summary: reviewSummary(state) } : state;
    renderImportSheet(root, visible, snapshot.categories || []);
  }

  function open() {
    generation += 1;
    state = null;
    previousFocus = documentState?.activeElement || null;
    root.hidden = false;
    if (documentState?.body) documentState.body.style.overflow = "hidden";
    render();
    root.querySelector?.("[data-import-file]")?.focus?.();
  }

  function close() {
    generation += 1;
    state = null;
    root.hidden = true;
    root.innerHTML = "";
    if (documentState?.body) documentState.body.style.overflow = "";
    previousFocus?.focus?.();
    previousFocus = null;
  }

  async function chooseFile(file) {
    const name = String(file?.name || "");
    const request = ++generation;
    state = { filename: name, loading: true };
    root.hidden = false;
    render();
    try {
      if (!/\.(xlsx|xls)$/i.test(name)) throw new Error("Choose an XLSX or XLS file");
      if (Number(file?.size) > MAX_FILE_SIZE) throw new Error("The statement must be 10 MB or smaller");
      const buffer = await fileReader(file);
      if (request !== generation) return null;
      const parsed = parseWorkbook(buffer, XLSX);
      const snapshot = personalData.snapshot();
      state = await createState({ ...parsed, categories: snapshot.categories || [], learnedRules: snapshot.importRules || [], existingExpenses: snapshot.expenses || [], digest });
      if (request !== generation) return null;
      state = { ...state, filename: name };
      root.hidden = false;
      render();
      return state;
    } catch (error) {
      if (request !== generation) return null;
      state = { filename: name, error: error.message };
      root.hidden = false;
      render();
      throw error;
    }
  }

  function setRange(from, to) {
    state = filterReviewRows(state, from || state.from, to || state.to);
    render();
  }

  function updateRow(id, patch) {
    const current = state.rows.find((row) => row.id === id);
    state = updateReviewRow(state, id, { ...patch, error: "" });
    if (patch.category && patch.category !== current.category && current.merchantKey) {
      state.pendingRules = upsertLearnedRule(state.pendingRules, current.merchantKey, patch.category, now());
    }
    render();
  }

  function selectAllNew() {
    state = { ...state, rows: state.rows.map((row) => ({ ...row, selected: row.inRange && !row.duplicate })) };
    render();
  }

  function excludeAll() {
    state = { ...state, rows: state.rows.map((row) => ({ ...row, selected: false })) };
    render();
  }

  function save() {
    try {
      const batch = buildBatch(state, now());
      const count = personalData.commitImportBatch(batch);
      notify(`${count} expense${count === 1 ? "" : "s"} saved locally`);
      close();
      return count;
    } catch (error) {
      state = { ...state, rows: state.rows.map((row) => row.id === error.rowId ? { ...row, error: error.message } : row) };
      render();
      throw error;
    }
  }

  root.addEventListener?.("change", async (event) => {
    const target = event.target;
    try {
      if (target.matches?.("[data-import-file]") && target.files?.[0]) await chooseFile(target.files[0]);
      else if (target.matches?.("[data-import-from]")) setRange(target.value, state.to);
      else if (target.matches?.("[data-import-to]")) setRange(state.from, target.value);
      else {
        const id = target.dataset?.rowSelected || target.dataset?.rowDate || target.dataset?.rowAmount || target.dataset?.rowNote || target.dataset?.rowCategory || target.dataset?.rowReimbursement || target.dataset?.rowLabel;
        if (!id) return;
        if (target.dataset.rowSelected) updateRow(id, { selected: target.checked });
        if (target.dataset.rowDate) updateRow(id, { date: target.value });
        if (target.dataset.rowAmount) updateRow(id, { amount: Number(target.value) });
        if (target.dataset.rowNote) updateRow(id, { note: target.value });
        if (target.dataset.rowCategory) updateRow(id, { category: target.value, needsReview: target.value === "Other" });
        if (target.dataset.rowReimbursement) updateRow(id, { reimbursementPercent: Number(target.value) });
        if (target.dataset.rowLabel) {
          const row = state.rows.find((item) => item.id === id);
          const labels = target.checked ? [...new Set([...row.labels, target.value])] : row.labels.filter((label) => label !== target.value);
          updateRow(id, { labels });
        }
      }
    } catch (error) { notify(error.message); }
  });
  root.addEventListener?.("click", (event) => {
    if (event.target.closest?.("[data-import-close]")) close();
    if (event.target.closest?.("[data-import-select-new]")) selectAllNew();
    if (event.target.closest?.("[data-import-exclude-all]")) excludeAll();
    if (event.target.closest?.("[data-import-save]")) {
      try { save(); } catch (error) { notify(error.message); }
    }
  });
  root.addEventListener?.("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  return { open, close, chooseFile, setRange, updateRow, selectAllNew, excludeAll, save, getState: () => state };
}

const root = globalThis.document?.querySelector?.("#importSheet");
const button = globalThis.document?.querySelector?.("#importButton");
if (root && button && globalThis.XLSX && globalThis.whereItGoesPersonalData) {
  const controller = createImportController({
    root,
    XLSX: globalThis.XLSX,
    personalData: globalThis.whereItGoesPersonalData,
    notify: (message) => globalThis.whereItGoesPersonalData.showStorageError(message)
  });
  button.addEventListener("click", () => controller.open());
}
