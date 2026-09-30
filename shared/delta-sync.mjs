import { reconcileRemoteDocument } from "./sync-policy.mjs";

function sameHeads(left, right) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((head, index) => head === b[index]);
}

/**
 * Apply one frame from the sync socket to the local document.
 *
 * - `{ kind: "full", bytes }` is the whole document (sent once on connect).
 * - `{ kind: "delta", bytes, heads }` carries only the changes since the last frame plus
 *   the server's heads; `bytes` is undefined when nothing new was merged.
 *
 * Returns the new document, whether the client holds changes the server lacks, and the
 * server heads to diff the next upload against. A delta that arrives before its base
 * document is queued by Automerge until the full document supplies the missing changes.
 */
export function applySyncFrame(Automerge, local, frame, access) {
  if (frame.kind === "full") {
    const remote = Automerge.load(frame.bytes);
    const reconciled = reconcileRemoteDocument(Automerge, local, remote, access);
    return {
      document: reconciled.document,
      shouldUpload: reconciled.shouldUpload,
      serverHeads: Automerge.getHeads(remote),
    };
  }
  const base = local || Automerge.init();
  const document = frame.bytes?.byteLength ? Automerge.loadIncremental(base, frame.bytes) : base;
  return {
    document,
    shouldUpload: access === "write" && !sameHeads(Automerge.getHeads(document), frame.heads),
    serverHeads: frame.heads,
  };
}

/** What to send to the server: only what it lacks when its heads are known, else everything. */
export function syncPayload(Automerge, document, serverHeads) {
  if (serverHeads) {
    try {
      return Automerge.saveSince(document, serverHeads);
    } catch {
      // Unknown heads: fall through and send the whole document.
    }
  }
  return Automerge.save(document);
}
