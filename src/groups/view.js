import { simplifyTransfers } from "./domain.js";

export function escapeGroupHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDates(group) {
  if (!group.starts_on && !group.ends_on) return "Open dates";
  const start = group.starts_on ? new Date(`${group.starts_on}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Any time";
  const end = group.ends_on ? new Date(`${group.ends_on}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Onward";
  return `${start} – ${end}`;
}

export function renderGroupsList(groups = []) {
  if (!groups.length) {
    return `<div class="groups-empty"><span aria-hidden="true">🧳</span><h2>No shared groups yet</h2><p>Create a trip or weekend group, then invite everyone with one link.</p></div>`;
  }
  return `<div class="shared-group-list">${groups.map((group) => `
    <button class="shared-group-card" type="button" data-group-id="${escapeGroupHTML(group.id)}">
      <span class="shared-group-icon" aria-hidden="true">${escapeGroupHTML(group.icon || "👥")}</span>
      <span class="shared-group-copy"><strong>${escapeGroupHTML(group.name)}</strong><small>${escapeGroupHTML(formatDates(group))}</small></span>
      <span class="shared-group-currency">${escapeGroupHTML(group.currency || "EUR")}</span>
      <span class="shared-group-arrow" aria-hidden="true">→</span>
    </button>`).join("")}</div>`;
}

function memberName(member) {
  return member?.profiles?.display_name || member?.profile?.display_name || member?.display_name || member?.user_id || "Member";
}

function money(amountMinor, currency = "EUR") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format((amountMinor || 0) / 100);
}

export function renderSettlementSuggestions(netBalances = {}, members = [], currency = "EUR", readOnly = false) {
  const byId = new Map(members.map((member) => [member.user_id, memberName(member)]));
  const transfers = simplifyTransfers(netBalances);
  if (!transfers.length) return `<div class="all-settled"><span>✓</span><div><strong>All settled</strong><small>Nobody owes anything right now.</small></div></div>`;
  return `<div class="settlement-list">${transfers.map((transfer) => `<button type="button" class="settlement-row" ${readOnly ? "disabled" : `data-repayment-payer="${escapeGroupHTML(transfer.payerId)}" data-repayment-recipient="${escapeGroupHTML(transfer.recipientId)}" data-repayment-amount="${transfer.amountMinor}"`}><span>${escapeGroupHTML(byId.get(transfer.payerId) || transfer.payerId)} owes ${escapeGroupHTML(byId.get(transfer.recipientId) || transfer.recipientId)} ${escapeGroupHTML(money(transfer.amountMinor, currency))}</span><small>${readOnly ? "Archived" : "Record repayment →"}</small></button>`).join("")}</div>`;
}

export function renderRepaymentForm({ draft = {}, members = [], status = "" } = {}) {
  const active = members.filter((member) => member.status === "active");
  const options = (selected) => active.map((member) => `<option value="${escapeGroupHTML(member.user_id)}"${member.user_id === selected ? " selected" : ""}>${escapeGroupHTML(memberName(member))}</option>`).join("");
  return `<form class="group-repayment-form" data-repayment-form><div class="expense-form-head"><div><p class="eyebrow">REPAYMENT</p><h2>Mark money returned</h2></div><button class="close-button" type="button" data-repayment-close aria-label="Close">×</button></div><div class="repayment-people"><label><span>From</span><select name="payerId">${options(draft.payerId)}</select></label><span aria-hidden="true">→</span><label><span>To</span><select name="recipientId">${options(draft.recipientId)}</select></label></div><div class="group-date-row"><label><span>Amount</span><input name="amount" inputmode="decimal" value="${escapeGroupHTML(draft.amount || "")}" required></label><label><span>Date</span><input type="date" name="date" value="${escapeGroupHTML(draft.date || "")}" required></label></div>${status ? `<p class="expense-form-status" role="status">${escapeGroupHTML(status)}</p>` : ""}<button class="save-button" type="submit">${status ? "Retry repayment" : "Save repayment"}</button></form>`;
}

export function renderActivity(expenses = [], { currentUserId, ownerId, currency = "EUR" } = {}) {
  const active = expenses.filter((expense) => !expense.deleted_at).sort((a, b) => String(b.expense_date || "").localeCompare(String(a.expense_date || "")));
  if (!active.length) return `<div class="group-empty-activity"><span>🧾</span><strong>No shared expenses yet</strong><p>Add the first one when somebody pays.</p></div>`;
  return `<div class="group-activity-list">${active.map((expense) => {
    const canManage = expense.created_by === currentUserId || ownerId === currentUserId;
    return `<article class="group-activity-item">
      <span class="activity-category-icon" aria-hidden="true">${escapeGroupHTML(expense.category?.slice(0, 1) || "•")}</span>
      <div><strong>${escapeGroupHTML(expense.description || expense.category || "Expense")}</strong><small>${escapeGroupHTML(expense.category || "Other")} · ${escapeGroupHTML(expense.expense_date || "")}</small></div>
      <b>${escapeGroupHTML(money(expense.amount_minor, currency))}</b>
      ${canManage ? `<button type="button" data-expense-edit="${escapeGroupHTML(expense.id)}" aria-label="Edit ${escapeGroupHTML(expense.description || "expense")}">•••</button>` : ""}
    </article>`;
  }).join("")}</div>`;
}

export function renderExpenseForm({ members = [], currentUserId, today, draft = {}, status = "" } = {}) {
  const active = members.filter((member) => member.status === "active");
  const participants = new Set(draft.participantIds || active.map((member) => member.user_id));
  const payerId = draft.payerId || currentUserId;
  return `<form class="group-expense-form" data-expense-form>
    <div class="expense-form-head"><div><p class="eyebrow">${draft.expenseId ? "EDIT EXPENSE" : "NEW SHARED EXPENSE"}</p><h2>Who paid for what?</h2></div><button class="close-button" type="button" data-expense-close aria-label="Close">×</button></div>
    <label class="shared-amount-field"><span>€</span><input name="amount" inputmode="decimal" value="${escapeGroupHTML(draft.amount || "")}" placeholder="0.00" aria-label="Amount" required></label>
    <label><span>Description</span><input name="description" value="${escapeGroupHTML(draft.description || "")}" maxlength="80" placeholder="Dinner, taxi, tickets…" required></label>
    <div class="group-date-row"><label><span>Category</span><select name="category">${["Food", "Transport", "House", "Tickets", "Other"].map((category) => `<option${draft.category === category ? " selected" : ""}>${category}</option>`).join("")}</select></label><label><span>Date</span><input type="date" name="expenseDate" value="${escapeGroupHTML(draft.expenseDate || today || "")}" required></label></div>
    <label><span>Paid by</span><select name="payerId">${active.map((member) => `<option value="${escapeGroupHTML(member.user_id)}"${member.user_id === payerId ? " selected" : ""}>${escapeGroupHTML(memberName(member))}</option>`).join("")}</select></label>
    <fieldset><legend>Split equally between</legend><div class="participant-grid">${active.map((member) => `<label><input type="checkbox" name="participantIds" value="${escapeGroupHTML(member.user_id)}"${participants.has(member.user_id) ? " checked" : ""}><span>${escapeGroupHTML(memberName(member))}</span></label>`).join("")}</div></fieldset>
    ${status ? `<p class="expense-form-status" role="status">${escapeGroupHTML(status)}</p>` : ""}
    <div class="shared-expense-actions">${draft.expenseId ? `<button class="shared-delete-button" type="button" data-expense-delete>Delete</button>` : ""}<button class="save-button" type="submit">${status ? "Retry expense" : "Save expense"}</button></div>
  </form>`;
}

function createForm() {
  return `<form class="group-create-form" data-group-create hidden>
    <div class="group-form-heading"><div><p class="eyebrow">NEW GROUP</p><h2>Start something together</h2></div><button class="close-button" type="button" data-close-create aria-label="Close">×</button></div>
    <div class="group-name-row"><label><span>Icon</span><input name="icon" value="✈️" maxlength="8" aria-label="Group icon"></label><label><span>Name</span><input name="name" maxlength="50" placeholder="Lisbon weekend" required></label></div>
    <label><span>Currency</span><input name="currency" value="EUR" maxlength="3" pattern="[A-Za-z]{3}" autocapitalize="characters" required></label>
    <div class="group-date-row"><label><span>From <em>optional</em></span><input name="startsOn" type="date"></label><label><span>To <em>optional</em></span><input name="endsOn" type="date"></label></div>
    <button class="save-button" type="submit">Create group</button>
  </form>`;
}

export function renderGroupShell(model = {}) {
  if (model.state === "offline") return `<section class="groups-state-card" aria-live="polite"><span class="groups-state-icon">☁️</span><h1>Groups need an internet connection</h1><p>Your personal expenses still work offline. Reconnect to view or change shared groups.</p><button class="secondary-button" type="button" data-show-personal>Back to Personal</button></section>`;
  if (model.state === "signed-out") return `<section class="groups-state-card groups-signin" aria-live="polite"><span class="groups-state-icon">👥</span><p class="eyebrow">SPEND TOGETHER, SETTLE SIMPLY</p><h1>Trips without the spreadsheet</h1><p>Invite friends, add shared costs and see exactly who should repay whom.</p><button class="google-signin-button" type="button" data-google-signin><span>G</span>Continue with Google</button><small>Personal expenses stay only on this device.</small></section>`;
  if (model.state === "loading") return `<section class="groups-state-card" aria-live="polite"><span class="groups-loader" aria-hidden="true"></span><h1>Loading your groups</h1></section>`;
  if (model.state === "invite-error") return `<section class="groups-state-card" role="alert"><span class="groups-state-icon">🔗</span><h1>That invite did not work</h1><p>${escapeGroupHTML(model.message || "The link may be expired or disabled.")}</p><button class="secondary-button" type="button" data-groups-retry>View my groups</button></section>`;
  if (model.state === "detail") {
    const readOnly = model.group?.status === "archived";
    return `<section class="group-detail-shell" aria-live="polite"><button class="group-back-button" type="button" data-groups-back>← Groups</button><header class="group-hero"><span class="group-hero-icon">${escapeGroupHTML(model.group?.icon || "👥")}</span><div><p class="eyebrow">SHARED GROUP ${readOnly ? "· ARCHIVED" : ""}</p><h1>${escapeGroupHTML(model.group?.name || "Group")}</h1><p>${escapeGroupHTML(model.group?.currency || "EUR")} · ${escapeGroupHTML(formatDates(model.group || {}))}</p></div></header>${model.expenseDraft && !readOnly ? renderExpenseForm({ members: model.group?.group_members || [], currentUserId: model.currentUserId, today: model.today, draft: model.expenseDraft, status: model.expenseStatus }) : ""}${model.repaymentDraft && !readOnly ? renderRepaymentForm({ draft: model.repaymentDraft, members: model.group?.group_members || [], status: model.repaymentStatus }) : ""}<section class="settlement-section"><div class="group-detail-heading"><div><p class="eyebrow">SETTLE UP</p><h2>Who owes whom</h2></div></div>${renderSettlementSuggestions(model.netBalances || {}, model.group?.group_members || [], model.group?.currency, readOnly)}</section><div class="group-detail-heading"><div><p class="eyebrow">WHAT HAPPENED</p><h2>Activity</h2></div>${readOnly ? `<span class="archived-badge">Archived</span>` : `<button class="round-action" type="button" data-expense-open aria-label="Add shared expense">+</button>`}</div>${renderActivity(model.group?.group_expenses || [], { currentUserId: readOnly ? null : model.currentUserId, ownerId: readOnly ? null : model.group?.owner_id, currency: model.group?.currency })}</section>`;
  }
  return `<section class="groups-list-shell" aria-live="polite"><header class="groups-page-header"><div><p class="eyebrow">YOUR SHARED SPACES</p><h1>Groups</h1></div><div class="groups-header-actions"><button class="round-action" type="button" data-group-create-open aria-label="Create group">+</button><button class="avatar-button" type="button" data-sign-out aria-label="Sign out">${escapeGroupHTML(model.userInitial || "•")}</button></div></header>${createForm()}${renderGroupsList(model.groups || [])}<button class="create-group-cta" type="button" data-group-create-open>Create a group <span>＋</span></button></section>`;
}
