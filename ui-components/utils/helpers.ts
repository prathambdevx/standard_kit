// Extracted from a larger project helpers.ts — just the piece `media.tsx`/`video.tsx` need.
// Add your own project's other helpers alongside this one.
export const isVideoUrl = (url: string): boolean => /\.(mp4|webm|ogg|mov)$/i.test(url);
