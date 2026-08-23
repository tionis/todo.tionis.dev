export async function commitPersistedDocument({ document, persist, commit, publish, recoverPublish }) {
  await persist(document);
  commit(document);
  if (!publish) return;
  try {
    publish(document);
  } catch (error) {
    recoverPublish?.(error);
  }
}
