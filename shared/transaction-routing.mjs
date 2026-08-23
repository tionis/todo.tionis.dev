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

const CONTENT_ENTITIES = new Set(["todos", "sublists", "todoClassifications"]);

export function groupContentOperations(operations, associations, findExistingListId) {
  const grouped = new Map();
  for (const operation of operations) {
    if (!CONTENT_ENTITIES.has(operation.entity)) continue;
    const listId = explicitListId(operation, associations) || findExistingListId(operation);
    if (!listId) throw new Error(`Cannot find list for ${operation.entity}/${operation.id}`);
    grouped.set(listId, [...(grouped.get(listId) || []), operation]);
  }
  return grouped;
}

export function applyContentOperationsToDraft(document, operations) {
  for (const operation of operations) {
    const collection = operation.entity === "todos"
      ? document.todos
      : operation.entity === "sublists"
        ? document.categories
        : document.classifierHistory;
    if (operation.kind === "delete") delete collection[operation.id];
    else if (operation.kind === "update") {
      if (!collection[operation.id]) collection[operation.id] = { id: operation.id };
      Object.assign(collection[operation.id], operation.data);
    } else if (operation.kind === "link" && operation.links?.sublist && collection[operation.id]) {
      collection[operation.id].categoryId = operation.links.sublist;
    } else if (operation.kind === "unlink" && operation.links?.sublist && collection[operation.id]) {
      delete collection[operation.id].categoryId;
    }
  }
}
