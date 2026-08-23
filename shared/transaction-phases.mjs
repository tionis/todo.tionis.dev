export async function runTransactionPhases(phases) {
  for (const phase of phases) await phase();
}
