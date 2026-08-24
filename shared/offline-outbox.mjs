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
