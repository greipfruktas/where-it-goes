# Personal Cloud Sync Design

## Purpose

Make Personal and Groups feel like two parts of one account-based expense app. A signed-in user must see the same personal expenses, categories, icons, colors, and selected style on their iPhone, laptop, and replacement devices. Existing device-only users must retain their data, offline use, and ability to continue without an account.

The user should not manage synchronization. Google sign-in, either from the welcome screen or Groups, enables private personal synchronization automatically.

This design intentionally supersedes the earlier Shared Groups version-one statements that Personal is always device-only and that personal cloud synchronization is out of scope. All Shared Groups accounting and permission rules remain unchanged.

## Product Experience

On a fresh unsigned device, the app presents a single welcome screen with two actions:

- **Continue with Google** signs in and enables Personal and Groups.
- **Continue without account** opens Personal in device-only guest mode.

After entry, the existing **Personal / Groups** switch remains the primary navigation. Signed-in users can use both areas. Guest users can use Personal normally; selecting Groups presents Google sign-in. A guest who later signs in keeps and uploads their existing device data.

There is no sync button, backup screen, or manual import step. Synchronization is silent. Personal saves never wait for the network. A small account/avatar control may expose sign-out, but ordinary expense and category screens retain their current layout.

## Synced and Device-Local Data

The signed-in account synchronizes:

- Personal expense entries, including amount, date, note, category, labels, reimbursement percentage, creation time, and edits.
- Custom category names, icons, colors, and ordering.
- The selected visual style.

Temporary UI state remains device-local, including the selected month or date range, expanded category rows, open sheets, search text, and unsaved form contents.

Guest data remains exclusively in local storage until that guest signs in.

## Storage Architecture

Local storage remains the immediate source used to render Personal, preserving offline speed and installed-PWA behavior. A focused personal-sync module coordinates the local cache with Supabase after authentication.

Supabase adds:

- **personal_expenses**: owner, stable expense ID, normalized expense fields, deletion marker, client operation ID, and server timestamps.
- **personal_settings**: one row per owner containing categories and selected style, plus an operation ID and server timestamps.

Every row is owned by `auth.uid()`. Row-level security allows an authenticated user to select, insert, and update only rows whose owner ID equals their own identity. Direct destructive deletes are not used for expenses; deletion tombstones prevent removed entries from reappearing on another device.

The browser continues to contain only the existing browser-safe Supabase project URL and publishable key.

## Local Data Model and Migration

Existing expense records use device-generated identifiers and do not all contain synchronization metadata. Before the first signed-in synchronization, the app normalizes every local record:

- Preserve every user-visible field.
- Convert the local identifier to a stable string. Existing identifiers are namespaced with a persistent device ID so records from two devices cannot collide.
- Add a local modification operation ID.
- Retain the original creation timestamp where available.

The normalized data replaces the previous local array atomically only after successful validation. Invalid individual records are retained in the original local backup rather than silently discarded.

The app stores separate local caches per signed-in user. Guest data has its own cache. Signing out switches back to the guest cache and must not show the previous account's personal records to a different user on the same browser.

## First Sign-In Merge

First sign-in follows this order:

1. Read and normalize the current guest data without deleting it.
2. Fetch the authenticated user's cloud expenses and settings.
3. Merge expenses by stable ID.
4. Upload guest records not already present in the account.
5. Apply cloud tombstones so previously deleted records do not return.
6. Choose settings safely: existing cloud settings win; otherwise upload the device's current categories and style.
7. Persist the merged account cache locally and render Personal.
8. Mark the guest-to-account import complete for this account and device so reopening cannot duplicate it.

Guest records remain available if the user later chooses guest mode again. They are not repeatedly imported into every account that signs in on the same device. A per-account import marker records which account received them.

On a new empty device, cloud data is downloaded. Empty defaults never overwrite an existing cloud account.

## Continuous Synchronization

Personal mutations follow local-first behavior:

1. Apply the expense or settings change to the active local cache.
2. Render immediately.
3. Append a uniquely identified operation to a durable local outbox.
4. If signed in and online, flush the outbox to Supabase.
5. Pull remote changes and merge them into the cache.

The outbox survives reloads and offline periods. It flushes after sign-in, after a local change, when the browser returns online, when the document becomes visible, and during app startup. Successfully acknowledged operations are removed. Retrying the same operation is idempotent.

Supabase Realtime may trigger an immediate pull while the app is open. Correctness must not depend on Realtime; startup, visibility, online, and post-write pulls provide the fallback.

## Conflict Rules

Each expense change carries a unique operation ID. The server records the order in which operations are accepted. When separate devices edit the same expense offline, the operation accepted by the server last wins. This includes deletion: a later edit may restore a record only when it is an intentional newer operation, while an older cached copy can never erase a newer tombstone.

For categories and style, the last accepted settings operation wins as one coherent settings document. A brand-new device with untouched defaults never creates a settings operation before its first cloud pull.

Merging unrelated expense IDs is additive, so expenses created independently on two devices both remain.

## Authentication and Navigation

The app uses one shared Supabase client and session for Personal and Groups. OAuth retains the intended destination. After Google returns:

- Complete personal synchronization before showing account Personal data.
- Restore the requested Personal or Groups destination.
- If the return came from an invitation link, preserve and process that invitation after session restoration.

The welcome screen is skipped when a valid session already exists. When offline with a previously cached signed-in session, the user may open their cached Personal data; Groups retains its existing online/read-only rules.

If an unsigned guest is offline, **Continue without account** works. Google sign-in clearly requires connectivity.

## Sign-Out and Account Isolation

Signing out does not erase cloud data or the account's encrypted/authenticated server records. It switches Personal to the guest cache and clears in-memory references to the signed-in cache. A subsequent user signing in on the same device loads only their own cache and server rows.

Cached per-account data may remain locally for offline return by the same Supabase user ID, but it is never selected before Supabase identifies that user. No email address or display name is used as an ownership key.

## Error Handling

Local Personal operations succeed even when synchronization fails. Failed operations remain in the outbox and retry later. The app must never replace a non-empty local cache with an empty result caused by a failed or partial network request.

Malformed server rows are excluded from the active merge, logged without sensitive contents, and left on the server for diagnosis. Authentication expiry pauses the outbox; it does not discard it. The user can continue with the local cache and sign in again later.

The welcome/authentication flow reports sign-in cancellation or failure without altering local data. Storage quota failures surface a clear warning because local-first durability cannot be guaranteed.

## Privacy and Security

Personal expenses are visible only to their owner. Group membership never grants access to personal tables. The database policies are tested for the owner, another authenticated user, and an anonymous visitor.

The privacy page is updated to explain device-only guest storage, authenticated cloud synchronization, Google authentication, deletion tombstones, and how signing out affects local cached data.

No expense data is placed in URLs, OAuth state, analytics, logs, or invitation links.

## Compatibility and Rollout

The database migration is additive. Existing Groups tables and records are unchanged. The site can deploy only after the migration is successfully applied because the new client otherwise cannot synchronize.

The service worker caches the new personal-sync modules and increments its cache version. Supabase requests and OAuth routes remain network-only. Guest Personal use continues to work offline.

Rollback may disable the welcome/sync bootstrap while leaving cloud rows protected by row-level security. Existing local storage remains readable by the previous Personal implementation.

## Testing

Unit tests cover:

- Legacy expense normalization without field loss.
- Stable ID namespacing and collision prevention.
- First-sign-in merge for empty cloud, populated cloud, and data on both sides.
- Cloud tombstones preventing deleted-expense resurrection.
- New-device defaults not overwriting cloud settings.
- Idempotent outbox retry.
- Last-accepted-operation conflict handling.
- Per-account cache isolation on sign-out and account switching.

Database tests cover:

- Owner-only reads and writes for personal expenses and settings.
- Anonymous and cross-account denial.
- Idempotent operation acceptance.
- Tombstone persistence.

Browser-level tests cover:

- Welcome screen Google and guest paths.
- Guest expense creation with no network dependency.
- Guest-to-account automatic import.
- Existing-session startup with no welcome interruption.
- Personal/Groups navigation under one session.
- Offline save followed by reconnect synchronization.
- Sign-out hiding the previous account cache.
- Existing Personal features, exports, styles, and Groups behavior.

Manual acceptance uses two devices or browser profiles with one Google account: create and customize on the first device, verify identical Personal data on the second, edit offline on one device, reconnect, and verify convergence. A different Google account and an anonymous browser must be unable to read the first account's personal records.

## Success Criteria

The feature is complete when:

- A user can enter as a guest and use Personal exactly as before.
- Signing in automatically imports that device's existing Personal data once.
- The same Google account sees matching expenses, categories, icons, colors, and style across devices.
- Personal remains fully usable offline and synchronizes after reconnection without manual action.
- Deletions do not reappear from another device.
- Switching accounts on one device never displays another account's personal records.
- Personal data is inaccessible to group members, other authenticated users, and anonymous visitors.
- Existing Groups flows and existing device-only data remain intact.
