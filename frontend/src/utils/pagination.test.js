import { pageHasMore, pageOffset } from './pagination';

describe('pagination helpers', () => {
  test('pageOffset computes zero-based offsets', () => {
    expect(pageOffset(0, 25)).toBe(0);
    expect(pageOffset(2, 25)).toBe(50);
  });

  test('pageHasMore checks the next page boundary', () => {
    expect(pageHasMore(0, 25, 26)).toBe(true);
    expect(pageHasMore(1, 25, 50)).toBe(false);
  });
});

