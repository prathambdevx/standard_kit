/** Safely JSON.parse with a typed fallback instead of throwing. */
export const safeJsonParse = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

/**
 * Resolves `{{name || "fallback"}}`-style placeholders in a string. Returns
 * `value` (trimmed) when provided, otherwise the literal fallback inside the
 * quotes. Strings without the pattern are returned unchanged. Rename the
 * `username` placeholder token to whatever variable name your templates use.
 */
export const resolveTemplate = (text: string, value?: string | null): string =>
  text.replace(
    /\{\{username\s*\|\|\s*"([^"]*)"\}\}/g,
    (_, fallback: string) => value?.trim() || fallback,
  );
