import { useEffect, useState } from 'react';

/**
 * Delay a rapidly-changing value.
 *
 * Used by the duplicate check so typing "Spotify" issues one request rather than seven.
 * The delay lives here rather than in the query layer so it is visible next to the input
 * it protects.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
