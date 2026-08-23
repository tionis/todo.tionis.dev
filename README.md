# Smart Todos

A local-first collaborative grocery todo app built with Next.js, React, Automerge, and Tailwind. List content is edited offline in the browser, persisted in IndexedDB, and merged in real time by a small dedicated backend. Authentication uses a configurable OpenID Connect provider.

## Architecture

- The Next.js frontend remains a static export served by the backend process in production.
- Each list is an Automerge document containing categories, todos, and classifier history.
- Browser documents are stored in IndexedDB and changes remain available offline.
- The backend persists canonical Automerge files and broadcasts merged documents over WebSockets.
- SQLite stores server-authoritative users, directory groups, sessions, list metadata, permissions, members, invitations, and pins.
- OIDC Authorization Code Flow with PKCE is handled by the backend. Login transactions are bound to the initiating browser, and browser sessions use opaque, hashed, HttpOnly cookies. Invitation matching only uses email claims for which the provider returns `email_verified: true`.
- An optional SCIM 2.0 service lets an identity provider provision users, friendly names, usernames, groups, activation state, and group membership before users log in.

Read-only clients receive canonical documents but cannot upload changes. Write access is checked during the WebSocket upgrade and again before accepting document data. List permissions and membership are not stored in client-editable CRDT data.

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

In the sharing dialog, owners can use typo-tolerant search for provisioned users by friendly name, username (with or without `@`), or email and provisioned groups by name. Exact and prefix matches are ranked first. Users are added directly, groups receive a group grant, and unknown users can still receive verified-email invitations. Group grants behave like membership; the list's permission setting continues to decide whether members can write. List ownership always remains assigned to an individual account.

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
npm run test:backend
npm run lint
npm run build
```

PWA assets can be regenerated with `npm run generate-assets` (ImageMagick is required).
