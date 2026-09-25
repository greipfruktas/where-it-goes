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
  if (model.state === "detail") return `<section class="group-detail-shell" aria-live="polite"><button class="group-back-button" type="button" data-groups-back>← Groups</button><header class="group-hero"><span class="group-hero-icon">${escapeGroupHTML(model.group?.icon || "👥")}</span><div><p class="eyebrow">SHARED GROUP</p><h1>${escapeGroupHTML(model.group?.name || "Group")}</h1><p>${escapeGroupHTML(model.group?.currency || "EUR")} · ${escapeGroupHTML(formatDates(model.group || {}))}</p></div></header><div class="group-coming-next"><p>Ready for shared expenses</p><strong>Activity and balances appear here next.</strong></div></section>`;
  return `<section class="groups-list-shell" aria-live="polite"><header class="groups-page-header"><div><p class="eyebrow">YOUR SHARED SPACES</p><h1>Groups</h1></div><div class="groups-header-actions"><button class="round-action" type="button" data-group-create-open aria-label="Create group">+</button><button class="avatar-button" type="button" data-sign-out aria-label="Sign out">${escapeGroupHTML(model.userInitial || "•")}</button></div></header>${createForm()}${renderGroupsList(model.groups || [])}<button class="create-group-cta" type="button" data-group-create-open>Create a group <span>＋</span></button></section>`;
}
