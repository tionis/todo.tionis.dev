export function mayExposeMemberIdentities(access) {
  return !!(access?.owner || access?.member);
}
