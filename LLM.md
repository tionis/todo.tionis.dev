# Smart Todos - LLM Project Instructions

This is a modern, collaborative todo list application built with Next.js 15 and Jazz, featuring real-time collaboration, offline support, and PWA capabilities.

## Project Overview

**Technology Stack:**
- Next.js 15 (React 19) with TypeScript
- Jazz (real-time collaborative database with local-first sync)
- Tailwind CSS 4 for styling
- PWA support with service worker

## Core Features

- **Real-time Collaboration**: Multiple users can edit the same todo list simultaneously
- **Sublists/Categories**: Organize todos with hierarchical sublists
- **Group-based Permissions**: Share lists with specific users via invite links
- **Offline-First**: Jazz provides offline support with automatic sync when online
- **PWA**: Installable as native app with proper manifest and service worker
- **Passphrase Auth**: Secure passphrase-based authentication (recovery phrase)
- **Dark Mode**: Automatically follows system theme preference

## Database Schema (Jazz CoValues)

**Key Entities:**
- `Todo`: Individual todo items with text, done status, order, and timestamps
- `Sublist`: Categories/sublists with names and ordering
- `TodoList`: Main lists with name, hideCompleted setting, and nested todos/sublists
- `TodoAccountRoot`: User's account root containing their todo lists
- `TodoAccount`: User account with profile and root data

**Relationships:**
- TodoList contains ListOfTodos and ListOfSublists
- Todo can optionally reference a Sublist
- TodoAccountRoot contains ListOfTodoLists
- All CoValues use Jazz Groups for permissions

## Key Files Structure

- `lib/schema.ts`: Jazz CoValue schema definitions
- `lib/jazz.tsx`: Jazz provider with passphrase authentication
- `lib/utils.ts`: Utility functions (getListUrl, copyToClipboard)
- `app/page.tsx`: Main app component with auth flow
- `app/components/TodoListView.tsx`: Individual todo list view
- `app/components/InvitationsView.tsx`: Invite link handling
- `app/components/HashRouter.tsx`: Hash-based routing

## Jazz Usage Patterns

**Provider Setup (lib/jazz.tsx):**
```typescript
import { createJazzReactApp, PassphraseAuth } from "jazz-react";

export const Jazz = createJazzReactApp<TodoAccount>({
  AccountSchema: TodoAccount,
});

export const { useAccount, useCoState, useAcceptInvite } = Jazz;
```

**Authentication:**
```typescript
const { me, logOut } = useAccount({ root: { todoLists: { $each: true } } });
```

**Loading CoValues:**
```typescript
const todoList = useCoState(TodoList, id as ID<TodoList>, {
  resolve: {
    todos: { $each: { sublist: true } },
    sublists: true,
  }
});
```

**Creating CoValues:**
```typescript
const listGroup = Group.create();
listGroup.addMember(me, "admin");

const newList = TodoList.create({
  name: listName,
  hideCompleted: false,
  createdAt: new Date().toISOString(),
  todos: ListOfTodos.create([], { owner: listGroup }),
  sublists: ListOfSublists.create([], { owner: listGroup }),
}, { owner: listGroup });

me.root.todoLists?.push(newList);
```

**Mutations (Direct Property Assignment):**
```typescript
// Update a todo
todo.done = !todo.done;
todo.updatedAt = new Date().toISOString();

// Delete from list
const index = todoList.todos?.findIndex(t => t?.id === todo.id);
todoList.todos?.splice(index, 1);
```

**Sharing via Invite Links:**
```typescript
import { createInviteLink } from "jazz-tools";

// Generate invite link
const link = createInviteLink(todoList, "writer");

// Accept invite (handled automatically by useAcceptInvite hook)
useAcceptInvite({
  invitedObjectSchema: TodoList,
  onAccept: (todoList) => navigate(`/list/${todoList.id}`)
});
```

## Important Development Notes

1. **Always handle loading states** when using `useCoState()` and `useAccount()`
2. **Direct mutations** - Jazz uses direct property assignment instead of transactions
3. **ID-based routing** - Todo lists are accessed via `/list/:id` routes using Jazz CoValue IDs
4. **Group-based permissions** - Use Jazz Groups for access control (admin/writer/reader)
5. **Real-time updates** - No need for manual polling; Jazz handles real-time sync automatically
6. **PWA assets** - Run `npm run generate-assets` when updating icons

## Development Commands

- `npm run dev`: Start development server with Turbopack
- `npm run build`: Production build
- `npm run generate-assets`: Generate PWA icons and screenshots
- `npm run lint`: Run Next.js linting

## Authentication Flow

1. User sees passphrase authentication UI on first visit
2. New users create account with auto-generated passphrase (must save it!)
3. Returning users enter their passphrase to log in
4. Authenticated users see their lists and can create new ones

## Permission Model

Jazz uses Groups for permissions:

| Role | Capabilities |
|------|--------------|
| admin | Full control, can manage members |
| writer | Can edit data |
| reader | Read-only access |

**Sharing a list:**
1. Owner creates invite link with `createInviteLink(todoList, "writer")`
2. Share the link with collaborators
3. When they click it, `useAcceptInvite` hook handles adding them to the Group

## Key Differences from Previous InstantDB Implementation

1. **Auth**: Passphrase-based instead of magic link email
2. **Permissions**: Groups instead of permission fields
3. **Sharing**: Invite links instead of invitation records
4. **Mutations**: Direct property assignment instead of transactions
5. **URLs**: CoValue IDs instead of custom slugs
6. **Queries**: `useCoState()` with resolve queries instead of `useQuery()`

## Environment Variables

- `NEXT_PUBLIC_JAZZ_PEER`: Jazz sync server URL (defaults to `wss://cloud.jazz.tools/?key=todo@tionis.dev`)
