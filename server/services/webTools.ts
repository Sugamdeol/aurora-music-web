import { isIP } from 'node:net';
import { HttpError } from '../errors.js';

export function publicWebUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new HttpError(400, 'BAD_REQUEST', 'Enter a full public HTTPS link.'); }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || isIP(hostname) || hostname.startsWith('[') ||
    hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') ||
    hostname.endsWith('.internal') || hostname.endsWith('.test') || hostname.endsWith('.example') || hostname.endsWith('.onion')) {
    throw new HttpError(400, 'BAD_REQUEST', 'Only public HTTPS pages can be opened.');
  }
  url.hash = '';
  return url.href;
}

function plainText(raw: string): string {
  return raw.replace(/<[^>]*>/g, ' ').replace(/&(?:amp|quot|lt|gt|nbsp|#39);/g, (match) => ({ '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&#39;': "'" })[match] || ' ')
    .replace(/\s+/g, ' ').trim();
}

export async function searchReference(query: string): Promise<Array<{ title: string; snippet: string; url: string }>> {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, format: 'json', srlimit: '5' }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(9_000), headers: { 'User-Agent': 'AuroraMusicWeb/1.0 (public research assistant)' } });
  if (!response.ok) throw new HttpError(502, 'UPSTREAM_ERROR', 'Reference search is unavailable. Try a page link.');
  const body = await response.json() as { query?: { search?: Array<{ title: string; snippet: string }> } };
  return (body.query?.search ?? []).slice(0, 5).map((item) => ({
    title: item.title.slice(0, 160), snippet: plainText(item.snippet).slice(0, 450),
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
  }));
}

export async function readPublicPage(raw: string): Promise<{ url: string; text: string }> {
  const url = publicWebUrl(raw);
  // Jina's public reader extracts text; the server only connects to a fixed host.
  const response = await fetch(`https://r.jina.ai/${url}`, { signal: AbortSignal.timeout(16_000), headers: { Accept: 'text/plain' } });
  if (!response.ok) throw new HttpError(502, 'UPSTREAM_ERROR', 'That page could not be read. Try another public link.');
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, 'UPSTREAM_ERROR', 'That page returned no text.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < 48_000) {
      const part = await reader.read();
      if (part.done) break;
      chunks.push(part.value); size += part.value.length;
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const text = Buffer.concat(chunks).toString('utf8').slice(0, 9_000).trim();
  if (!text) throw new HttpError(502, 'UPSTREAM_ERROR', 'That page returned no readable text.');
  return { url, text };
}
