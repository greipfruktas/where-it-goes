# Swedbank Statement Import Design

## Goal

Add a private, local-first import flow for Swedbank bank statements. A user selects a statement file, reviews categorized outgoing transactions, edits or excludes rows, and saves the selected expenses into Personal. The app remembers category corrections for later imports.

The first release targets Swedbank's Lithuanian statement layout and accepts `.xlsx` and legacy `.xls` files. The supplied workbook is the reference for the `.xlsx` layout.

## Product decisions

- Parse statements in the browser. Do not upload statement files or transaction data to a parsing service.
- Import outgoing transactions only. Ignore zero and positive amounts.
- Detect the earliest and latest transaction dates from the file. Show editable From and To fields after parsing.
- Keep parsed rows temporary until the user saves the reviewed batch.
- Assign unknown transactions to `Other` and mark them for review.
- Remember category corrections as merchant rules.
- Detect prior imports and exclude duplicate rows by default. Let the user include a flagged row manually.
- Do not persist account holder names, account numbers, balances, opening balances, or closing balances.

## User flow

### Open and parse

Add an Import button beside the existing style and export controls in Personal. The button opens an import sheet with:

- a Swedbank file picker;
- the selected filename;
- From and To date fields;
- a short privacy note stating that the file stays on the device.

After file selection, the app parses the workbook and fills From and To from the transaction dates. The user may narrow the date range. Changing either date updates the review set without reading the file again.

### Review

The review view shows a summary with these counts:

- outgoing expenses found;
- incoming transactions ignored;
- rows outside the selected date range;
- duplicates excluded;
- rows categorized as `Other`.

Each outgoing row contains:

- an include checkbox;
- date;
- merchant or transaction description;
- positive expense amount;
- suggested category and category icon;
- status for `Other` or duplicate rows.

The user can tap a row to edit its date, amount, description, category, labels, and reimbursement percentage. Changing a category records a pending merchant rule. The app saves that rule only when the user saves the batch.

The review header provides `Select all new` and `Exclude all`. Duplicate rows remain excluded when the user chooses `Select all new`.

### Save or cancel

`Save selected expenses` validates every selected row before changing Personal data. After validation, the app adds the selected expenses to local storage in one update, renders Personal, and queues one existing sync operation per expense when the user is signed in. It also saves pending merchant rules.

Closing the importer before saving discards the workbook, parsed rows, edits, selections, and pending rules.

## Workbook parsing

Bundle a browser-compatible SheetJS Community Edition build with the application and cache it in the service worker. Loading the library must not send statement contents over the network. Record the dependency version and license in the repository.

The Swedbank adapter locates the header row by normalized header names instead of relying on a fixed row number. The required headers are:

- `Data`;
- `Gavėjas/Mokėtojas`;
- `Paaiškinimai`;
- `Apyvarta`.

`Likutis` may exist but the parser ignores it. The adapter skips title, account summary, opening balance, closing balance, turnover total, and blank rows.

For each transaction row, the adapter returns:

```text
date
signedAmount
merchant
description
sourceRow
```

The importer converts negative signed amounts to positive expense amounts. It counts positive rows as ignored incoming transactions. It rejects a file when it cannot find the required headers or cannot parse any transaction rows.

Excel dates may arrive as date objects, serial numbers, or localized strings. The adapter converts each valid date to local `YYYY-MM-DD` without applying a UTC offset that can move it to another day.

## Categorization

The categorizer receives the merchant and description as data. It never evaluates workbook cell content as HTML or code.

Categorization order:

1. A remembered user rule matching the normalized merchant key.
2. A built-in keyword rule matching normalized merchant and description text.
3. `Other`.

Built-in rules use the user's current category names where possible. The first release includes conservative rules for common grocery, restaurant, transport, fuel, home, bill, health, shopping, insurance, and entertainment terms. A rule that points to a category the user renamed or removed falls back to `Other` unless category rename handling updates the rule.

Merchant normalization:

- Unicode-normalize and uppercase the text;
- collapse whitespace;
- strip repeated punctuation;
- remove known card-terminal and transaction-reference suffixes;
- retain enough merchant text to avoid grouping unrelated businesses.

A learned rule has this shape:

```json
{
  "merchantKey": "normalized merchant key",
  "category": "Food",
  "updatedAt": 1790899200000
}
```

Changing a category during review replaces the pending rule for that merchant key. Category renames update matching learned rules through the existing category-settings flow.

## Duplicate detection

Each parsed outgoing row receives a deterministic import ID derived from:

- source bank (`swedbank`);
- date;
- amount in minor units;
- normalized merchant;
- normalized description;
- occurrence number among otherwise identical rows in statement order.

Use a browser-native SHA-256 digest and prefix the result with `swedbank:`. The occurrence number keeps two legitimate identical purchases on the same day distinct while producing the same IDs when the same statement is imported again.

The importer compares these IDs with existing Personal expense IDs. Matches appear as duplicates and start unchecked. A user may check one to replace/update that imported expense; saving must not create two rows with the same ID.

Manual expenses do not receive import IDs and do not participate in automatic duplicate matching.

## Modules

Keep import code outside the existing `app.js` UI logic:

- `src/import/swedbank-parser.js`: workbook-to-transaction adapter;
- `src/import/categorizer.js`: text normalization, built-in rules, and learned rules;
- `src/import/duplicates.js`: occurrence numbering and deterministic IDs;
- `src/import/domain.js`: validation, date filtering, summaries, and batch construction;
- `src/import/view.js`: import and review markup;
- `src/import/controller.js`: file reading, temporary state, editing, saving, and integration with Personal;
- `vendor/xlsx.full.min.js`: pinned local workbook reader.

Expose a narrow Personal integration bridge from `app.js` with methods to read current expenses/categories/settings and commit one validated import batch. The import controller must not mutate `app.js` module state directly.

## Local and cloud storage

Guest users store learned rules under a versioned local-storage key. Account-scoped caches include `importRules` beside categories and style.

Add a Supabase migration that:

- adds `import_rules jsonb not null default '[]'` to `personal_settings`;
- requires `import_rules` to be an array;
- extends `apply_personal_operation` settings validation and upsert behavior;
- keeps existing owner-only row-level security and write-through-RPC rules;
- preserves existing settings by defaulting the new value to an empty array.

Update Personal sync domain, repository, storage, controller, and tests so `importRules` travel with settings. New clients include the array in `settings_replace`. When an older client omits `import_rules`, the RPC preserves the row's existing rules instead of replacing them with an empty array. A first settings insert without the field uses the column's empty-array default. Existing columns and operation kinds remain unchanged.

Imported expenses use the existing expense schema. Their deterministic import ID occupies the normal expense ID field, so duplicate detection does not require new cloud expense columns.

## Validation and errors

Accept `.xlsx` and `.xls` files up to 10 MB. Reject other file types before parsing.

Stop before review when:

- the workbook is unreadable or encrypted;
- required Swedbank headers are missing;
- the workbook contains no transaction rows;
- every transaction date or amount is invalid.

Skip an individual malformed transaction row and include it in an `Unreadable rows` count when other valid rows exist. Do not guess missing amounts or dates.

Before saving, validate every selected expense using the same amount, date, category, label, and reimbursement constraints as manual Personal expenses. If one selected row fails, show the error on that row and save none of the batch.

After a successful local commit, cloud failures stay in the existing Personal outbox and retry later. The UI must report that expenses were saved locally rather than presenting a sync failure as an import failure.

## Privacy and security

- Read the file with the browser File API and parse its `ArrayBuffer` in memory.
- Do not log statement cells, merchant text, amounts, or account metadata.
- Escape imported text before inserting it into HTML.
- Do not persist the raw workbook or parsed incoming transactions.
- Do not store balance or account-identifying header data.
- Treat all workbook text as untrusted data.

## Testing

Create sanitized fixtures that preserve the supplied Swedbank workbook structure without personal names, account details, balances, or real merchant history.

Automated coverage must include:

- `.xlsx` and legacy `.xls` parsing;
- header discovery when summary rows precede the table;
- Excel serial, date-object, and localized-string dates;
- negative expense conversion and positive-row exclusion;
- automatic date range detection and editable filtering;
- built-in categorization, `Other`, and learned-rule priority;
- merchant normalization boundaries;
- deterministic IDs and occurrence numbering for identical purchases;
- re-import duplicates and manual duplicate override;
- review edits, exclusion, cancel, and batch validation;
- local batch commit and queued cloud operations;
- learned-rule local storage and Personal settings sync;
- malformed, encrypted, unsupported, empty, and oversized files;
- imported text escaping;
- mobile layouts and Pocket Ledger, Midnight Ledger, and Minimal Swiss themes.

Use the sanitized Swedbank fixture for an end-to-end browser test that parses, reviews, edits, saves, re-imports, and confirms duplicate exclusion.

## Release sequence

1. Add the parser, categorizer, duplicate logic, and sanitized fixtures with unit tests.
2. Add the import and review UI with the Personal batch bridge.
3. Add learned-rule local storage and cloud migration.
4. Apply and verify the Supabase migration.
5. Run the complete test suite and mobile visual checks.
6. Publish to GitHub Pages and verify the installed PWA receives the new cached assets.
