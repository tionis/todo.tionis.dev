export function deliveryDisposition(error) {
  if (error instanceof TypeError) return "retry";
  if (error?.status === 401 || error?.status === 429 || error?.status >= 500) return "retry";
  return "reject";
}

export function summarizeOutbox(commands, syncing = false) {
  const pending = commands.filter((command) => command.status === "pending").length;
  const rejected = commands.filter((command) => command.status === "rejected").length;
  return { pending, rejected, syncing: syncing && pending > 0 };
}

export function orderedPendingCommands(commands) {
  return commands
    .filter((command) => command.status === "pending")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

/**
 * A queued document upload carries the whole list document, so a newer upload for the
 * same list makes earlier pending ones redundant. Returns the ids that can be dropped.
 */
export function supersededDocumentUploads(commands, next) {
  return commands
    .filter((command) => command.status === "pending" && command.method === "POST"
      && command.listId === next.listId && command.path === next.path && command.id !== next.id)
    .map((command) => command.id);
}
