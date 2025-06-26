// Docs: https://www.instantdb.com/docs/modeling-data

import { i } from "@instantdb/react";

const _schema = i.schema({
  entities: {
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
    }),
    invitations: i.entity({
      email: i.string().indexed(),
      invitedAt: i.date().indexed(),
      role: i.string(),
      status: i.string().indexed(),
    }),
    listMembers: i.entity({
      addedAt: i.date().indexed(),
      role: i.string(),
    }),
    sublists: i.entity({
      createdAt: i.date().indexed(),
      name: i.string(),
      order: i.number().indexed(),
    }),
    todoLists: i.entity({
      createdAt: i.date().indexed(),
      hideCompleted: i.boolean().optional(),
      name: i.string(),
      permission: i.string().indexed(),
      slug: i.string().unique().indexed(),
      updatedAt: i.date().optional(),
    }),
    todos: i.entity({
      createdAt: i.date().indexed(),
      done: i.boolean(),
      order: i.number().indexed().optional(),
      text: i.string(),
      updatedAt: i.date().optional(),
    }),
  },
  links: {
    invitationsInviter: {
      forward: {
        on: "invitations",
        has: "one",
        label: "inviter",
        onDelete: "cascade",
      },
      reverse: {
        on: "$users",
        has: "many",
        label: "sentInvitations",
      },
    },
    invitationsList: {
      forward: {
        on: "invitations",
        has: "one",
        label: "list",
        onDelete: "cascade",
      },
      reverse: {
        on: "todoLists",
        has: "many",
        label: "invitations",
      },
    },
    listMembersList: {
      forward: {
        on: "listMembers",
        has: "one",
        label: "list",
        onDelete: "cascade",
      },
      reverse: {
        on: "todoLists",
        has: "many",
        label: "members",
      },
    },
    listMembersUser: {
      forward: {
        on: "listMembers",
        has: "one",
        label: "user",
        onDelete: "cascade",
      },
      reverse: {
        on: "$users",
        has: "many",
        label: "memberships",
      },
    },
    sublistsList: {
      forward: {
        on: "sublists",
        has: "one",
        label: "list",
        onDelete: "cascade",
      },
      reverse: {
        on: "todoLists",
        has: "many",
        label: "sublists",
      },
    },
    todoListsOwner: {
      forward: {
        on: "todoLists",
        has: "one",
        label: "owner",
        onDelete: "cascade",
      },
      reverse: {
        on: "$users",
        has: "many",
        label: "ownedLists",
      },
    },
    todosList: {
      forward: {
        on: "todos",
        has: "one",
        label: "list",
        onDelete: "cascade",
      },
      reverse: {
        on: "todoLists",
        has: "many",
        label: "todos",
      },
    },
    todosSublist: {
      forward: {
        on: "todos",
        has: "one",
        label: "sublist",
      },
      reverse: {
        on: "sublists",
        has: "many",
        label: "todos",
      },
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

// This helps Typescript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
