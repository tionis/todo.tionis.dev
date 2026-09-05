# Smart Todos

A local-first collaborative grocery todo app built with Next.js, React, Automerge, and Tailwind. List content is edited offline in the browser, persisted in IndexedDB, and merged in real time by a small dedicated backend. Authentication uses a configurable OpenID Connect provider.

## Architecture

- The Next.js frontend remains a static export served by the backend process in production.
- Each list is an Automerge document containing categories, todos, and classifier history.
- Browser documents are stored in IndexedDB and changes remain available offline.
- The backend persists canonical Automerge files and broadcasts merged documents over WebSockets.
- SQLite stores server-authoritative users, directory groups, sessions, list metadata, permissions, members, and pins.
- OIDC Authorization Code Flow with PKCE is handled by the backend. Login transactions are bound to the initiating browser, and browser sessions use opaque, hashed, HttpOnly cookies.
- An optional SCIM 2.0 service lets an identity provider provision users, friendly names, usernames, groups, activation state, and group membership before users log in.

Read-only clients receive canonical documents but cannot upload changes. Write access is checked during the WebSocket upgrade and again before accepting document data. List permissions and membership are not stored in client-editable CRDT data.

### Offline behavior

After a successful online sign-in, the dashboard eagerly downloads every owned, shared, group-granted, or pinned list, including its complete Automerge document. The application shell, list metadata, sharing directory, and Automerge documents are cached locally and scoped to the signed-in account.

Todo and category edits merge through Automerge. Each updated Automerge document is committed atomically with an acknowledgement-backed upload command in IndexedDB; the WebSocket remains the low-latency collaboration path, while the HTTP outbox proves the server received the edit. Server-authoritative changes—including creating/importing, renaming, configuring, archiving or deleting lists; pins; direct members; group grants; ownership transfers; and classifier resets—use the same durable outbox. Commands replay in order when connectivity returns. Dashboard and per-list status badges distinguish confirmed, locally saved, actively synchronizing, and rejected work. Classifier resets carry their original reset timestamp so samples created later are not removed by delayed delivery.

Production builds generate a release-specific service worker that atomically precaches the complete exported application shell, including the Automerge WebAssembly runtime. The immutable precache is isolated from bounded runtime caches, and activation only removes obsolete Smart Todos caches. The installed app can privately receive shared text and links through a short-lived IndexedDB handoff. Controlled pages hand uploads to the worker so an in-flight flush can finish after the tab closes; Background Sync retries after reconnection where supported, with reconnect, focus, and foreground visibility as fallbacks elsewhere.

Authentication and final authorization remain online operations. A first-time user cannot sign in offline, newly granted access cannot expose a previously inaccessible list until the server approves it, and revoked access cannot be learned while a device is disconnected. Cached data is cleared when the authenticated account changes or signs out.

## Development

Install dependencies and create a backend environment file:

```bash
npm install
cp backend/.env.example .env
```

Register `http://localhost:3030/api/auth/callback` as an allowed callback at your OIDC provider, then set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and (for confidential clients) `OIDC_CLIENT_SECRET`.

Run the frontend and backend in separate terminals:

```bash
npm run dev
npm run dev:backend
```

The default development origins are `http://localhost:3000` for the frontend and `http://localhost:3030` for the backend. Build the frontend with:

```bash
NEXT_PUBLIC_BACKEND_URL=http://localhost:3030 npm run build
```

After a same-origin production build, `npm start` serves both `out/` and the backend on the configured port.

## Authentik directory provisioning

OIDC remains the interactive login protocol. SCIM is an optional backchannel that provisions directory identities and groups into Smart Todos. Set a high-entropy `SCIM_TOKEN` of at least 32 bytes, then configure an Authentik SCIM provider with:

- Base URL: `https://todo.example/scim/v2`
- Authentication mode: static token
- Token: the exact value of `SCIM_TOKEN`
- Backchannel application: the same Authentik application used by the OIDC provider

Keep the OIDC provider subject mode at Authentik's default **Based on the User's hashed ID**. That OIDC `sub` matches Authentik's default SCIM `externalId`, allowing a provisioned account to become the same account when it first logs in. If a different subject mode is required, customize the SCIM `externalId` mapping to emit the same immutable value.

The backend implements Users, Groups, exact-match filtering, PUT updates, group-membership PATCH updates, deletion/deactivation, ServiceProviderConfig, ResourceTypes, and Schemas. Bulk operations and SCIM OAuth authentication are not advertised. Treat `SCIM_TOKEN` as an administrative provisioning credential and restrict `/scim/v2` to Authentik at the reverse proxy when possible.

In the sharing dialog, owners can use typo-tolerant search for provisioned users by friendly name, username (with or without `@`), or email and provisioned groups by name. Exact and prefix matches are ranked first. Users are added directly and groups receive a group grant. Group grants behave like membership; the list's permission setting continues to decide whether members can write. List ownership always remains assigned to an individual account.

SCIM deactivation revokes active sessions and group-derived access without deleting list ownership, direct memberships, or historical data. Group deletion revokes effective group access while retaining list-grant history for safe re-provisioning. An administrator should transfer lists owned by a deprovisioned account before permanently retiring that identity.

## Container deployment

The production `Containerfile` builds the static frontend and packages it with the backend. One Node process serves the frontend, `/api/*`, and the `/sync` WebSocket endpoint on port 3030. The image is therefore a single deployment unit and does not need an in-container nginx, Caddy, or process supervisor.

GitHub Actions builds pull requests and publishes main-branch, commit-SHA, and release-tag images to `ghcr.io/tionis/todo.tionis.dev`. The `latest` tag follows `main`. Images are standard OCI images and can be pulled directly by Podman.

GitHub Container Registry packages are private when first published. Either make the package public or authenticate the production host before starting the Quadlet:

```bash
podman login ghcr.io
```

Run the image behind a TLS-terminating reverse proxy that forwards the complete origin, including WebSocket upgrades, to port 3030. Set `APP_ORIGIN` and `PUBLIC_URL` to the same external HTTPS origin and register its `/api/auth/callback` URL with the OIDC provider:

```bash
podman run --rm \
  --name smart-todos \
  --publish 127.0.0.1:3030:3030 \
  --volume smart-todos-data:/data:U \
  --env-file /etc/smart-todos.env \
  ghcr.io/tionis/todo.tionis.dev:latest
```

An equivalent Quadlet container unit is:

```ini
[Unit]
Description=Smart Todos
After=network-online.target
Wants=network-online.target

[Container]
ContainerName=smart-todos
Image=ghcr.io/tionis/todo.tionis.dev:latest
AutoUpdate=registry
EnvironmentFile=/etc/smart-todos.env
PublishPort=127.0.0.1:3030:3030
# :U gives the unprivileged node user ownership of a newly created volume.
Volume=smart-todos-data:/data:U
HealthCmd=node /app/backend/healthcheck.mjs
HealthInterval=30s
HealthTimeout=5s
HealthRetries=3
HealthStartPeriod=10s
HealthOnFailure=kill

[Service]
Restart=always

[Install]
WantedBy=default.target
```

The corresponding production environment includes:

```dotenv
PUBLIC_URL=https://todo.tionis.dev
APP_ORIGIN=https://todo.tionis.dev
OIDC_ISSUER=https://your-provider.example/application/o/todo/
OIDC_CLIENT_ID=smart-todos
OIDC_CLIENT_SECRET=replace-me
SCIM_TOKEN=replace-with-a-long-random-secret
SECURE_COOKIES=true
TRUST_PROXY=true
```

Only enable `TRUST_PROXY` when direct access to the backend is blocked and the trusted reverse proxy replaces `X-Forwarded-For`. Login initiation is limited per client and globally; `AUTH_LOGIN_LIMIT` controls the per-client ten-minute limit.

For production rollouts, replace `latest` in the Quadlet with the tested `sha-<commit>` tag or an OCI digest. Keep the previous image reference available for rollback.

The backend data directory contains `metadata.sqlite` (including its WAL files) and one `.automerge` file per list. Put `DATA_DIR` on persistent storage and back it up as a unit while the container is stopped, or use an atomic filesystem/volume snapshot. Test restoration before cutover.

Automerge inputs and persisted documents are capped at 2 MB, documents at 10,000 total records, and imports at 4 MB. Untrusted Automerge parsing and merging runs in a memory-limited worker with a timeout and bounded queue. These controls protect the server and browser main thread from unbounded CRDT history, nested data, parser amplification, and oversized imports.

Required backend configuration:

| Variable | Purpose |
| --- | --- |
| `OIDC_ISSUER` | OIDC issuer URL used for discovery |
| `OIDC_CLIENT_ID` | Registered relying-party client ID |
| `OIDC_CLIENT_SECRET` | Client secret, when required by the provider |
| `SCIM_TOKEN` | Optional bearer token enabling the `/scim/v2` provisioning API |
| `APP_ORIGIN` | Allowed browser origin |
| `PUBLIC_URL` | Public backend URL used for the callback |
| `DATA_DIR` | Persistent SQLite and Automerge storage |
| `STATIC_DIR` | Static frontend directory; defaults to `./out` |
| `TRUST_PROXY` | Trust the first `X-Forwarded-For` value for login rate limits; use only behind a trusted proxy |
| `AUTH_LOGIN_LIMIT` | Login initiations allowed per client in ten minutes; defaults to `30` |

See [backend/.env.example](backend/.env.example) for optional settings.

## Moving from the previous service

Before the old service is retired, list owners can open **List Settings → Download Export**. In the Automerge version, use **Import Export** on the dashboard. Version 1 exports restore list settings, categories and keyword hints, todos with completion/order/timestamps, and the complete classifier history. Imports are private to the importing user by default; sharing must be configured again.

## Checks

```bash
npm test
npm run lint
npm run build
npx playwright install chromium firefox webkit
npm run test:pwa:e2e
```

`npm test` runs the backend integration suite plus TypeScript-level transaction-builder tests. The Playwright matrix exercises Chromium, Firefox, and WebKit; verifies the precache (including WASM), Chromium installability, a real worker upgrade, private POST sharing, offline startup, and queued-change persistence across a reload. The container workflow requires these checks to pass before publishing an image. PWA-sensitive releases should also complete the [physical-device checklist](docs/pwa-release-checklist.md).

PWA assets can be regenerated with `npm run generate-assets`. Icon generation requires ImageMagick; promotional screenshots are reproducible captures of a mocked, authenticated production build and require Playwright Chromium.
