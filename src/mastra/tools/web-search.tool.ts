import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Web search tool usando DuckDuckGo Lite (sin API key, sin rate limit estricto).
 * Ideal para uso personal en Termux.
 */
export const webSearchTool = createTool({
  id: 'web-search',
  description: 'Busca información en la web usando DuckDuckGo',
  inputSchema: z.object({
    query: z.string().describe('Término de búsqueda'),
    maxResults: z.number().optional().default(3),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
    })),
  }),
  execute: async ({ context }) => {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(context.query)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WhatsAppAgent/1.0)' },
    });
    const html = await res.text();

    // Parseo simple de resultados DDG
    const results: { title: string; url: string; snippet: string }[] = [];
    const regex = /<a class="result__a" href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([^<]+)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) !== null && results.length < (context.maxResults ?? 3)) {
      results.push({ url: match[1], title: match[2].trim(), snippet: match[3].trim() });
    }

    return { results };
  },
});
