# Smart Todos

A local-first collaborative grocery todo app built with Next.js, React, Automerge, and Tailwind. List content is edited offline in the browser, persisted in IndexedDB, and merged in real time by a small dedicated backend. Authentication uses a configurable OpenID Connect provider.

## Architecture

- The Next.js frontend remains a static export.
- Each list is an Automerge document containing categories, todos, and classifier history.
- Browser documents are stored in IndexedDB and changes remain available offline.
- The backend persists canonical Automerge files and broadcasts merged documents over WebSockets.
- SQLite stores server-authoritative users, sessions, list metadata, permissions, members, invitations, and pins.
- OIDC Authorization Code Flow with PKCE is handled by the backend. Browser sessions use opaque, hashed, HttpOnly cookies.

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

## Production

Serve the static `out/` directory and reverse proxy `/api/*` plus `/sync` to the backend on the same public origin. Same-origin deployment is recommended because authentication uses secure HttpOnly cookies. Set both `APP_ORIGIN` and `PUBLIC_URL` to the public site origin when the backend is behind that proxy.

The backend data directory contains `metadata.sqlite` and one `.automerge` file per list. Put `DATA_DIR` on persistent storage and back it up as a unit.

Required backend configuration:

| Variable | Purpose |
| --- | --- |
| `OIDC_ISSUER` | OIDC issuer URL used for discovery |
| `OIDC_CLIENT_ID` | Registered relying-party client ID |
| `OIDC_CLIENT_SECRET` | Client secret, when required by the provider |
| `APP_ORIGIN` | Allowed browser origin |
| `PUBLIC_URL` | Public backend URL used for the callback |
| `DATA_DIR` | Persistent SQLite and Automerge storage |

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
