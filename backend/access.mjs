export function accessFor(database, list, user) {
  if (!list) return { read: false, write: false, owner: false, member: false, directMember: false, groupMember: false };
  const owner = !!user && list.owner_id === user.id;
  const directMember = !!user && !!database.prepare(
    "SELECT 1 FROM members WHERE list_id = ? AND user_id = ?"
  ).get(list.id, user.id);
  const groupMember = !!user && !!database.prepare(`
    SELECT 1 FROM list_group_grants grants
    JOIN directory_groups groups ON groups.id = grants.group_id AND groups.active = 1
    JOIN directory_group_members memberships ON memberships.group_id = groups.id
    WHERE grants.list_id = ? AND memberships.user_id = ?
  `).get(list.id, user.id);
  const member = directMember || groupMember;
  const publicAccess = list.permission === "public-read" || list.permission === "public-write";
  const read = publicAccess || owner || member;
  const write = list.permission === "public-write"
    || (list.permission === "private-write" && (owner || member))
    || (list.permission === "owner" && owner);
  return { read, write, owner, member, directMember, groupMember };
}
