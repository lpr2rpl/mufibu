/** Extracts the API error message from an axios error response, with a fallback. */
export const apiError = (err, fallback = 'An error occurred') =>
  err?.response?.data?.detail || fallback;
