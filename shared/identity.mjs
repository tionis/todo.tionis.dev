export function userDisplayName(user) {
  if (!user) return "User";
  return user.name?.trim() || (user.username?.trim() ? `@${user.username.trim()}` : "") || user.email?.trim() || "User";
}
