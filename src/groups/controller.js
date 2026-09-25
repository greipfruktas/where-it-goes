import { renderGroupShell } from "./view.js";
import { allocateEqualShares, parseMinorUnits, validateExpenseDraft } from "./domain.js";

function userFromSession(session) {
  return session?.user || session?.session?.user || null;
}

function joinedGroupId(joined) {
  return joined?.group_id || joined?.groupId || joined?.id;
}

export function createGroupsController({ repository, auth, root, navigatorState = globalThis.navigator, locationState = globalThis.location, historyState = globalThis.history, documentState = globalThis.document, confirmState = globalThis.confirm, personalRoot = null, modeRoot = null, uuid = () => globalThis.crypto.randomUUID(), today = () => new Date().toLocaleDateString("en-CA") }) {
  let submitting = false;
  let expenseSubmission = null;
  let currentGroup = null;
  let currentUser = null;
  let expenseDraft = null;
  let expenseStatus = "";
  let subscription = null;
  let refreshTimer = null;
  let realtimeHealthy = false;

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
    render({ state: "detail", group: currentGroup, currentUserId: currentUser?.id, today: today(), expenseDraft, expenseStatus });
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
    if (expenseSubmission) return expenseSubmission;
    if (!expenseDraft) throw new Error("Open an expense before submitting");
    expenseSubmission = (async () => {
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
      } finally { expenseSubmission = null; }
    })();
    return expenseSubmission;
  }

  async function editExpense(expenseId) {
    const expense = currentGroup?.group_expenses?.find((item) => item.id === expenseId);
    if (!expense) throw new Error("Expense not found");
    const allowed = expense.created_by === currentUser?.id || currentGroup.owner_id === currentUser?.id;
    if (!allowed) throw new Error("You cannot edit this expense");
    const participants = expense.expense_participants || [];
    return openExpense({ groupId: currentGroup.id, expenseId, idempotencyKey: expense.idempotency_key || uuid(), amount: (expense.amount_minor / 100).toFixed(2), description: expense.description, category: expense.category, expenseDate: expense.expense_date, payerId: expense.payer_id, participantIds: participants.map((item) => item.member_id) });
  }

  async function deleteExpense() {
    if (!expenseDraft?.expenseId) return;
    if (typeof confirmState === "function" && !confirmState("Delete this shared expense? The history record will be retained.")) return;
    await repository.deleteExpense(expenseDraft.expenseId);
    expenseDraft = null;
    return openGroup(currentGroup.id);
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
    return loadGroups();
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
    return showGroups();
  }

  root.addEventListener?.("click", async (event) => {
    const target = event.target.closest?.("button, [data-group-id]");
    if (!target) return;
    if (target.matches("[data-google-signin]")) return auth.signIn?.(`${locationState?.pathname || "/"}${locationState?.search || ""}`);
    if (target.matches("[data-sign-out]")) { await auth.signOut?.(); return loadGroups(); }
    if (target.matches("[data-show-personal]")) return showPersonal();
    if (target.matches("[data-groups-back], [data-groups-retry]")) return loadGroups();
    if (target.matches("[data-group-id]")) return openGroup(target.dataset.groupId);
    if (target.matches("[data-expense-open]")) return openExpense();
    if (target.matches("[data-expense-close]")) { expenseDraft = null; expenseStatus = ""; return renderDetail(); }
    if (target.matches("[data-expense-edit]")) return editExpense(target.dataset.expenseEdit);
    if (target.matches("[data-expense-delete]")) return deleteExpense();
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

  modeRoot?.addEventListener?.("click", (event) => {
    const button = event.target.closest?.("[data-app-mode]");
    if (!button) return;
    button.dataset.appMode === "groups" ? showGroups() : showPersonal();
  });

  documentState?.addEventListener?.("visibilitychange", () => {
    if (documentState.visibilityState === "visible" && currentGroup?.id && !realtimeHealthy) openGroup(currentGroup.id);
  });

  return { start, showGroups, showPersonal, openGroup, acceptInvite, openExpense, submitExpense, editExpense, deleteExpense, getExpenseDraft: () => expenseDraft };
}

async function bootstrap() {
  const root = document.querySelector("#groupsRoot");
  if (!root) return;
  const [{ SUPABASE_CONFIG }, supabaseModule, repositoryModule] = await Promise.all([
    import("../../supabase/config.js"), import("./supabase.js"), import("./repository.js")
  ]);
  const client = supabaseModule.createGroupsClient(SUPABASE_CONFIG);
  const repository = repositoryModule.createGroupsRepository(client);
  const auth = {
    consumeAuthReturn: supabaseModule.consumeAuthReturn,
    signIn: supabaseModule.signInWithGoogle,
    getSession: async () => (await client.auth.getSession()).data?.session,
    signOut: async () => client.auth.signOut()
  };
  const controller = createGroupsController({ repository, auth, root, personalRoot: document.querySelector("#personalRoot"), modeRoot: document.querySelector("#appModeSwitch") });
  globalThis.whereItGoesGroups = controller;
  const params = new URLSearchParams(location.search);
  if (params.has("invite") || (await client.auth.getSession()).data?.session) await controller.start();
}

if (typeof document !== "undefined") bootstrap().catch((error) => {
  const root = document.querySelector("#groupsRoot");
  if (root) root.innerHTML = renderGroupShell({ state: "invite-error", message: error.message });
});
