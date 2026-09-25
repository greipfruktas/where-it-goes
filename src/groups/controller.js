import { renderGroupShell } from "./view.js";

function userFromSession(session) {
  return session?.user || session?.session?.user || null;
}

function joinedGroupId(joined) {
  return joined?.group_id || joined?.groupId || joined?.id;
}

export function createGroupsController({ repository, auth, root, navigatorState = globalThis.navigator, locationState = globalThis.location, historyState = globalThis.history, personalRoot = null, modeRoot = null }) {
  let submitting = false;

  const render = (model) => { root.innerHTML = renderGroupShell(model); };
  const setMode = (mode) => {
    root.hidden = mode !== "groups";
    if (personalRoot) personalRoot.hidden = mode === "groups";
    modeRoot?.querySelectorAll?.("[data-app-mode]").forEach((button) => button.classList.toggle("selected", button.dataset.appMode === mode));
  };

  async function session() {
    return userFromSession(await auth.getSession?.());
  }

  async function openGroup(groupId) {
    render({ state: "loading" });
    const group = await repository.getGroup(groupId);
    render({ state: "detail", group });
    return group;
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
    if (target.matches("[data-group-create-open]")) { const form = root.querySelector("[data-group-create]"); if (form) form.hidden = false; }
    if (target.matches("[data-close-create]")) { const form = root.querySelector("[data-group-create]"); if (form) form.hidden = true; }
  });

  root.addEventListener?.("submit", async (event) => {
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

  return { start, showGroups, showPersonal, openGroup, acceptInvite };
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
