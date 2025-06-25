import { i } from '@instantdb/react';

const _schema = i.schema({
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),
    todoLists: i.entity({
      name: i.string(),
      slug: i.string().unique().indexed(),
      permission: i.string().indexed(), // 'public-write', 'public-read', 'private-write', 'private-read', 'owner'
      hideCompleted: i.boolean().optional(),
      createdAt: i.date().indexed(),
      updatedAt: i.date().optional(),
    }),
    todos: i.entity({
      text: i.string(),
      done: i.boolean(),
      createdAt: i.date().indexed(),
      updatedAt: i.date().optional(),
      order: i.number().indexed().optional(),
    }),
    sublists: i.entity({
      name: i.string(),
      order: i.number().indexed(),
      createdAt: i.date().indexed(),
    }),
    listMembers: i.entity({
      role: i.string(), // 'member', 'owner'
      addedAt: i.date().indexed(),
    }),
    invitations: i.entity({
      email: i.string().indexed(),
      role: i.string(), // 'member'
      invitedAt: i.date().indexed(),
      status: i.string().indexed(), // 'pending', 'accepted', 'declined'
    }),
  },
  links: {
    // Link todo lists to their owners
    listOwner: {
      forward: { on: 'todoLists', has: 'one', label: 'owner', onDelete: 'cascade' },
      reverse: { on: '$users', has: 'many', label: 'ownedLists' }
    },
    // Link todos to their lists
    todoList: {
      forward: { on: 'todos', has: 'one', label: 'list', onDelete: 'cascade' },
      reverse: { on: 'todoLists', has: 'many', label: 'todos' }
    },
    // Link todos to sublists (optional)
    todoSublist: {
      forward: { on: 'todos', has: 'one', label: 'sublist' },
      reverse: { on: 'sublists', has: 'many', label: 'todos' }
    },
    // Link sublists to their lists
    sublistList: {
      forward: { on: 'sublists', has: 'one', label: 'list', onDelete: 'cascade' },
      reverse: { on: 'todoLists', has: 'many', label: 'sublists' }
    },
    // Link list members to users and lists
    memberUser: {
      forward: { on: 'listMembers', has: 'one', label: 'user', onDelete: 'cascade' },
      reverse: { on: '$users', has: 'many', label: 'memberships' }
    },
    memberList: {
      forward: { on: 'listMembers', has: 'one', label: 'list', onDelete: 'cascade' },
      reverse: { on: 'todoLists', has: 'many', label: 'members' }
    },
    // Link invitations to lists
    invitationList: {
      forward: { on: 'invitations', has: 'one', label: 'list', onDelete: 'cascade' },
      reverse: { on: 'todoLists', has: 'many', label: 'invitations' }
    },
    // Link invitations to who sent them
    invitationInviter: {
      forward: { on: 'invitations', has: 'one', label: 'inviter', onDelete: 'cascade' },
      reverse: { on: '$users', has: 'many', label: 'sentInvitations' }
    },
  },
  rooms: {
    todoList: {
      presence: i.entity({
        name: i.string(),
        userId: i.string(),
      }),
    },
  },
});

type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
