// Docs: https://www.instantdb.com/docs/permissions

import type { InstantRules } from "@instantdb/react";

const rules = {
  attrs: {
    allow: {
      $default: "false",
    },
  },
  todos: {
    allow: {
      view: "true", // TODO : Implement more granular permissions, this is a placeholder
      create: "auth.id != null",
      delete: "auth.id != null",
      update: "auth.id != null",
    },
  },
  sublists: {
    allow: {
      view: "true", // TODO : Implement more granular permissions, this is a placeholder
      create: "auth.id != null",
      delete: "auth.id != null",
      update: "auth.id != null",
    },
  },
  todoLists: {
    allow: {
      view: "true", // TODO : Implement more granular permissions, this is a placeholder
      create: "auth.id != null",
      delete: "auth.id != null",
      update: "auth.id != null",
    },
  },
  invitations: {
    allow: {
      view: "auth.id != null",
      create: "auth.id != null",
      delete: "auth.id != null",
      update: "auth.id != null",
    },
  },
  listMembers: {
    allow: {
      view: "auth.id != null",
      create: "auth.id != null",
      delete: "auth.id != null",
      update: "auth.id != null",
    },
  },
} satisfies InstantRules;

export default rules;
