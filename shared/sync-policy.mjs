function sameHeads(Automerge, left, right) {
  const leftHeads = [...Automerge.getHeads(left)].sort();
  const rightHeads = [...Automerge.getHeads(right)].sort();
  return leftHeads.length === rightHeads.length && leftHeads.every((head, index) => head === rightHeads[index]);
}

export function reconcileRemoteDocument(Automerge, local, remote, access) {
  if (access === "read" || !local) return { document: remote, shouldUpload: false };
  if (sameHeads(Automerge, local, remote)) return { document: local, shouldUpload: false };
  const document = Automerge.merge(local, remote);
  return {
    document,
    shouldUpload: access === "write" && !sameHeads(Automerge, document, remote),
  };
}
