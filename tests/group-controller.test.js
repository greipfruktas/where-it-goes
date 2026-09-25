import assert from "node:assert/strict";
import { createGroupsController } from "../src/groups/controller.js";

function rootStub() {
  return { hidden: true, innerHTML: "", dataset: {}, addEventListener() {} };
}

{
  const calls = [];
  const root = rootStub();
  const controller = createGroupsController({
    root,
    navigatorState: { onLine: true },
    locationState: { search: "", pathname: "/where-it-goes/" },
    historyState: { replaceState() {} },
    auth: {
      consumeAuthReturn: async () => "?invite=abc",
      getSession: async () => ({ user: { id: "u1" } })
    },
    repository: {
      joinGroup: async (token) => { calls.push(["join", token]); return { group_id: "g1" }; },
      getGroup: async (id) => { calls.push(["get", id]); return { id, name: "Trip", group_members: [] }; },
      listGroups: async () => []
    }
  });
  await controller.start();
  assert.deepEqual(calls.slice(0, 2), [["join", "abc"], ["get", "g1"]]);
  assert.match(root.innerHTML, /Trip/);
}

{
  const root = rootStub();
  let writes = 0;
  const controller = createGroupsController({
    root,
    navigatorState: { onLine: false },
    auth: { consumeAuthReturn: async () => null, getSession: async () => ({ user: { id: "u1" } }) },
    repository: { listGroups: async () => { writes += 1; return []; } }
  });
  await controller.showGroups();
  assert.match(root.innerHTML, /internet connection/i);
  assert.equal(writes, 0);
}

{
  const root = rootStub();
  const before = globalThis.localStorage;
  const controller = createGroupsController({ root, navigatorState: { onLine: true }, auth: {}, repository: {} });
  controller.showPersonal();
  assert.equal(root.hidden, true);
  assert.equal(globalThis.localStorage, before);
}
