// Category paths: a category's name may be a path ("ALDI/Kühlregal/Käse"), and the list
// shows the categories as a tree built from those paths. A parent is derived from its
// children's names, not a record of its own, so two people editing at once can't conflict
// over it and it disappears with its last child. A category whose path is exactly a parent's
// ("ALDI") holds that node's own items.
//
// Lists from before paths stored a separate `group` ("EDEKA" + "Obst"); that reads as the
// path "EDEKA/Obst", and saving such a category writes the combined name and clears `group`.

export interface PathCategory {
  id: string;
  name: string;
  order: number;
  group?: string | null;
}

export interface CategoryNode<T extends PathCategory> {
  /** Case-insensitive identity of the path, e.g. "aldi/kühlregal". */
  key: string;
  /** The node's own segment, spelled as on the first category that reaches it. */
  name: string;
  /** The full path, spelled like `name`, e.g. ["ALDI", "Kühlregal"]. */
  path: string[];
  /** The category stored at exactly this path, or null for a derived parent. */
  category: T | null;
  children: CategoryNode<T>[];
}

export const PATH_SEPARATOR = "/";
const MAX_PATH_LENGTH = 200;

/** " ALDI / Kühl  regal /" → ["ALDI", "Kühl regal"]. */
export function splitCategoryPath(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(PATH_SEPARATOR)
    .map((segment) => segment.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

/** The canonical spelling of a path: trimmed segments joined by "/"; empty → "". */
export function normalizeCategoryPath(value: string | null | undefined): string {
  return splitCategoryPath(value).join(PATH_SEPARATOR).slice(0, MAX_PATH_LENGTH);
}

/** Joins a parent path and a name ("ALDI", "Kühlregal" → "ALDI/Kühlregal"). */
export function joinCategoryPath(parent: string | null | undefined, name: string | null | undefined): string {
  return normalizeCategoryPath(`${parent ?? ""}${PATH_SEPARATOR}${name ?? ""}`);
}

/** Paths compare case-insensitively, so "Aldi/Obst" and "ALDI/obst" are one node. */
export function categoryPathKey(path: string | string[]): string {
  const segments = Array.isArray(path) ? path : splitCategoryPath(path);
  return segments.join(PATH_SEPARATOR).toLocaleLowerCase();
}

/** A category's full path, including a legacy `group`. */
export function categoryPathSegments(category: Pick<PathCategory, "name" | "group">): string[] {
  return [...splitCategoryPath(category.group), ...splitCategoryPath(category.name)];
}

export function categoryPath(category: Pick<PathCategory, "name" | "group">): string {
  return categoryPathSegments(category).join(PATH_SEPARATOR);
}

/** The path for flat displays (toasts, dialogs): "ALDI / Kühlregal". */
export function categoryDisplayPath(category: Pick<PathCategory, "name" | "group">): string {
  return categoryPathSegments(category).join(" / ") || category.name;
}

/** The last segment, shown in the tree: "Kühlregal". */
export function categoryLeafName(category: Pick<PathCategory, "name" | "group">): string {
  const segments = categoryPathSegments(category);
  return segments[segments.length - 1] ?? category.name;
}

/** The parent path of a category ("ALDI/Kühlregal" → "ALDI"), "" at the top. */
export function categoryParentPath(category: Pick<PathCategory, "name" | "group">): string {
  return categoryPathSegments(category).slice(0, -1).join(PATH_SEPARATOR);
}

/** The collapse state id of a derived parent (see lib/collapsedCategories.ts). */
export function pathSectionId(path: string | string[]): string {
  return `group:${categoryPathKey(path)}`;
}

/**
 * The category tree in order. Each node takes the place of the first category in its
 * subtree, and children keep that order. A second category with the same path as an
 * existing one becomes a sibling of it, so nothing is hidden.
 */
export function buildCategoryTree<T extends PathCategory>(categories: T[]): CategoryNode<T>[] {
  const sorted = [...categories].sort((a, b) => a.order - b.order);
  const roots: CategoryNode<T>[] = [];
  const nodes = new Map<string, CategoryNode<T>>();
  for (const category of sorted) {
    const segments = categoryPathSegments(category);
    if (segments.length === 0) segments.push(category.name || category.id);
    let siblings = roots;
    let parentPath: string[] = [];
    for (let depth = 0; depth < segments.length; depth += 1) {
      const path = [...parentPath, segments[depth]];
      const key = categoryPathKey(path);
      const isLeaf = depth === segments.length - 1;
      let node = nodes.get(key);
      if (!node) {
        node = { key, name: segments[depth], path, category: null, children: [] };
        nodes.set(key, node);
        siblings.push(node);
      }
      if (isLeaf) {
        if (node.category) {
          siblings.push({ key: `${key}#${category.id}`, name: segments[depth], path: node.path, category, children: [] });
        } else {
          node.category = category;
        }
      }
      siblings = node.children;
      parentPath = node.path;
    }
  }
  return roots;
}

/** Every node in display order, with its depth, e.g. for a flat select. */
export function flattenCategoryTree<T extends PathCategory>(tree: CategoryNode<T>[], depth = 0): { node: CategoryNode<T>; depth: number }[] {
  return tree.flatMap((node) => [{ node, depth }, ...flattenCategoryTree(node.children, depth + 1)]);
}

/** All categories in a subtree, the node's own first. */
export function subtreeCategories<T extends PathCategory>(node: CategoryNode<T>): T[] {
  return [...(node.category ? [node.category] : []), ...node.children.flatMap(subtreeCategories)];
}

/** Every path in use (derived parents included), in list order, for suggestions. */
export function categoryPaths(categories: PathCategory[]): string[] {
  return flattenCategoryTree(buildCategoryTree(categories)).map(({ node }) => node.path.join(PATH_SEPARATOR))
    .filter((path, index, all) => all.indexOf(path) === index);
}

/**
 * The name changes that move everything at `fromPath` (the category itself and all below it)
 * to `toPath`, as { id, name } updates. Each update also clears a legacy `group`.
 * Moving a path below itself ("ALDI" → "ALDI/Allgemein") moves only the category at that
 * path; what was below it stays where it is.
 */
export function renameCategoryPath(categories: PathCategory[], fromPath: string, toPath: string): { id: string; name: string }[] {
  const from = splitCategoryPath(fromPath);
  const to = splitCategoryPath(toPath);
  if (!from.length || !to.length) return [];
  const fromKey = categoryPathKey(from);
  const toKey = categoryPathKey(to);
  const intoItself = toKey.startsWith(fromKey + PATH_SEPARATOR);
  const updates: { id: string; name: string }[] = [];
  for (const category of categories) {
    const segments = categoryPathSegments(category);
    const head = segments.slice(0, from.length);
    if (segments.length < from.length || categoryPathKey(head) !== fromKey) continue;
    if (intoItself && segments.length > from.length) continue;
    const name = [...to, ...segments.slice(from.length)].join(PATH_SEPARATOR).slice(0, MAX_PATH_LENGTH);
    if (name !== category.name || category.group) updates.push({ id: category.id, name });
  }
  return updates;
}
