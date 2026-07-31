/** Sliding window size for the chat message list (includes thought-bearing turns).
 *  Kept small (~30) to reduce DOM node count and keep the thread snappy —
 *  older messages are paged from DB on demand via the "Load more" chip. */
export const MESSAGE_PAGE_SIZE = 30;

/** After load-more, allow up to two pages before dropping the newest page. */
export const MESSAGE_WINDOW_MAX = MESSAGE_PAGE_SIZE * 2;
