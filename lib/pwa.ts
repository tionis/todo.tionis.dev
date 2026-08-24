export type LaunchAction = "new" | null;

export function consumeLaunchAction(href: string): { action: LaunchAction; nextUrl: string } {
  const url = new URL(href);
  const action = url.searchParams.get("action") === "new" ? "new" : null;
  if (action) url.searchParams.delete("action");
  return {
    action,
    nextUrl: `${url.pathname}${url.search}${url.hash}`,
  };
}
