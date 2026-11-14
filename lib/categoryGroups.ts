// Category groups: a category may name a group ("EDEKA"), and categories with the same group
// are shown under one header. A group is a label on its categories, not a record of its own,
// so two people grouping categories at once can't conflict, and a group disappears with its
// last category.

export interface GroupableCategory {
  id: string;
  name: string;
  order: number;
  group?: string | null;
}

export type CategorySection<T extends GroupableCategory> =
  | { kind: "category"; category: T }
  | { kind: "group"; name: string; categories: T[] };

/** "  EDEKA " → "EDEKA"; empty → null. */
export function normalizeGroupName(value: string | null | undefined): string | null {
  const name = (value ?? "").trim().replace(/\s+/g, " ");
  return name ? name.slice(0, 100) : null;
}

/** Groups compare case-insensitively, so "Edeka" and "EDEKA" are one group. */
export function groupKey(name: string): string {
  return name.toLocaleLowerCase();
}

/** The collapse state id of a group's header (see lib/collapsedCategories.ts). */
export function groupSectionId(name: string): string {
  return `group:${groupKey(name)}`;
}

/**
 * The list's sections in order: ungrouped categories stand on their own, and each group
 * takes the place of its first category, holding its categories in their order. The group's
 * name is spelled as on that first category.
 */
export function layoutCategorySections<T extends GroupableCategory>(categories: T[]): CategorySection<T>[] {
  const sorted = [...categories].sort((a, b) => a.order - b.order);
  const sections: CategorySection<T>[] = [];
  const groups = new Map<string, { kind: "group"; name: string; categories: T[] }>();
  for (const category of sorted) {
    const name = normalizeGroupName(category.group);
    if (!name) {
      sections.push({ kind: "category", category });
      continue;
    }
    const existing = groups.get(groupKey(name));
    if (existing) {
      existing.categories.push(category);
      continue;
    }
    const section = { kind: "group" as const, name, categories: [category] };
    groups.set(groupKey(name), section);
    sections.push(section);
  }
  return sections;
}

/** The distinct group names in use, in list order, for suggestions. */
export function groupNames(categories: GroupableCategory[]): string[] {
  return layoutCategorySections(categories)
    .filter((section): section is Extract<CategorySection<GroupableCategory>, { kind: "group" }> => section.kind === "group")
    .map((section) => section.name);
}
