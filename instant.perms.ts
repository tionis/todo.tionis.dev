// instant.perms.ts
export default {
  todoLists: {
    allow: {
      view: "true", // Temporarily allow all for debugging
      create: "auth.id != null",
      update: "auth.id != null",
      delete: "auth.id != null"
    }
  },
  todos: {
    allow: {
      view: "true", // Temporarily allow all for debugging  
      create: "auth.id != null",
      update: "auth.id != null",
      delete: "auth.id != null"
    }
  },
  sublists: {
    allow: {
      view: "true", // Temporarily allow all for debugging
      create: "auth.id != null",
      update: "auth.id != null", 
      delete: "auth.id != null"
    }
  },
  listMembers: {
    allow: {
      view: "auth.id != null",
      create: "auth.id != null",
      update: "auth.id != null",
      delete: "auth.id != null"
    }
  },
  invitations: {
    allow: {
      view: "auth.id != null",
      create: "auth.id != null",
      update: "auth.id != null",
      delete: "auth.id != null"
    }
  }
};
