/**
 * The href for one page of a list whose filters live in the query string.
 *
 * The dose log's pagination links were a bare `?page=N`, and a relative URL
 * made only of a query REPLACES the current query rather than merging into
 * it. Page 2 of a filtered or searched history was therefore page 2 of every
 * dose, and the filter bar, which renders from the loaded URL, reset to
 * match. So this starts from the current URL and changes exactly one
 * parameter: everything else, including parameters no filter today uses, is
 * carried across as it was.
 *
 * Page 1 drops the parameter instead of writing `page=1`. The server already
 * reads an absent page as 1, and a filter submission never carries one, so
 * "Previous" back to the first page and a fresh filter arrive at the same URL
 * rather than two spellings of it.
 *
 * Returns a path and query only, with no origin and no fragment, so it can go
 * straight into an `href`.
 */
export function hrefForPage(url: URL, page: number): string {
  // A copy, never `url.searchParams` itself: the caller passes the router's
  // own `page.url`, and editing that in place would rewrite the current URL
  // under everything else that reads it.
  const params = new URLSearchParams(url.searchParams);
  if (page <= 1) params.delete("page");
  else params.set("page", String(page));
  const query = params.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}
