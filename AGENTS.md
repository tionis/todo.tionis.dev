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
- **Dark Mode**: Automatically follows system theme preference

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
- `node debug-cli.js`: Run InstantDB debug CLI (see Debug CLI section below)

## Debug CLI Tool

The project includes a powerful debug CLI (`debug-cli.js`) for testing InstantDB operations, permissions, and data management using the admin SDK.

### Setup

The CLI automatically loads environment variables from `.env`:
```bash
INSTANT_APP_ID=3629fe62-7453-4610-9a5a-1143a87bcce1
INSTANT_APP_ADMIN_TOKEN=your_admin_token_here
```

### Available Commands

#### 1. Query Command
Execute database queries with user impersonation and permission testing:

```bash
# Basic queries (runs as admin, bypasses permissions)
node debug-cli.js query '{todoLists: {}}'
node debug-cli.js query '{todoLists: {owner: {}, todos: {sublist: {}}}}'

# Query as guest user (respects permissions)
node debug-cli.js query --guest '{todoLists: {}}'

# Impersonate specific users
node debug-cli.js query --impersonate-email "user@example.com" '{todoLists: {}}'
node debug-cli.js query --impersonate-id "user-id-here" '{todoLists: {}}'

# Complex queries with filters
node debug-cli.js query '{todoLists: {$: {where: {permission: "public-read"}}, todos: {}}}'

# Different output formats
node debug-cli.js query '{todoLists: {}, todos: {}}' --format count
node debug-cli.js query '{todoLists: {}}' --format table
```

**Query Syntax:**
- Supports both JSON and JavaScript object literal formats
- Use single quotes around the query object
- Built-in error handling with helpful suggestions

#### 2. Transact Command
Execute database transactions (create, update, delete operations):

```bash
# Update operations
node debug-cli.js transact update todoLists "list-id" '{permission: "public-read"}'
node debug-cli.js transact update todos "todo-id" '{done: true, text: "Updated text"}'

# Delete operations  
node debug-cli.js transact delete todos "todo-id" '{}'

# Dry run to preview changes
node debug-cli.js transact --dry-run update todoLists "list-id" '{permission: "public-write"}'

# Run as specific user (respects permissions)
node debug-cli.js transact --guest update todos "todo-id" '{done: true}'
node debug-cli.js transact --impersonate-email "user@example.com" update todos "todo-id" '{text: "New text"}'
```

**Transaction Syntax:**
- `operation`: `update`, `create`, or `delete`
- `entity`: Entity name (e.g., `todoLists`, `todos`, `sublists`)
- `id`: Entity ID to operate on
- `data`: JSON object with fields to update

#### 3. User Command
Manage user accounts and retrieve user information:

```bash
# Get user by email
node debug-cli.js user "user@example.com"

# Get user by ID
node debug-cli.js user --id "user-id-here"

# Create authentication token for user
node debug-cli.js user "user@example.com" --create-token
```

#### 4. Presence Command
Check real-time presence in specific rooms:

```bash
# List users in a todo list room
node debug-cli.js presence todoList "list-slug-here"

# General presence listing
node debug-cli.js presence list
```

### Common Use Cases

#### Testing Permissions
```bash
# Test that guests can only see public lists
node debug-cli.js query --guest '{todoLists: {}}'

# Verify owner can see their private lists
node debug-cli.js query --impersonate-email "owner@example.com" '{todoLists: {}}'

# Check if user can access specific list
node debug-cli.js query --impersonate-email "user@example.com" '{todoLists: {$: {where: {slug: "specific-list"}}}}'
```

#### Permission Debugging
```bash
# Make a list public for testing
node debug-cli.js transact update todoLists "list-id" '{permission: "public-read"}'

# Test guest access after making public
node debug-cli.js query --guest '{todoLists: {$: {where: {slug: "list-slug"}}}}'

# Verify todos inherit list permissions
node debug-cli.js query --guest '{todoLists: {todos: {}}}'
```

#### Data Management
```bash
# Count all entities
node debug-cli.js query '{todoLists: {}, todos: {}, users: {}}' --format count

# Find lists by permission type
node debug-cli.js query '{todoLists: {$: {where: {permission: "private-write"}}, owner: {}}}'

# Get detailed list with all relations
node debug-cli.js query '{todoLists: {$: {where: {slug: "my-list"}}, owner: {}, todos: {sublist: {}}, members: {user: {}}}}'
```

### Error Handling

The CLI provides helpful error messages and suggestions:
- Invalid query syntax guidance
- Permission error explanations  
- Common InstantDB patterns and examples
- Automatic environment setup validation

### Example Workflows

See `debug-examples.sh` for comprehensive usage examples and `README-debug-cli.md` for detailed documentation.

The debug CLI is essential for:
- Testing permission rules during development
- Debugging data access issues
- Managing user accounts and content
- Validating InstantDB query patterns
- Performance testing with different user contexts

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