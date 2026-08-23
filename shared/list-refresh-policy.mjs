export async function refreshFullListDetails(states, loadList) {
  const slugs = [...states]
    .filter((state) => state.metadata?._full && state.metadata.slug)
    .map((state) => state.metadata.slug);
  await Promise.all(slugs.map((slug) => loadList(slug, true)));
}
