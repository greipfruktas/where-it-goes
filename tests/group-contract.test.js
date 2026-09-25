import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sw = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const controller = fs.readFileSync(new URL("../src/groups/controller.js", import.meta.url), "utf8");
for (const asset of ["src/groups/domain.js", "src/groups/supabase.js", "src/groups/repository.js", "src/groups/view.js", "src/groups/controller.js", "supabase/config.js"]) {
  assert.match(sw, new RegExp(asset.replaceAll("/", "\\/")));
}
assert.match(html, /id="groupsRoot"/);
assert.match(html, /type="module"/);
assert.match(sw, /event\.request\.url/);
assert.match(sw, /supabase/i);
assert.match(sw, /url\.search|url\.hash/, "OAuth-bearing local responses should bypass the cache");
assert.match(controller, /\{ supabaseConfig \}/, "browser bootstrap should use the config module's real named export");
