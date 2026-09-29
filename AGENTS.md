# Smart Todos - Agent Notes

A local-first collaborative grocery todo app: a Next.js static export in the browser and a
small Node backend that stores, merges and broadcasts Automerge documents. README.md
describes architecture, offline behavior, OIDC/SCIM setup and deployment in detail; read
it before larger changes.

## Stack

- Next.js 16 (static export, `output: "export"`, `distDir: "out"`), React 19, TypeScript,
  Tailwind CSS 4
- `@automerge/automerge` 3 for list content, in the browser (IndexedDB) and the backend
- Backend: plain Node (`backend/server.mjs`) with `ws` for WebSockets, `better-sqlite3`
  for server-authoritative metadata, `openid-client` for OIDC login
- ESLint flat config (`eslint.config.mjs`), `node:test` + `tsx` for tests, Playwright for
  PWA end-to-end tests

## Commands

- `npm run dev` - frontend dev server (http://localhost:3000)
- `npm run dev:backend` - backend with `.env` (http://localhost:3030); see
  `backend/.env.example` for the variables (OIDC, `DATA_DIR`, `APP_ORIGIN`, …)
- `npm run build` - static export plus the generated service worker
  (`scripts/generate-service-worker.mjs`)
- `npm start` - production: one process serves `out/`, `/api/*` and the WebSockets
- `npm test` - backend integration tests (`backend/*.test.mjs`) and unit tests
  (`tests/*.test.ts`); `npm run test:unit` runs only the latter
- `npm run test:pwa:e2e` - builds without a backend URL, then runs Playwright matrix against a mocked backend
  (`tests/pwa-e2e-server.mjs`)
- `npm run lint`

On Eric's machine npm may be managed by mise; if plain `npm` is not found, use
`/home/eric/.local/share/mise/installs/node/20/bin/npm` (and `npx` next to it).

## Architecture

- Each list is one Automerge document: `schemaVersion`, `todos`, `categories`,
  `classifierHistory` (maps keyed by id). The backend validates every document against
  exactly these fields (`backend/document-validation.mjs`); new fields need changes there.
- All backend Automerge parsing, validation, merging and classifier resets run in one
  worker (`backend/document-worker.mjs`, `backend/document-processor.mjs`) with a timeout;
  the HTTP process only handles serialized bytes. The worker exits after 30 s idle.
- Server-authoritative data lives in SQLite (`backend/database.mjs`): users, sessions,
  list metadata and permissions, members, group grants, pins, SCIM directory data. It is
  never part of the CRDT.
- `lib/db.ts` is the client data layer. It keeps an InstantDB-style API (`db.tx.…`,
  `db.transact`, `db.useQuery`) from the app's previous backend, so the UI code still reads
  that way. Entity names map onto the document: `todos` → `todos`, `sublists` →
  `categories`, `todoClassifications` → `classifierHistory`; `todoLists`, `listMembers`
  and `pinnedLists` go to the REST API. Transactions are split and routed in
  `shared/transaction-routing.mjs`.
- Sync: the browser opens a WebSocket to `/sync?listId=…` per list for low-latency
  collaboration; `/events` pushes metadata changes. Both only accept the app's own origin
  (`APP_ORIGIN`) and authenticate with the `smart_todos_session` cookie (HttpOnly,
  SameSite=Lax). Durability comes from HTTP: each changed document is also committed with
  an upload command (`/api/lists/:id/document`) that the server acknowledges.
- Offline: documents and metadata are cached in IndexedDB per account; document uploads and
  server-authoritative changes queue in a durable outbox (`shared/offline-outbox.mjs`) and
  replay in order on reconnect; the service worker can finish uploads after the tab
  closes and retries via Background Sync where supported.
- PWA: the service worker precaches the app shell (including the Automerge WASM), and the
  app is a share target (`POST /share-target`, also `/?action=share&text=…`). Shared text
  that looks like a list (several lines, no link) is offered as separate items
  (`lib/pwa.ts`: `splitSharedItems`, `looksLikeItemList`); rezepte.wendland.dev uses this
  to send a recipe's ingredients. An optional `list=<slug>` preselects that list in the
  share dialog (if the user can write to it; otherwise the dialog says so).

## Permissions

List permission is one of `public-write`, `public-read`, `private-write`, `private-read`,
`owner`; `backend/access.mjs` computes read/write/owner from it plus ownership, direct
membership and group grants. The backend checks access on the WebSocket upgrade and again
before accepting document data. In the UI, use `canUserWrite` / `canUserView` from
`lib/transactions.ts` before enabling writes.

## Key files

- `app/page.tsx` - dashboard, auth state, list creation/import, share dialog
- `app/components/TodoListView.tsx` - list page shell and todo lifecycle; sub-components are
  in `app/components/todo-list/`
- `app/components/HashRouter.tsx` - hash-based routing (there is no `app/[slug]/`)
- `lib/db.ts` - client data layer (see above)
- `lib/todoTransactions.ts` - todo creation incl. classification (`createTodoTransactions`),
  deletion, classifier samples
- `lib/classification.ts` - the local classifier
- `lib/listImport.ts`, `lib/listExport.ts` - JSON list export/import (format
  `smart-todos-list`, version 1)
- `backend/server.mjs` - wiring only: config, HTTP server, route groups, cleanup, shutdown.
  API routes live in `backend/routes-{auth,lists,content,sharing}.mjs` (each returns
  `NOT_HANDLED` when it does not recognise a request), shared helpers in
  `http-helpers.mjs` and `list-shape.mjs`, WebSockets in `realtime.mjs` (`/sync` sends the
  full document once, then `delta` headers + change chunks; `/events` dashboard pushes),
  `idempotency.mjs` replays retried `Idempotency-Key` commands; `backend/documents.mjs` -
  document storage; `backend/document-validation.mjs` - document schema;
  `backend/scim.mjs` - SCIM 2.0 provisioning
- `app/components/todo-list/` - pieces of the list UI split out of `TodoListView.tsx`
  (settings, modals, drag and drop, todo items, sublists)

## Classifier

The classifier is local and deterministic; it never calls a remote model. Rules live in
`lib/classification.ts`:

- training prefers the latest checked occurrence per normalized item text
- checking a categorized todo records a `checked` sample
- moving an item by hand records a positive `manual-move` sample for the new category and
  a `negative` one for the old category
- explicit creation/quick-add/backfill samples are fallback signals; auto-generated
  samples are not used as positive training data
- category keyword hints come from the category's `classifierKeywords`
- aggressiveness (`conservative`, `normal`, `aggressive`) and a reset time come from the
  list settings
- fuzzy matching: token normalization, simple stemming, edit distance, transpositions,
  bigram similarity, containment and compound expansion from known vocabulary

Medium-confidence matches are suggestions; only high-confidence matches auto-sort.

## Development notes

- Keep static-export compatibility; no server-only Next features in the frontend.
- Changes to the list document need matching validation in `backend/document-validation.mjs` and,
  if they affect import/export, `lib/listImport.ts` / `lib/listExport.ts`.
- After changes run `npm test`, `npm run lint` and `npm run build`; for PWA or sharing
  changes also `npm run test:pwa:e2e`.
- `npm run lint` passes with existing warnings; don't add new ones.
- PWA asset scripts require ImageMagick `convert`.
