/** Plain text from an HTML fragment (tags stripped, entities + whitespace normalized). */
export const stripTags = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** Split a `<br>`-delimited string into trimmed, non-empty lines. */
export const splitBrLines = (html: string | null): string[] =>
  (html ?? '')
    .split(/<br\s*\/?>/i)
    .map((line) => line.trim())
    .filter(Boolean);

/** Strip CKEditor's inline font-size declarations so the component's own typo scale wins. */
export const stripFontSize = (html: string): string =>
  html.replace(/font-size\s*:\s*[^;"']+;?/gi, '');
