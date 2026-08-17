const STORAGE_KEY = "where-it-goes-expenses-v1";

const categories = [
  { name: "Food", emoji: "🥑", color: "#e6f0df" },
  { name: "Home", emoji: "🏡", color: "#f3e7d4" },
  { name: "Transport", emoji: "🚲", color: "#dfeaf0" },
  { name: "Bills", emoji: "🧾", color: "#eee4f0" },
  { name: "Shopping", emoji: "🛍️", color: "#f5e1df" },
  { name: "Health", emoji: "🩹", color: "#e2efea" },
  { name: "Fun", emoji: "🎟️", color: "#f4ebcf" },
  { name: "Other", emoji: "✨", color: "#e8e9e5" }
];
const labels = ["Must", "Work", "Family", "Treat", "Subscription"];

let expenses = loadExpenses();
let selectedMonth = monthKey(new Date());
let selectedCategory = "Food";
let selectedLabels = [];
let selectedReimbursementPercent = 0;
let expandedBreakdownCategories = new Set();

const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });

function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function monthKey(date) {
  return localDateString(date).slice(0, 7);
}

function loadExpenses() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
}

function formatDate(dateString, options = { day: "numeric", month: "short" }) {
  return new Intl.DateTimeFormat("en-IE", options).format(new Date(`${dateString}T12:00:00`));
}

function categoryFor(name) {
  return categories.find((category) => category.name === name) || categories.at(-1);
}

function reimbursementPercent(expense) {
  return Math.min(100, Math.max(0, Number(expense.reimbursementPercent) || 0));
}

function amountComingBack(expense) {
  return expense.amount * reimbursementPercent(expense) / 100;
}

function yourShare(expense) {
  return expense.amount - amountComingBack(expense);
}

function initChoices() {
  $("#categoryChoices").innerHTML = categories.map(({ name, emoji }) => `
    <button class="choice${name === selectedCategory ? " selected" : ""}" type="button" data-category="${name}">
      <span class="emoji">${emoji}</span><span>${name}</span>
    </button>`).join("");
  $("#labelChoices").innerHTML = labels.map((label) => `
    <button class="label-choice" type="button" data-label="${label}">${label}</button>`).join("");
}

function render() {
  const monthly = expenses
    .filter((expense) => expense.date.startsWith(selectedMonth))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const paidTotal = monthly.reduce((sum, expense) => sum + expense.amount, 0);
  const comingBackTotal = monthly.reduce((sum, expense) => sum + amountComingBack(expense), 0);
  const total = paidTotal - comingBackTotal;
  const monthDate = new Date(`${selectedMonth}-15T12:00:00`);

  $("#monthLabel").textContent = new Intl.DateTimeFormat("en-IE", { month: "long", year: "numeric" }).format(monthDate);
  $("#monthInput").value = selectedMonth;
  $("#monthTotal").textContent = money.format(total);
  $("#expenseCount").textContent = monthly.length ? `${monthly.length} expense${monthly.length === 1 ? "" : "s"} recorded` : "No expenses yet";
  $("#reimbursementSummary").hidden = comingBackTotal === 0;
  $("#reimbursementSummary").textContent = `${money.format(paidTotal)} paid · ${money.format(comingBackTotal)} coming back`;

  renderBreakdown(monthly, total);
  renderExpenseList($("#recentList"), monthly.slice(0, 4), "No expenses this month. Add your first one.");
  renderHistory();
}

function breakdownMarkup(monthly, total, expandedCategories) {
  const totals = monthly.reduce((map, expense) => {
    map[expense.category] = (map[expense.category] || 0) + yourShare(expense);
    return map;
  }, {});
  const expensesByCategory = monthly.reduce((map, expense) => {
    map[expense.category] = [...(map[expense.category] || []), expense];
    return map;
  }, {});
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  return rows.length ? rows.map(([name, amount]) => {
    const category = categoryFor(name);
    const percent = total ? Math.round((amount / total) * 100) : 0;
    const expanded = expandedCategories.has(name);
    const expenses = expensesByCategory[name] || [];
    return `<div class="breakdown-group${expanded ? " open" : ""}">
      <button class="breakdown-row" type="button" data-breakdown-category="${escapeHTML(name)}" aria-expanded="${expanded}">
        <div class="category-icon" style="background:${category.color}">${category.emoji}</div>
        <div class="breakdown-copy"><strong>${escapeHTML(name)}</strong><div class="progress"><span style="width:${percent}%"></span></div></div>
        <div class="breakdown-amount"><strong>${money.format(amount)}</strong><span>${percent}% · ${expenses.length} item${expenses.length === 1 ? "" : "s"}</span></div>
        <span class="breakdown-chevron" aria-hidden="true">⌄</span>
      </button>
      ${expanded ? `<div class="breakdown-expenses">${expenses.map(expenseMarkup).join("")}</div>` : ""}
    </div>`;
  }).join("") : `<div class="empty-state">Your category breakdown will appear here.</div>`;
}

function renderBreakdown(monthly, total) {
  $("#breakdown").innerHTML = breakdownMarkup(monthly, total, expandedBreakdownCategories);
}

function expenseMarkup(expense) {
  const category = categoryFor(expense.category);
  const percentBack = reimbursementPercent(expense);
  const detail = [expense.category, ...(expense.labels || []), formatDate(expense.date)].join(" · ");
  return `<button class="expense-item" data-expense-id="${expense.id}">
    <span class="category-icon" style="background:${category.color}">${category.emoji}</span>
    <span class="expense-main"><strong>${escapeHTML(expense.note || expense.category)}</strong><span>${escapeHTML(detail)}</span></span>
    <span class="expense-price"><strong>${money.format(expense.amount)}</strong><span>${percentBack ? `${money.format(yourShare(expense))} yours` : "Paid"}</span></span>
  </button>`;
}

function renderExpenseList(container, items, emptyMessage) {
  container.innerHTML = items.length ? items.map(expenseMarkup).join("") : `<div class="empty-state">${emptyMessage}</div>`;
}

function renderHistory() {
  const query = $("#searchInput").value.trim().toLowerCase();
  const filtered = [...expenses]
    .filter((expense) => [expense.category, expense.note, ...(expense.labels || [])].join(" ").toLowerCase().includes(query))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  if (!filtered.length) {
    $("#historyList").innerHTML = `<div class="empty-state">${query ? "No matching expenses." : "Your expenses will collect here."}</div>`;
    return;
  }
  let previous = "";
  $("#historyList").innerHTML = filtered.map((expense) => {
    const heading = expense.date === previous ? "" : `<div class="date-divider">${formatDate(expense.date, { weekday: "short", day: "numeric", month: "long", year: "numeric" })}</div>`;
    previous = expense.date;
    return heading + expenseMarkup(expense);
  }).join("");
}

function escapeHTML(value = "") {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function openSheet(expense = null) {
  $("#expenseForm").reset();
  $("#expenseId").value = expense?.id || "";
  $("#dateInput").value = expense?.date || localDateString();
  $("#amountInput").value = expense ? expense.amount.toFixed(2) : "";
  $("#noteInput").value = expense?.note || "";
  selectedCategory = expense?.category || "Food";
  selectedLabels = [...(expense?.labels || [])];
  selectedReimbursementPercent = reimbursementPercent(expense || {});
  $("#customReimbursementInput").value = selectedReimbursementPercent && ![50, 100].includes(selectedReimbursementPercent) ? selectedReimbursementPercent : 25;
  $("#formModeLabel").textContent = expense ? "EDIT ENTRY" : "NEW ENTRY";
  $("#sheetTitle").textContent = expense ? "Edit expense" : "Add expense";
  $("#deleteButton").hidden = !expense;
  updateChoices();
  $("#expenseSheet").hidden = false;
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => $("#amountInput").focus());
}

function closeSheet() {
  $("#expenseSheet").hidden = true;
  document.body.style.overflow = "";
}

function updateChoices() {
  document.querySelectorAll("[data-category]").forEach((button) => button.classList.toggle("selected", button.dataset.category === selectedCategory));
  document.querySelectorAll("[data-label]").forEach((button) => button.classList.toggle("selected", selectedLabels.includes(button.dataset.label)));
  const preset = [0, 50, 100].includes(selectedReimbursementPercent) ? String(selectedReimbursementPercent) : "custom";
  document.querySelectorAll("[data-reimbursement]").forEach((button) => button.classList.toggle("selected", button.dataset.reimbursement === preset));
  $("#customReimbursementField").hidden = preset !== "custom";
  updateReimbursementPreview();
}

function updateReimbursementPreview() {
  const amount = Number.parseFloat($("#amountInput").value) || 0;
  const comingBack = amount * selectedReimbursementPercent / 100;
  $("#reimbursementPreview").hidden = selectedReimbursementPercent === 0 || amount === 0;
  $("#reimbursementPreview").textContent = `${money.format(comingBack)} coming back · your share ${money.format(amount - comingBack)}`;
}

function showToast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => $("#toast").classList.remove("show"), 1800);
}

function downloadFile(content, type, filename) {
  const blob = new Blob([content], { type });
  const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: filename });
  link.click();
  URL.revokeObjectURL(link.href);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function expensesCSV() {
  const headers = ["Date", "Category", "Labels", "Note", "Paid", "Coming back %", "Coming back", "Your share"];
  const rows = [...expenses]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    .map((expense) => [
      expense.date,
      expense.category,
      (expense.labels || []).join(", "),
      expense.note || "",
      expense.amount.toFixed(2),
      reimbursementPercent(expense),
      amountComingBack(expense).toFixed(2),
      yourShare(expense).toFixed(2)
    ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function exportExpenses(format) {
  if (!expenses.length) { showToast("Nothing to export yet"); return; }
  if (format === "csv") {
    downloadFile(`\uFEFF${expensesCSV()}`, "text/csv;charset=utf-8", `where-it-goes-${localDateString()}.csv`);
    showToast("Excel export ready");
    return;
  }
  downloadFile(JSON.stringify(expenses, null, 2), "application/json", `where-it-goes-${localDateString()}.json`);
  showToast("Backup export ready");
}

function toggleExportMenu(forceOpen = null) {
  const menu = $("#exportMenu");
  const open = forceOpen ?? menu.hidden;
  menu.hidden = !open;
  $("#exportButton").setAttribute("aria-expanded", String(open));
}

function switchView(view) {
  document.querySelectorAll(".view").forEach((element) => element.classList.toggle("active", element.id === `${view}View`));
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $(".topbar").style.display = view === "overview" ? "flex" : "none";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function changeMonth(delta) {
  const date = new Date(`${selectedMonth}-15T12:00:00`);
  date.setMonth(date.getMonth() + delta);
  selectedMonth = monthKey(date);
  render();
}

initChoices();
render();

$("#addButton").addEventListener("click", () => openSheet());
$("#closeSheet").addEventListener("click", closeSheet);
$("#expenseSheet").addEventListener("click", (event) => { if (event.target === event.currentTarget) closeSheet(); });
$("#categoryChoices").addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (button) { selectedCategory = button.dataset.category; updateChoices(); }
});
$("#labelChoices").addEventListener("click", (event) => {
  const button = event.target.closest("[data-label]");
  if (!button) return;
  selectedLabels = selectedLabels.includes(button.dataset.label) ? selectedLabels.filter((label) => label !== button.dataset.label) : [...selectedLabels, button.dataset.label];
  updateChoices();
});
$("#reimbursementChoices").addEventListener("click", (event) => {
  const button = event.target.closest("[data-reimbursement]");
  if (!button) return;
  selectedReimbursementPercent = button.dataset.reimbursement === "custom" ? Math.min(100, Math.max(1, Number($("#customReimbursementInput").value) || 25)) : Number(button.dataset.reimbursement);
  updateChoices();
});
$("#customReimbursementInput").addEventListener("input", (event) => {
  selectedReimbursementPercent = Math.min(100, Math.max(1, Number(event.target.value) || 1));
  updateChoices();
});
$("#amountInput").addEventListener("input", (event) => {
  event.target.value = event.target.value.replace(",", ".").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
  updateReimbursementPreview();
});
$("#expenseForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const amount = Number.parseFloat($("#amountInput").value);
  if (!amount || amount <= 0) { showToast("Enter an amount first"); return; }
  const id = $("#expenseId").value;
  const entry = {
    id: id || crypto.randomUUID(), amount, category: selectedCategory, labels: selectedLabels, reimbursementPercent: selectedReimbursementPercent,
    date: $("#dateInput").value, note: $("#noteInput").value.trim(), createdAt: id ? expenses.find((item) => item.id === id)?.createdAt : Date.now()
  };
  expenses = id ? expenses.map((item) => item.id === id ? entry : item) : [...expenses, entry];
  selectedMonth = entry.date.slice(0, 7);
  persist(); closeSheet(); render(); switchView("overview"); showToast(id ? "Expense updated" : "Expense saved");
});
$("#deleteButton").addEventListener("click", () => {
  const id = $("#expenseId").value;
  expenses = expenses.filter((item) => item.id !== id);
  persist(); closeSheet(); render(); showToast("Expense deleted");
});
document.addEventListener("click", (event) => {
  const expenseButton = event.target.closest("[data-expense-id]");
  if (expenseButton) openSheet(expenses.find((item) => item.id === expenseButton.dataset.expenseId));
  const breakdownButton = event.target.closest("[data-breakdown-category]");
  if (breakdownButton) {
    const category = breakdownButton.dataset.breakdownCategory;
    expandedBreakdownCategories = new Set(expandedBreakdownCategories);
    expandedBreakdownCategories.has(category) ? expandedBreakdownCategories.delete(category) : expandedBreakdownCategories.add(category);
    render();
    return;
  }
  const viewButton = event.target.closest("[data-view], [data-view-target]");
  if (viewButton) switchView(viewButton.dataset.view || viewButton.dataset.viewTarget);
});
$("#previousMonth").addEventListener("click", () => changeMonth(-1));
$("#nextMonth").addEventListener("click", () => changeMonth(1));
$("#monthLabel").addEventListener("click", () => $("#monthInput").showPicker?.());
$("#monthInput").addEventListener("change", (event) => { if (event.target.value) { selectedMonth = event.target.value; render(); } });
$("#searchInput").addEventListener("input", renderHistory);
$("#exportButton").addEventListener("click", (event) => {
  event.stopPropagation();
  toggleExportMenu();
});
$("#exportMenu").addEventListener("click", (event) => {
  event.stopPropagation();
  const button = event.target.closest("[data-export-format]");
  if (!button) return;
  toggleExportMenu(false);
  exportExpenses(button.dataset.exportFormat);
});
document.addEventListener("click", () => toggleExportMenu(false));
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("#expenseSheet").hidden) closeSheet(); });

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
