// instant.perms.ts
export default {
  todoLists: {
    allow: {
      view: "isPublic || isOwner || isMember",
      create: "auth.id != null",
      update: "isOwner || (canWrite && data.permission == newData.permission)", // Can't change permissions unless owner
      delete: "isOwner"
    },
    bind: [
      "isLoggedIn", "auth.id != null",
      "isOwner", "isLoggedIn && auth.id == data.ref('owner.id')[0]",
      "isMember", "isLoggedIn && auth.id in data.ref('members.user.id')",
      "isPublic", "data.permission in ['public-read', 'public-write']",
      "canWrite", "data.permission == 'public-write' || (isLoggedIn && (data.permission in ['private-write', 'private-read'] && isMember)) || isOwner"
    ]
  },
  todos: {
    allow: {
      view: "listIsPublic || listIsOwner || listIsMember",
      create: "listCanWrite",
      update: "listCanWrite",
      delete: "listCanWrite"
    },
    bind: [
      "isLoggedIn", "auth.id != null",
      "listIsOwner", "isLoggedIn && auth.id == data.ref('list.owner.id')[0]",
      "listIsMember", "isLoggedIn && auth.id in data.ref('list.members.user.id')",
      "listIsPublic", "data.ref('list.permission')[0] in ['public-read', 'public-write']",
      "listCanWrite", "data.ref('list.permission')[0] == 'public-write' || (isLoggedIn && (data.ref('list.permission')[0] in ['private-write', 'private-read'] && listIsMember)) || listIsOwner"
    ]
  },
  sublists: {
    allow: {
      view: "listIsPublic || listIsOwner || listIsMember",
      create: "listCanWrite",
      update: "listCanWrite",
      delete: "listCanWrite"
    },
    bind: [
      "isLoggedIn", "auth.id != null",
      "listIsOwner", "isLoggedIn && auth.id == data.ref('list.owner.id')[0]",
      "listIsMember", "isLoggedIn && auth.id in data.ref('list.members.user.id')",
      "listIsPublic", "data.ref('list.permission')[0] in ['public-read', 'public-write']",
      "listCanWrite", "data.ref('list.permission')[0] == 'public-write' || (isLoggedIn && (data.ref('list.permission')[0] in ['private-write', 'private-read'] && listIsMember)) || listIsOwner"
    ]
  },
  listMembers: {
    allow: {
      view: "isOwner || isSelf",
      create: "isOwner",
      update: "isOwner",
      delete: "isOwner || isSelf"
    },
    bind: [
      "isLoggedIn", "auth.id != null",
      "isOwner", "isLoggedIn && auth.id == data.ref('list.owner.id')[0]",
      "isSelf", "isLoggedIn && auth.id == data.ref('user.id')[0]"
    ]
  }
};
