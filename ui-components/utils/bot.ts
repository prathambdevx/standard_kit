// Search, social and AI crawlers — must receive the FULL server-rendered
// page (the interaction gate would hide everything below the fold from
// indexers). Same pattern foxtale-website ships.
const BOT_USER_AGENT_PATTERN =
  /bot|crawler|spider|crawling|googlebot|bingbot|yandex|baiduspider|duckduckbot|sogou|exabot|facebot|facebookexternalhit|twitterbot|slackbot|linkedinbot|whatsapp|telegram|discordbot|applebot|petalbot|mojeekbot|seznambot|ahrefs|semrush|mj12bot|dotbot|rogerbot|gptbot|chatgpt-user|claudebot|claude-web|anthropic|perplexity|google-extended|ccbot|bytespider|amazonbot|cohere-ai/i;

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return BOT_USER_AGENT_PATTERN.test(userAgent);
}
