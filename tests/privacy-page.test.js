import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const index = fs.readFileSync(new URL("index.html", root), "utf8");
const privacy = fs.readFileSync(new URL("privacy.html", root), "utf8");
const serviceWorker = fs.readFileSync(new URL("sw.js", root), "utf8");

assert.match(index, /href="privacy\.html"[^>]*>Privacy</, "the app should link to its privacy policy");
assert.match(privacy, /<title>Privacy · Where It Goes<\/title>/, "the privacy page should identify the app");
assert.match(privacy, /Personal expenses[^<]*stored[^<]*device/i, "the policy should explain local personal-expense storage");
assert.match(privacy, /Shared group[^<]*Supabase/i, "the policy should explain shared-group cloud storage");
assert.match(privacy, /Google[^<]*sign[ -]in/i, "the policy should explain Google account data use");
assert.match(privacy, /delete/i, "the policy should explain deletion options");
assert.match(serviceWorker, /\.\/privacy\.html/, "the privacy page should be available offline");
