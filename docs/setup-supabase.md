# Shared Groups service setup

The Personal tracker remains local and does not depend on this setup. Shared Groups uses Supabase for Google authentication, PostgreSQL storage and Realtime updates.

## 1. Create and configure Supabase

1. Create a Supabase project and note its project URL.
2. Open SQL Editor and run the files in `supabase/migrations/` in numeric order. For a new project, run `001_shared_groups.sql` and then `002_archive_guards.sql`. For an existing project that already has `001`, run only `002`.
3. In Database → Publications → `supabase_realtime`, enable all seven tables: `profiles`, `groups`, `group_members`, `group_invites`, `group_expenses`, `expense_participants`, and `group_repayments`.
4. In Authentication → URL Configuration, set the Site URL to the live GitHub Pages app.
5. Add both the live GitHub Pages URL and `http://localhost:4173/` to Redirect URLs.
6. In Project Settings → API, copy the project URL and the key explicitly labelled **Publishable** or **Anonymous** into `supabase/config.js`.

Never copy a service-role key, Google client secret, database password or other secret into browser code or Git.

## 2. Create the Google OAuth client

1. Create a Google Cloud project and open Google Auth Platform.
2. Configure an External audience, app name, support email and developer contact.
3. Add the live app URL as the homepage and the deployed `privacy.html` URL as the privacy policy.
4. Add `greipfruktas.github.io` and the Supabase project hostname as authorised domains.
5. Create a Web application OAuth client.
6. Copy the exact callback URL shown in Supabase’s Google provider panel into Google’s **Authorised redirect URIs**. It has the form `https://PROJECT.supabase.co/auth/v1/callback`.
7. Copy the generated client ID and client secret into Supabase Authentication → Providers → Google, enable the provider and save.
8. Publish the OAuth app when it is ready for accounts beyond named test users.

The Google client secret belongs only in Supabase’s private provider settings.

## 3. Verify the integration

- Sign in with Google and create a group.
- Open its invitation link in a second Google account and accept it.
- Add an expense in one session and confirm it appears in the other.
- Record a repayment and confirm both balances update.
- Confirm an outsider cannot read the group and a removed member loses access.
- Archive the group and confirm expense, repayment and invitation actions become read-only.
- Reopen it, then rotate the invitation before sharing again; reopening does not reactivate an old link.

## 4. Local testing

Run `python3 -m http.server 4173` from the app directory and open `http://localhost:4173/`. Google sign-in must use an allowlisted URL; do not use a `file://` page for OAuth.

## 5. Rollback

To disable Shared Groups without affecting Personal data:

1. Disable the Google provider in Supabase Authentication.
2. Remove or hide the Groups mode switch and Groups module script from `index.html`.
3. Increment the service-worker cache name and remove the Groups modules from its asset list.
4. Deploy the static site.

Do not clear browser storage during rollback. Personal expenses remain in the device’s existing `localStorage` and continue to work offline. Existing shared records can remain protected by row-level security while the UI is disabled.
