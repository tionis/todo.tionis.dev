# Smart Todos - LLM Project Instructions

This is a modern, collaborative todo list application built with Next.js 15 and InstantDB, featuring real-time collaboration, offline support, and PWA capabilities.

## Project Overview

**Technology Stack:**
- Next.js 15 (React 19) with TypeScript
- InstantDB (real-time database with optimistic updates)
- Tailwind CSS 4 for styling
- PWA support with service worker

**App ID:** `3629fe62-7453-4610-9a5a-1143a87bcce1`

## Core Features

- **Real-time Collaboration**: Multiple users can edit the same todo list simultaneously
- **Sublists/Categories**: Organize todos with hierarchical sublists
- **Flexible Permissions**: Public, private, or members-only lists with role-based access
- **Invitation System**: Email-based invitations with pending/accepted status tracking
- **Offline-First**: InstantDB provides offline support with sync when online
- **PWA**: Installable as native app with proper manifest and service worker
- **Magic Link Auth**: Passwordless authentication via email codes
- **Dark Mode**: Toggle with Ctrl+Shift+D

## Database Schema (InstantDB)

**Key Entities:**
- `todoLists`: Main lists with slug-based URLs, permissions, and creation timestamps
- `todos`: Individual todo items with text, done status, order, and timestamps
- `sublists`: Categories/sublists with names and ordering
- `listMembers`: User membership in lists with roles and timestamps
- `invitations`: Email invitations with status tracking
- `$users`: User accounts with email (built-in InstantDB entity)

**Important Relationships:**
- Lists have owners, members, todos, and sublists
- Todos belong to lists and optionally to sublists
- Invitations link to lists and inviters

## Key Files Structure

- `lib/db.ts`: InstantDB initialization and exports
- `instant.schema.ts`: Database schema definition
- `app/page.tsx`: Main app component with auth flow
- `app/[slug]/page.tsx`: Individual todo list view
- `app/invitations/page.tsx`: Invitation management
- `instantdb.txt`: Complete InstantDB API reference

## InstantDB Usage Patterns

**Database Connection:**
```typescript
import { db } from '../lib/db';
```

**Authentication:**
```typescript
const { isLoading, user, error } = db.useAuth();
```

**Queries with Relations:**
```typescript
const { isLoading, error, data } = db.useQuery({
  todoLists: {
    $: { where: { "owner.id": user.id } },
    owner: {},
    todos: {},
    members: { user: {} }
  }
});
```

**Transactions:**
```typescript
db.transact([
  db.tx.todoLists[id()].update({ name: "New Name" }),
  db.tx.todos[id()].update({ done: true })
]);
```

## Important Development Notes

1. **Always handle loading and error states** when using `db.useQuery()` and `db.useAuth()`
2. **Use optimistic updates** - InstantDB handles this automatically with transactions
3. **Slug-based routing** - Todo lists are accessed via `/[slug]` routes
4. **Permission system** - Check list permissions before allowing edits
5. **Real-time updates** - No need for manual polling; InstantDB handles real-time sync
6. **PWA assets** - Run `npm run generate-assets` when updating icons

## Development Commands

- `npm run dev`: Start development server with Turbopack
- `npm run build`: Production build
- `npm run generate-assets`: Generate PWA icons and screenshots
- `npm run lint`: Run Next.js linting

## Authentication Flow

1. User enters email on landing page
2. Magic code sent via InstantDB auth
3. User enters code to complete sign-in
4. Authenticated users see their lists and can create new ones

## Critical InstantDB API Reference

The complete API reference is in `instantdb.txt`. Key methods:
- `db.useQuery(query)` - Real-time queries
- `db.useAuth()` - Authentication state
- `db.transact(chunks)` - Optimistic updates
- `db.auth.sendMagicCode()` - Send login code
- `db.auth.signInWithMagicCode()` - Complete login

**Remember**: Only use documented InstantDB APIs - do not hallucinate methods not listed in the reference.