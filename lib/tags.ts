export function parseListTags(tags?: string | null): string[] {
  if (!tags) return [];

  const seen = new Set<string>();

  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function formatListTags(tags: string[]): string {
  return parseListTags(tags.join(", ")).join(", ");
}

export function tagInputToList(input: string): string[] {
  return parseListTags(input);
}
