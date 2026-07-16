'use client';

import { useEffect, useState } from 'react';

/** Returns a copy of `value` that only updates after it has stayed unchanged for `delayMs`.
 *  Use to keep an input instant while throttling an expensive downstream effect (network, render). */
export const useDebouncedValue = <T>(value: T, delayMs = 300): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    // Reset the timer on every change — only the final value after a pause survives
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
};
