# Smart Todos - Agent Notes

This is a collaborative grocery-oriented todo list app built with Next.js, React,
InstantDB, and Tailwind. It is configured as a static export and uses InstantDB
for auth, realtime sync, permissions, and offline-capable client data.

## Current Stack

- Next.js `16.2.6`, React `19`, TypeScript
- Tailwind CSS `4`
- InstantDB React/Admin SDKs
- ESLint flat config via `eslint.config.mjs`
- Static export in `next.config.ts` with `output: "export"` and `distDir: "out"`
- PWA assets and service worker under `public/`

Instant app id: `3629fe62-7453-4610-9a5a-1143a87bcce1`

## Local Commands

Use the repo scripts unless there is a reason not to:

- `npm run dev` - start the Turbopack dev server
- `npm run build` - production/static export build
- `npm run start` - start a production server
- `npm run lint` - run `eslint .`
- `npm run generate-assets` - regenerate PWA icons and screenshots
- `npm run debug -- ...` or `node debug-cli.js ...` - InstantDB debug CLI

On Eric's machine, npm may be managed by mise. If plain `npm` is not found, use:

```bash
/home/eric/.local/share/mise/installs/node/20/bin/npm
/home/eric/.local/share/mise/installs/node/20/bin/npx
```

`npm run lint` currently passes with existing warnings. Do not treat those
warnings as newly introduced failures unless your change adds more.

## Key Files

- `app/page.tsx` - dashboard/auth/list creation entrypoint
- `app/components/HashRouter.tsx` - hash-based routing wrapper
- `app/components/TodoListView.tsx` - main list UI, todo lifecycle, settings, sharing, classifier UI
- `app/components/InvitationsView.tsx` - invitation management
- `lib/db.ts` - InstantDB initialization and typed schema export
- `lib/classification.ts` - local todo classifier logic
- `lib/transactions.ts` - shared transaction/permission helpers
- `instant.schema.ts` - InstantDB schema
- `instant.perms.ts` - InstantDB permissions
- `instantdb.txt` - local InstantDB API reference
- `debug-cli.js` and `debug-examples.sh` - InstantDB admin/debug tooling
- `next.config.ts` - static export config

There is no `app/[slug]/page.tsx`; list navigation is handled inside the app
using the hash router and `TodoListView`.

## InstantDB Model

Main entities:

- `todoLists`: list metadata, permissions, settings, `autoSortTodos`,
  `classifierAggressiveness`
- `todos`: item text, done state, ordering, timestamps
- `sublists`: categories/departments, order, `classifierKeywords`
- `todoClassifications`: classifier training samples and correction history
- `listMembers`: list membership
- `invitations`: email invitations
- `pinnedLists`: user pins for public lists without membership
- `$users`: Instant auth users

Important links:

- lists have `owner`, `members`, `todos`, `sublists`, `invitations`, `pins`,
  and `todoClassifications`
- todos belong to a list and may link to one sublist
- classifier samples belong to a list and may link to one sublist
- pins link one user to one public list

When adding fields used in `where` or `order`, add indexes in
`instant.schema.ts`. Keep `instant.perms.ts` in sync with any new entity or
relationship.

## InstantDB Workflow

Schema changes are local until pushed:

```bash
npx --yes instant-cli push schema --yes --app 3629fe62-7453-4610-9a5a-1143a87bcce1
npx --yes instant-cli push perms --yes --app 3629fe62-7453-4610-9a5a-1143a87bcce1
```

Use the explicit mise `npx` path if needed. Schema pushes may require network
approval in sandboxed environments.

Follow InstantDB permission syntax carefully:

- use `data.ref("path.to.attr")` for linked attributes
- `data.ref(...)` returns a list
- the path must end at an attribute, not an entity
- do not use unsupported filters like `$exists`, `$nin`, or `$regex`

## Permissions

List permissions are string values:

- `public-write`
- `public-read`
- `private-write`
- `private-read`
- `owner`

Todos, sublists, classifier samples, members, invitations, and pins inherit or
derive access from their parent list. Public list pins are private to the pinning
user and do not make the user a list member.

Before enabling writes in UI code, use existing permission helpers such as
`canUserWrite` and match the rules in `instant.perms.ts`.

## Classifier Behavior

The classifier is intentionally local and deterministic. It does not call a
remote model.

Core rules live in `lib/classification.ts`:

- training prefers the latest checked occurrence per normalized item text
- checking a categorized todo records a `checked` sample
- manually moving an item records a positive `manual-move` sample for the new
  category and a `negative` sample for the old category
- explicit creation/quick-add/backfill samples remain fallback signals
- auto-generated samples are not used as positive training data
- category keyword hints come from `sublists.classifierKeywords`
- list-level aggressiveness comes from `todoLists.classifierAggressiveness`
  (`conservative`, `normal`, `aggressive`)
- fuzzy matching includes token normalization, simple stemming, edit distance,
  adjacent transposition handling, bigram similarity, containment, and compound
  expansion using known vocabulary

The UI exposes classifier controls in settings and detailed diagnostics in a
separate classifier modal. Medium-confidence matches should be suggestions;
only high-confidence matches should auto-sort.

## Debug CLI

The debug CLI loads InstantDB admin credentials from `.env`:

```bash
INSTANT_APP_ID=3629fe62-7453-4610-9a5a-1143a87bcce1
INSTANT_APP_ADMIN_TOKEN=...
```

Common examples:

```bash
node debug-cli.js query --guest '{todoLists: {}}'
node debug-cli.js query '{todoLists: {owner: {}, todos: {sublist: {}}, sublists: {}}}'
node debug-cli.js query --impersonate-email "user@example.com" '{todoLists: {}}'
node debug-cli.js transact --dry-run update todoLists "list-id" '{permission: "public-read"}'
```

Use it for permission checks, data inspection, and admin-token debugging. See
`debug-examples.sh` for more examples.

## Development Notes

- Handle `db.useAuth()` and `db.useQuery()` loading/error states.
- InstantDB transactions are optimistic; avoid adding manual polling.
- Do not use undocumented InstantDB APIs; consult `instantdb.txt` or official
  docs when unsure.
- Keep edits scoped. This app has a large `TodoListView.tsx`; prefer extracting
  only when it clearly reduces risk or complexity.
- Preserve static-export compatibility. Avoid server-only Next features unless
  the deployment model changes.
- PWA asset scripts require ImageMagick `convert`.
- After dependency or framework changes, run `npm run build` and `npm run lint`.
- After schema/permission changes, push the relevant InstantDB files and note
  that the remote schema/perms were updated.
