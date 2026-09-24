# Shared Groups Design

## Purpose

Add a simple shared-expense mode for trips and short group events. Every participant signs in with Google, joins through a private invitation link, records expenses from their own phone, and can see who owes whom. Repayments must be recordable so balances can be settled without modifying the original expenses.

The existing personal tracker remains private, stored on the current device, and usable offline. This project does not migrate personal expenses to the cloud.

## Scope

Version one includes:

- Google sign-in for all shared-group participants.
- Creation and archiving of groups.
- A group name, icon, currency, and optional start and end dates.
- Private invitation links that require Google sign-in.
- Shared expenses with one payer and selected participants.
- Equal splitting between the selected participants.
- A chronological activity list containing expenses and repayments.
- Simplified balances showing who should pay whom.
- Repayments that reduce balances while preserving history.
- Owner controls for the group and its invitation link.

Version one does not include:

- Manually created participants who do not sign in.
- Unequal splits, percentages, shares, or custom amounts.
- Multiple payers for one expense.
- Receipt images, comments, notifications, or currency conversion.
- Offline creation or editing of shared-group records.
- Cloud synchronization of personal expenses.

## Product Structure

The app has two distinct areas:

1. **Personal** preserves the current expense tracker and its local-storage data model.
2. **Groups** contains online shared trips and events and requires Google sign-in.

GitHub Pages continues to host the static application. Supabase provides Google authentication, the PostgreSQL database, row-level access controls, and real-time updates. The browser uses the public Supabase project URL and anonymous client key; no service-role secret is shipped to the client.

The existing UI styles remain available in both areas. Shared-group screens should feel like part of the same app rather than a separate product.

## User Flows

### Sign in

A user opens Groups and chooses **Continue with Google**. After authentication, the app returns to the Groups area and creates or updates a minimal profile containing the Supabase user ID, display name, avatar URL, and timestamps. Email is used by authentication but is not displayed to other members by default.

### Create a group

The creator enters a name, icon, currency, and optional dates. The creator becomes the group owner and first active member. The app then offers a private invitation link.

### Join through an invitation

The link contains a high-entropy invitation token, not a raw group identifier. If the visitor is signed out, the intended invitation is retained while Google authentication completes. A valid active invitation adds that user as a member and opens the group. Reusing the same invitation as an existing member simply opens the group.

An expired, disabled, or invalid invitation shows a clear message and does not reveal group details.

### Add an expense

A member enters:

- Amount
- Description
- Category
- Date, defaulting to today
- Payer, defaulting to the current user
- Participants, defaulting to every current active member

The payer must be an active group member. At least one participant must be selected. The app divides the expense equally among the selected participants using integer minor currency units, such as cents. Any rounding remainder is assigned deterministically by member ID order so the shares always total the original amount exactly.

The saved activity identifies who created the entry and who paid. All active members see the new entry and updated balances.

### View balances

For each expense, the payer receives credit for the amount paid and each participant is charged their calculated share. Repayments transfer balance from the payer of the repayment to its recipient.

The app nets each member's position and produces a deterministic reduced set of suggested transfers between debtors and creditors. A zero balance is not shown. Calculations use integer minor units and never floating-point currency arithmetic.

### Record a repayment

A member selects the person who paid, the recipient, the amount, and the date. The form may prefill a suggested balance transfer, but the saved repayment is a separate immutable financial event. It appears in activity and immediately recalculates balances.

The payer and recipient must be different active group members. A repayment may not exceed the currently suggested amount between those two members in version one.

## Data Model

Supabase stores these logical entities:

- **profiles**: one row per authenticated user.
- **groups**: metadata, owner, currency, dates, status, and timestamps.
- **group_members**: group, user, role (`owner` or `member`), membership status, and join timestamp.
- **group_invites**: group, hashed invitation token, creator, active status, expiry, and timestamps.
- **group_expenses**: group, amount in minor units, currency, description, category, expense date, payer, creator, and timestamps.
- **expense_participants**: expense, member, and exact share in minor units.
- **group_repayments**: group, payer, recipient, amount in minor units, payment date, creator, and timestamps.

The group currency is fixed after the first expense or repayment is recorded. All financial records within a group use that currency.

Financial entries use soft deletion metadata rather than destructive database deletion. The activity feed hides deleted entries by default but retains enough information for audit and balance recalculation history. Editing an entry updates its timestamp and recalculates its participant shares atomically.

## Permissions and Security

Supabase row-level security enforces membership on every shared table:

- Only active group members can read a group's details, members, expenses, participants, repayments, and activity.
- Any active member can create an expense or repayment for their group.
- The entry creator may edit or soft-delete their own entry.
- The group owner may edit or soft-delete any entry.
- Only the owner may change group metadata, archive the group, remove a member, or rotate/disable invitations.
- Removed members immediately lose access.
- A user can join only through the controlled invitation operation.

Invitation tokens are high-entropy, stored as hashes, rotatable, and revocable. Google identity is required before membership is granted. Public client code contains only values designed for browser use; privileged Supabase keys are never committed or exposed.

## Error Handling and Connectivity

Shared-group reads and writes require an internet connection in version one. The Groups area shows a clear offline state, while Personal continues to work offline.

Forms remain populated when a save fails. The submit control is disabled while a request is in progress. Each create operation includes a client-generated idempotency key so retrying after a timeout cannot produce a duplicate record.

Authentication cancellation returns the user to the previous screen without changing data. Session expiry prompts the user to sign in again and then restores the intended group or invitation destination.

Real-time updates refresh group activity and balances. If the live connection is unavailable, the app falls back to refreshing after local writes and when the page becomes active.

## Ownership and Membership Changes

The owner cannot remove themselves while other active members remain. Version one allows ownership to be transferred to another active member before the original owner leaves. A member with financial history may be removed from active access, but their name and historical entries remain visible to current members so calculations and audit history stay intact.

Archiving a group makes it read-only and disables its invitation links. The owner can reopen an archived group.

## UI Components

The Groups area introduces focused screens or sheets for:

- Google sign-in and signed-in account state
- Group list and group creation
- Invitation acceptance
- Group overview with total activity and member balances
- Activity list
- Add/edit expense
- Record repayment
- Member and invitation management

The group overview prioritizes the current settlement suggestions, followed by recent activity. Adding an expense remains a short phone-friendly flow with amount first, matching the personal tracker's speed.

## Testing

Unit tests cover:

- Equal-share allocation and deterministic rounding.
- Net balance calculation.
- Simplification into suggested transfers.
- Repayment effects.
- Edit and soft-delete recalculation.
- Input validation and duplicate-submit prevention.

Database tests cover row-level security for owners, ordinary members, removed members, and outsiders. They also cover invitation acceptance, revocation, membership changes, atomic expense/share writes, and idempotent creates.

Browser-level tests cover Google-auth return handling with a test session, group creation, invitation joining, expense creation, repayment recording, failed-save recovery, and personal-mode regression behavior. Manual iPhone checks verify installed-PWA navigation, keyboard behavior, touch targets, and sign-in redirects.

## Success Criteria

The feature is successful when two Google users on separate phones can join the same private group, add shared expenses, see identical activity and balances, record a repayment, and see the balance update correctly. Neither user can access a group they have not joined, and existing personal expense data and offline behavior remain unchanged.
