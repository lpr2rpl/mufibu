export function pageOffset(page, limit) {
  return page * limit;
}

export function pageHasMore(page, limit, total) {
  return (page + 1) * limit < total;
}

