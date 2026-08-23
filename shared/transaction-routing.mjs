function operationKey(operation) {
  return `${operation.entity}\u0000${operation.id}`;
}

export function collectListAssociations(operations) {
  const associations = new Map();
  for (const operation of operations) {
    if (operation.links?.list) associations.set(operationKey(operation), operation.links.list);
  }
  return associations;
}

export function explicitListId(operation, associations) {
  return operation.links?.list || associations.get(operationKey(operation));
}
