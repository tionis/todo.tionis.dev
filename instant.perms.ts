// Docs: https://www.instantdb.com/docs/permissions

import type { InstantRules } from "@instantdb/react";

const rules = {
  // Temporarily more permissive for debugging
  attrs: {
    allow: {
      $default: "false", // Don't allow creating new attributes in production
    },
  },
  
  // Todo lists are the main entities that control access
  todoLists: {
    allow: {
      view: "data.permission == 'public-read' || data.permission == 'public-write' || (auth.id != null && (data.permission == 'private-read' || data.permission == 'private-write') && (auth.id in data.ref('owner.id') || auth.id in data.ref('members.user.id')))",
      create: "auth.id != null",
      update: "auth.id != null && auth.id in data.ref('owner.id')",
      delete: "auth.id != null && auth.id in data.ref('owner.id')",
    },
  },
  
  // Todos inherit permissions from their parent list
  todos: {
    allow: {
      view: "data.ref('list.permission')[0] == 'public-read' || data.ref('list.permission')[0] == 'public-write' || (auth.id != null && auth.id in data.ref('list.owner.id'))",
      create: "data.ref('list.permission')[0] == 'public-write' || (auth.id != null && auth.id in data.ref('list.owner.id'))",
      update: "data.ref('list.permission')[0] == 'public-write' || (auth.id != null && auth.id in data.ref('list.owner.id'))",
      delete: "data.ref('list.permission')[0] == 'public-write' || (auth.id != null && auth.id in data.ref('list.owner.id'))",
    },
  },
  
  // Sublists inherit permissions from their parent list
  sublists: {
    allow: {
      view: "data.ref('list.permission')[0] == 'public-read' || data.ref('list.permission')[0] == 'public-write' || (auth.id != null && (data.ref('list.permission')[0] == 'private-read' || data.ref('list.permission')[0] == 'private-write') && (auth.id in data.ref('list.owner.id') || auth.id in data.ref('list.members.user.id'))) || (data.ref('list.permission')[0] == 'owner' && auth.id in data.ref('list.owner.id'))",
      create: "data.ref('list.permission')[0] == 'public-write' || (auth.id != null && data.ref('list.permission')[0] == 'private-write' && (auth.id in data.ref('list.owner.id') || auth.id in data.ref('list.members.user.id'))) || (data.ref('list.permission')[0] == 'owner' && auth.id in data.ref('list.owner.id'))",
      update: "data.ref('list.permission')[0] == 'public-write' || (auth.id != null && data.ref('list.permission')[0] == 'private-write' && (auth.id in data.ref('list.owner.id') || auth.id in data.ref('list.members.user.id'))) || (data.ref('list.permission')[0] == 'owner' && auth.id in data.ref('list.owner.id'))",
      delete: "data.ref('list.permission')[0] == 'public-write' || (auth.id != null && data.ref('list.permission')[0] == 'private-write' && (auth.id in data.ref('list.owner.id') || auth.id in data.ref('list.members.user.id'))) || (data.ref('list.permission')[0] == 'owner' && auth.id in data.ref('list.owner.id'))",
    },
  },
  
  // Invitations can only be viewed/managed by list owners and the invited user
  invitations: {
    allow: {
      view: "(auth.id != null && auth.id in data.ref('list.owner.id')) || (auth.id != null && auth.email == data.email)",
      create: "auth.id != null && auth.id in data.ref('list.owner.id')",
      update: "(auth.id != null && auth.id in data.ref('list.owner.id')) || (auth.id != null && auth.email == data.email && newData.status != data.status && (newData.status == 'accepted' || newData.status == 'declined'))",
      delete: "auth.id != null && auth.id in data.ref('list.owner.id')",
    },
  },
  
  // List members can be viewed by list members and owners, managed by owners
  listMembers: {
    allow: {
      view: "data.ref('list.permission')[0] == 'public-read' || data.ref('list.permission')[0] == 'public-write' || (auth.id != null && (data.ref('list.permission')[0] == 'private-read' || data.ref('list.permission')[0] == 'private-write') && (auth.id in data.ref('list.owner.id') || auth.id in data.ref('list.members.user.id'))) || (data.ref('list.permission')[0] == 'owner' && auth.id in data.ref('list.owner.id'))",
      create: "(auth.id != null && auth.id in data.ref('list.owner.id')) || (auth.id != null && auth.id == data.ref('user.id')[0] && auth.email in data.ref('list.invitations.email'))",
      update: "auth.id != null && auth.id in data.ref('list.owner.id')",
      delete: "(auth.id != null && auth.id in data.ref('list.owner.id')) || (auth.id != null && auth.id == data.ref('user.id')[0])",
    },
  },
} satisfies InstantRules;

export default rules;
