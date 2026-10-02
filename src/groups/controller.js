import { renderGroupShell } from "./view.js";
import { allocateEqualShares, calculateNetBalances, parseMinorUnits, simplifyTransfers, validateExpenseDraft, validateRepaymentDraft } from "./domain.js";

function userFromSession(session) {
  return session?.user || session?.session?.user || null;
}

function joinedGroupId(joined) {
  return joined?.group_id || joined?.groupId || joined?.id;
}

export function createGroupsController({ repository, auth, root, navigatorState = globalThis.navigator, networkState = globalThis, locationState = globalThis.location, historyState = globalThis.history, documentState = globalThis.document, confirmState = globalThis.confirm, personalRoot = null, modeRoot = null, uuid = () => globalThis.crypto.randomUUID(), today = () => new Date().toLocaleDateString("en-CA") }) {
  let submitting = false;
  let expenseSubmission = null;
  let currentGroup = null;
  let currentUser = null;
  let expenseDraft = null;
  let expenseStatus = "";
  let repaymentDraft = null;
  let repaymentStatus = "";
  let repaymentSubmission = null;
  let subscription = null;
  let refreshTimer = null;
  let realtimeHealthy = false;
  let currentInviteLink = "";

  const render = (model) => { root.innerHTML = renderGroupShell(model); };
  const setMode = (mode) => {
    root.hidden = mode !== "groups";
    if (personalRoot) personalRoot.hidden = mode === "groups";
    modeRoot?.querySelectorAll?.("[data-app-mode]").forEach((button) => button.classList.toggle("selected", button.dataset.appMode === mode));
  };

  async function session() {
    currentUser = userFromSession(await auth.getSession?.());
    return currentUser;
  }

  async function openGroup(groupId) {
    render({ state: "loading" });
    const group = await repository.getGroup(groupId);
    currentGroup = group;
    await session();
    renderDetail();
    subscribe(groupId);
    return group;
  }

  function renderDetail() {
    render({ state: "detail", offline: navigatorState?.onLine === false, group: currentGroup, currentUserId: currentUser?.id, today: today(), expenseDraft, expenseStatus, repaymentDraft, repaymentStatus, netBalances: groupNetBalances(), inviteLink: currentInviteLink });
  }

  function groupNetBalances() {
    const expenses = (currentGroup?.group_expenses || []).filter((expense) => !expense.deleted_at).map((expense) => ({ payerId: expense.payer_id, amountMinor: expense.amount_minor, shares: (expense.expense_participants || []).map((share) => ({ memberId: share.member_id, shareMinor: share.share_minor })) }));
    const repayments = (currentGroup?.group_repayments || []).filter((repayment) => !repayment.deleted_at).map((repayment) => ({ payerId: repayment.payer_id, recipientId: repayment.recipient_id, amountMinor: repayment.amount_minor }));
    return calculateNetBalances(expenses, repayments);
  }

  function subscribe(groupId) {
    subscription?.unsubscribe?.();
    if (!repository.subscribeToGroup) return;
    const refresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => openGroup(groupId), 120);
    };
    subscription = repository.subscribeToGroup(groupId, refresh, (status) => { realtimeHealthy = status === "SUBSCRIBED"; });
  }

  function openExpense(initial = {}) {
    if (navigatorState?.onLine === false) throw new Error("Shared groups are offline and read-only");
    if (currentGroup?.status === "archived") throw new Error("This group is archived and read-only");
    const activeIds = (currentGroup?.group_members || []).filter((member) => member.status === "active").map((member) => member.user_id);
    expenseDraft = {
      groupId: initial.groupId || currentGroup?.id,
      idempotencyKey: initial.idempotencyKey || uuid(),
      amount: initial.amount || "",
      description: initial.description || "",
      category: initial.category || "Food",
      expenseDate: initial.expenseDate || today(),
      payerId: initial.payerId || currentUser?.id,
      participantIds: initial.participantIds || activeIds,
      expenseId: initial.expenseId
    };
    expenseStatus = "";
    if (currentGroup) renderDetail();
    return expenseDraft;
  }

  function captureExpenseForm(form) {
    const data = new FormData(form);
    expenseDraft = { ...expenseDraft, amount: String(data.get("amount") || ""), description: String(data.get("description") || "").trim(), category: String(data.get("category") || "Other"), expenseDate: String(data.get("expenseDate") || ""), payerId: String(data.get("payerId") || ""), participantIds: data.getAll("participantIds").map(String) };
  }

  async function submitExpense() {
    assertWritableGroup();
    if (expenseSubmission) return expenseSubmission;
    if (!expenseDraft) throw new Error("Open an expense before submitting");
    let resolveSubmission;
    let rejectSubmission;
    expenseSubmission = new Promise((resolve, reject) => {
      resolveSubmission = resolve;
      rejectSubmission = reject;
    });
    const runSubmission = (async () => {
      try {
        const amountMinor = parseMinorUnits(expenseDraft.amount);
        const activeIds = (currentGroup?.group_members || expenseDraft.participantIds.map((userId) => ({ user_id: userId, status: "active" }))).filter((member) => member.status === "active").map((member) => member.user_id);
        const errors = validateExpenseDraft({ amountMinor, payerId: expenseDraft.payerId, participantIds: expenseDraft.participantIds, description: expenseDraft.description, category: expenseDraft.category, date: expenseDraft.expenseDate }, activeIds);
        if (errors.length) throw new Error(errors[0]);
        const payload = { ...expenseDraft, amountMinor, participantShares: allocateEqualShares(amountMinor, expenseDraft.participantIds), date: expenseDraft.expenseDate, currency: currentGroup?.currency };
        const result = expenseDraft.expenseId && repository.updateExpense ? await repository.updateExpense(payload) : await repository.saveExpense(payload);
        expenseDraft = null;
        expenseStatus = "";
        if (currentGroup?.id && repository.getGroup) await openGroup(currentGroup.id);
        return result;
      } catch (error) {
        expenseStatus = `${error.message}. Your entry is still here—retry when ready.`;
        if (currentGroup) renderDetail();
        throw error;
      }
    })();
    runSubmission.then(resolveSubmission, rejectSubmission).finally(() => { expenseSubmission = null; });
    return expenseSubmission;
  }

  async function editExpense(expenseId) {
    assertWritableGroup();
    const expense = currentGroup?.group_expenses?.find((item) => item.id === expenseId);
    if (!expense) throw new Error("Expense not found");
    const allowed = expense.created_by === currentUser?.id || currentGroup.owner_id === currentUser?.id;
    if (!allowed) throw new Error("You cannot edit this expense");
    const participants = expense.expense_participants || [];
    return openExpense({ groupId: currentGroup.id, expenseId, idempotencyKey: expense.idempotency_key || uuid(), amount: (expense.amount_minor / 100).toFixed(2), description: expense.description, category: expense.category, expenseDate: expense.expense_date, payerId: expense.payer_id, participantIds: participants.map((item) => item.member_id) });
  }

  async function deleteExpense() {
    assertWritableGroup();
    if (!expenseDraft?.expenseId) return;
    if (typeof confirmState === "function" && !confirmState("Delete this shared expense? The history record will be retained.")) return;
    await repository.deleteExpense(expenseDraft.expenseId);
    expenseDraft = null;
    return openGroup(currentGroup.id);
  }

  function openRepayment(initial = {}) {
    assertWritableGroup();
    if (currentGroup?.status === "archived") throw new Error("This group is archived and read-only");
    repaymentDraft = { groupId: initial.groupId || currentGroup?.id, idempotencyKey: initial.idempotencyKey || uuid(), payerId: initial.payerId || "", recipientId: initial.recipientId || "", amount: initial.amount ?? (Number.isSafeInteger(initial.amountMinor) ? (initial.amountMinor / 100).toFixed(2) : ""), date: initial.date || today() };
    repaymentStatus = "";
    if (currentGroup) renderDetail();
    return repaymentDraft;
  }

  function captureRepaymentForm(form) {
    const data = new FormData(form);
    repaymentDraft = { ...repaymentDraft, payerId: String(data.get("payerId") || ""), recipientId: String(data.get("recipientId") || ""), amount: String(data.get("amount") || ""), date: String(data.get("date") || "") };
  }

  async function submitRepayment() {
    assertWritableGroup();
    if (repaymentSubmission) return repaymentSubmission;
    if (!repaymentDraft) throw new Error("Open a repayment before submitting");
    repaymentSubmission = (async () => {
      try {
        const amountMinor = parseMinorUnits(repaymentDraft.amount);
        const activeIds = (currentGroup?.group_members || []).filter((member) => member.status === "active").map((member) => member.user_id);
        const suggested = simplifyTransfers(groupNetBalances());
        const errors = validateRepaymentDraft({ payerId: repaymentDraft.payerId, recipientId: repaymentDraft.recipientId, amountMinor, date: repaymentDraft.date }, activeIds, suggested);
        if (errors.length) throw new Error(errors[0]);
        const result = await repository.saveRepayment({ ...repaymentDraft, amountMinor });
        repaymentDraft = null;
        repaymentStatus = "";
        if (currentGroup?.id) await openGroup(currentGroup.id);
        return result;
      } catch (error) {
        repaymentStatus = `${error.message}. Your repayment is still here—retry when ready.`;
        if (currentGroup) renderDetail();
        throw error;
      } finally { repaymentSubmission = null; }
    })();
    return repaymentSubmission;
  }

  async function removeMember(memberId) {
    assertWritableGroup();
    if (!confirmState?.("Remove this member from the group? They will immediately lose access.")) return null;
    try {
      const result = await repository.removeMember(currentGroup.id, memberId);
      await openGroup(currentGroup.id);
      return result;
    } catch (error) {
      if (/not authorized/i.test(error.message)) await loadGroups();
      throw error;
    }
  }

  async function rotateInvite() {
    assertWritableGroup();
    if (!confirmState?.("Create a new invitation link? Any previous link will stop working.")) return null;
    const invite = await repository.rotateInvite(currentGroup.id);
    currentInviteLink = `${locationState?.origin || globalThis.location?.origin || ""}${locationState?.pathname || "/"}?invite=${encodeURIComponent(invite.token)}`;
    renderDetail();
    return invite;
  }

  async function disableInvite() {
    assertWritableGroup();
    const active = currentGroup?.group_invites?.find((invite) => invite.is_active);
    if (!active || !confirmState?.("Disable the current invitation link?")) return null;
    const result = await repository.disableInvite(active.id);
    currentInviteLink = "";
    await openGroup(currentGroup.id);
    return result;
  }

  async function archiveGroup() {
    assertWritableGroup();
    if (!confirmState?.("Archive this group? Expenses, repayments and invitations will become read-only.")) return null;
    const result = await repository.archiveGroup(currentGroup.id);
    currentInviteLink = "";
    currentGroup = result || { ...currentGroup, status: "archived" };
    renderDetail();
    return result;
  }

  async function reopenGroup() {
    if (navigatorState?.onLine === false) throw new Error("Shared groups are offline and read-only");
    if (!confirmState?.("Reopen this group? You will need to create a new invitation link.")) return null;
    const result = await repository.reopenGroup(currentGroup.id);
    currentInviteLink = "";
    currentGroup = result || { ...currentGroup, status: "active" };
    renderDetail();
    return result;
  }

  async function transferOwnership(newOwnerId) {
    assertWritableGroup();
    if (!newOwnerId) throw new Error("Choose a new owner first");
    if (!confirmState?.("Transfer ownership to this member?")) return null;
    const result = await repository.transferOwnership(currentGroup.id, newOwnerId);
    await openGroup(currentGroup.id);
    return result;
  }

  async function shareInvite() {
    if (!currentInviteLink) return;
    if (navigatorState?.share) return navigatorState.share({ title: currentGroup?.name || "Shared expense group", text: `Join ${currentGroup?.name || "my group"} on Where It Goes`, url: currentInviteLink });
    if (navigatorState?.clipboard?.writeText) return navigatorState.clipboard.writeText(currentInviteLink);
    throw new Error("Copy is unavailable on this device");
  }

  function assertWritableGroup() {
    if (navigatorState?.onLine === false) throw new Error("Shared groups are offline and read-only");
    if (currentGroup?.status === "archived") throw new Error("This group is archived and read-only");
  }

  async function loadGroups() {
    const user = await session();
    if (!user) return render({ state: "signed-out" });
    render({ state: "loading" });
    const groups = await repository.listGroups();
    render({ state: "list", groups, userInitial: (user.user_metadata?.full_name || user.email || "G").slice(0, 1).toUpperCase() });
  }

  function inviteFrom(value) {
    if (!value) return new URLSearchParams(locationState?.search || "").get("invite");
    return new URLSearchParams(value.startsWith("?") ? value : `?${value}`).get("invite");
  }

  function clearInvite() {
    if (!locationState || !historyState?.replaceState) return;
    const params = new URLSearchParams(locationState.search || "");
    if (!params.has("invite")) return;
    params.delete("invite");
    historyState.replaceState({}, "", `${locationState.pathname || "/"}${params.size ? `?${params}` : ""}`);
  }

  async function acceptInvite(token) {
    try {
      const joined = await repository.joinGroup(token);
      clearInvite();
      return await openGroup(joinedGroupId(joined));
    } catch (error) {
      clearInvite();
      render({ state: "invite-error", message: error.message });
      return null;
    }
  }

  async function showGroups() {
    setMode("groups");
    if (!navigatorState?.onLine) return render({ state: "offline" });
    try {
      return await loadGroups();
    } catch (error) {
      render({ state: "groups-error", message: error.message });
      return null;
    }
  }

  function showPersonal() {
    setMode("personal");
  }

  async function start() {
    const restored = await auth.consumeAuthReturn?.();
    const token = inviteFrom(restored) || inviteFrom();
    if (token && await session()) {
      setMode("groups");
      return acceptInvite(token);
    }
    const restoredParams = new URLSearchParams(String(restored || "").replace(/^.*\?/, ""));
    const currentParams = new URLSearchParams(locationState?.search || "");
    if ((restoredParams.get("destination") || currentParams.get("destination")) === "groups") return showGroups();
    return showPersonal();
  }

  root.addEventListener?.("click", async (event) => {
    const target = event.target.closest?.("button, [data-group-id]");
    if (!target) return;
    if (target.matches("[data-google-signin]")) {
      const params = new URLSearchParams(locationState?.search || "");
      params.set("destination", "groups");
      return auth.signIn?.(`${locationState?.pathname || "/"}?${params}`);
    }
    if (target.matches("[data-sign-out]")) { await auth.signOut?.(); return loadGroups(); }
    if (target.matches("[data-show-personal]")) return showPersonal();
    if (target.matches("[data-groups-back], [data-groups-retry]")) return loadGroups();
    if (target.matches("[data-group-id]")) return openGroup(target.dataset.groupId);
    if (target.matches("[data-expense-open]")) return openExpense();
    if (target.matches("[data-expense-close]")) { expenseDraft = null; expenseStatus = ""; return renderDetail(); }
    if (target.matches("[data-expense-edit]")) return editExpense(target.dataset.expenseEdit);
    if (target.matches("[data-expense-delete]")) return deleteExpense();
    if (target.matches("[data-repayment-payer]")) return openRepayment({ payerId: target.dataset.repaymentPayer, recipientId: target.dataset.repaymentRecipient, amountMinor: Number(target.dataset.repaymentAmount) });
    if (target.matches("[data-repayment-close]")) { repaymentDraft = null; repaymentStatus = ""; return renderDetail(); }
    if (target.matches("[data-member-remove]")) return removeMember(target.dataset.memberRemove);
    if (target.matches("[data-invite-rotate]")) return rotateInvite();
    if (target.matches("[data-invite-disable]")) return disableInvite();
    if (target.matches("[data-invite-share]")) return shareInvite();
    if (target.matches("[data-group-archive]")) return archiveGroup();
    if (target.matches("[data-group-reopen]")) return reopenGroup();
    if (target.matches("[data-group-create-open]")) { const form = root.querySelector("[data-group-create]"); if (form) form.hidden = false; }
    if (target.matches("[data-close-create]")) { const form = root.querySelector("[data-group-create]"); if (form) form.hidden = true; }
  });

  root.addEventListener?.("submit", async (event) => {
    if (event.target.matches?.("[data-expense-form]")) {
      event.preventDefault();
      captureExpenseForm(event.target);
      try { await submitExpense(); } catch { /* Status is rendered with the preserved form. */ }
      return;
    }
    if (event.target.matches?.("[data-repayment-form]")) {
      event.preventDefault();
      captureRepaymentForm(event.target);
      try { await submitRepayment(); } catch { /* Status is rendered with the preserved form. */ }
      return;
    }
    if (event.target.matches?.("[data-owner-transfer]")) {
      event.preventDefault();
      return transferOwnership(new FormData(event.target).get("newOwnerId"));
    }
    if (!event.target.matches?.("[data-group-create]") || submitting) return;
    event.preventDefault();
    submitting = true;
    const button = event.target.querySelector("[type=submit]");
    if (button) button.disabled = true;
    try {
      const data = new FormData(event.target);
      const group = await repository.createGroup({ name: String(data.get("name") || "").trim(), icon: String(data.get("icon") || "👥").trim(), currency: String(data.get("currency") || "EUR").trim().toUpperCase(), startsOn: data.get("startsOn") || null, endsOn: data.get("endsOn") || null });
      await openGroup(group.id);
    } catch (error) {
      render({ state: "invite-error", message: error.message });
    } finally { submitting = false; }
  });

  root.addEventListener?.("change", (event) => {
    const form = event.target.closest?.("[data-expense-form]");
    if (!form) return;
    captureExpenseForm(form);
    if (event.target.matches?.('[name="expenseDate"]')) {
      const label = form.querySelector?.("[data-expense-date-value]");
      if (label && event.target.value) label.textContent = new Date(`${event.target.value}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    }
    if (!expenseStatus) return;
    expenseStatus = "";
    form.querySelector?.(".expense-form-status")?.remove();
    const button = form.querySelector?.("[type=submit]");
    if (button) button.textContent = "Save expense";
  });

  modeRoot?.addEventListener?.("click", (event) => {
    const button = event.target.closest?.("[data-app-mode]");
    if (!button) return;
    button.dataset.appMode === "groups" ? showGroups() : showPersonal();
  });

  documentState?.addEventListener?.("visibilitychange", () => {
    if (documentState.visibilityState === "visible" && currentGroup?.id && !realtimeHealthy) openGroup(currentGroup.id);
  });

  networkState?.addEventListener?.("offline", () => {
    if (currentGroup?.id) renderDetail();
    else if (!root.hidden) render({ state: "offline" });
  });
  networkState?.addEventListener?.("online", () => currentGroup?.id ? openGroup(currentGroup.id) : (!root.hidden && loadGroups()));

  return { start, showGroups, showPersonal, openGroup, acceptInvite, openExpense, submitExpense, editExpense, deleteExpense, openRepayment, submitRepayment, removeMember, rotateInvite, disableInvite, archiveGroup, reopenGroup, transferOwnership, shareInvite, getExpenseDraft: () => expenseDraft, getRepaymentDraft: () => repaymentDraft };
}

async function bootstrap() {
  const root = document.querySelector("#groupsRoot");
  if (!root) return;
  const [{ supabaseConfig }, supabaseModule, repositoryModule, personalRepositoryModule, personalControllerModule, personalStorageModule] = await Promise.all([
    import("../../supabase/config.js"), import("./supabase.js"), import("./repository.js"),
    import("../personal-sync/repository.js"), import("../personal-sync/controller.js"), import("../personal-sync/storage.js")
  ]);
  const client = supabaseModule.createGroupsClient(supabaseConfig);
  const repository = repositoryModule.createGroupsRepository(client);
  const auth = {
    consumeAuthReturn: supabaseModule.consumeAuthReturn,
    signIn: supabaseModule.signInWithGoogle,
    getSession: async () => (await client.auth.getSession()).data?.session,
    signOut: async () => client.auth.signOut()
  };
  const controller = createGroupsController({ repository, auth, root, personalRoot: document.querySelector("#personalRoot"), modeRoot: document.querySelector("#appModeSwitch") });
  globalThis.whereItGoesGroups = controller;
  const personalSync = personalControllerModule.createPersonalSyncController({
    repository: personalRepositoryModule.createPersonalRepository(client),
    storage: personalStorageModule.createPersonalStorage(localStorage),
    personalData: globalThis.whereItGoesPersonalData
  });
  globalThis.whereItGoesPersonalSync = personalSync;
  const accountButton = document.querySelector("#personalAccountButton");
  const applySession = async (session) => {
    const user = session?.user;
    accountButton.classList.toggle("signed-in", Boolean(user));
    accountButton.textContent = user ? (user.user_metadata?.full_name || user.email || "A").slice(0, 1).toUpperCase() : "Sign in";
    accountButton.setAttribute("aria-label", user ? "Sign out" : "Sign in with Google");
    if (user) await personalSync.startSession(user);
    else personalSync.stopSession();
  };
  accountButton?.addEventListener("click", async () => {
    const session = (await client.auth.getSession()).data?.session;
    if (session) {
      personalSync.stopSession();
      await client.auth.signOut();
      await applySession(null);
    } else {
      await supabaseModule.signInWithGoogle(`${location.pathname}?destination=personal`);
    }
  });
  client.auth.onAuthStateChange((_event, session) => setTimeout(() => applySession(session).catch((error) => globalThis.whereItGoesPersonalData?.showStorageError(error.message)), 0));
  await applySession((await client.auth.getSession()).data?.session);
  const params = new URLSearchParams(location.search);
  if (params.has("invite") || (await client.auth.getSession()).data?.session) await controller.start();
}

if (typeof document !== "undefined") bootstrap().catch((error) => {
  const root = document.querySelector("#groupsRoot");
  if (root) root.innerHTML = renderGroupShell({ state: "invite-error", message: error.message });
});
