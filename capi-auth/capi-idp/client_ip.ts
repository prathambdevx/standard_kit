import type { Context } from 'hono';

// LAST X-Forwarded-For entry: the ALB APPENDS the address it received the connection
// from, so it is the only hop a caller cannot forge. Everything to its left is
// client-supplied, and reading the leftmost lets anyone mint a fresh per-IP rate-limit
// bucket per request, which is the cap against SMS pumping across many numbers.
// A security control, so do not share it with analytics code where a spoofed IP is harmless.
export function clientIp(c: Context): string {
  const parts = c.req.header('x-forwarded-for')?.split(',') ?? [];
  const last = parts.at(-1)?.trim();
  return last && /^[0-9a-f.:]+$/i.test(last) ? last : 'unknown';
}
