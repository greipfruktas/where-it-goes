import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const index = fs.readFileSync(new URL("index.html", root), "utf8");
const privacy = fs.readFileSync(new URL("privacy.html", root), "utf8");
const serviceWorker = fs.readFileSync(new URL("sw.js", root), "utf8");
const styles = fs.readFileSync(new URL("styles.css", root), "utf8");

assert.match(index, /href="privacy\.html"[^>]*>Privacy</, "the app should link to its privacy policy");
assert.match(privacy, /<title>Privacy · Where It Goes<\/title>/, "the privacy page should identify the app");
assert.match(privacy, /guest expenses[^<]*device/i, "the policy should explain local guest storage");
assert.match(privacy, /Personal expenses[^<]*privately synchronized[^<]*Supabase/i, "the policy should explain private cloud sync");
assert.match(privacy, /Group members cannot see your Personal data/i, "the policy should distinguish private and group data");
assert.match(privacy, /cached copy[^<]*after sign-out/i, "the policy should disclose retained local caches");
assert.match(privacy, /Shared group[^<]*Supabase/i, "the policy should explain shared-group cloud storage");
assert.match(privacy, /Google[^<]*sign[ -]in/i, "the policy should explain Google account data use");
assert.match(privacy, /delete/i, "the policy should explain deletion options");
assert.match(privacy, /statement file[^<]*stays on[^<]*device/i, "the policy should disclose local statement parsing");
assert.match(privacy, /saved expenses[^<]*category rules[^<]*sync/i, "the policy should distinguish the saved data that syncs");
assert.match(serviceWorker, /\.\/privacy\.html/, "the privacy page should be available offline");
assert.match(privacy, /where-it-goes-style-v1/, "Privacy should load the style selected in the app");
assert.match(privacy, /document\.body\.dataset\.style/, "Privacy should apply the selected style to its body");
assert.match(styles, /body\[data-style="neon"\] \.privacy-card\s*\{[^}]*background:/s, "Privacy should have a dark card in Style B");
