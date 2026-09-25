import assert from "node:assert/strict";
import { escapeGroupHTML, renderGroupsList, renderGroupShell } from "../src/groups/view.js";

assert.equal(escapeGroupHTML(`<img onerror="x">`), "&lt;img onerror=&quot;x&quot;&gt;");
const list = renderGroupsList([{ id: "g1", name: "<Trip>", icon: "✈️", currency: "EUR" }]);
assert.match(list, /&lt;Trip&gt;/);
assert.doesNotMatch(list, /<Trip>/);
assert.match(list, /data-group-id="g1"/);

assert.match(renderGroupShell({ state: "signed-out" }), /Continue with Google/);
assert.match(renderGroupShell({ state: "offline" }), /internet connection/i);
assert.match(renderGroupShell({ state: "list", groups: [] }), /Create a group/);
assert.match(renderGroupShell({ state: "invite-error", message: "Invalid invite" }), /Invalid invite/);
