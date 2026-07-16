// tools/web-search.js — proxy-free web search for Sophia.
//
// Queries several FREE, no-signup, no-key APIs that allow direct cross-origin
// browser requests (verified Access-Control-Allow-Origin: *). No local proxy, no
// install, works identically on desktop and mobile, and queries go straight from
// the browser to reputable public/non-profit sources (privacy-respecting):
//
//   • Wikipedia   — general knowledge (en.wikipedia.org MediaWiki API)
//   • Crossref    — 150M+ scholarly works with DOIs (api.crossref.org)
//   • Europe PMC  — biomedical / neuroscience research (ebi.ac.uk)
//   • DuckDuckGo  — instant answers (api.duckduckgo.com), a light supplement
//
// This is knowledge + research search, not a full open-web crawl. For full
// open-web results you may OPTIONALLY run the local DuckDuckGo proxy and set
// window.SOPHIA_SEARCH_PROXY = 'http://127.0.0.1:8787' — if set, it is tried first.

const DEFAULT_TIMEOUT = 8000;

async function fetchJSON(url, { timeout = DEFAULT_TIMEOUT } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// Strip HTML tags + decode the handful of entities the search snippets use.
function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Truncate to a word boundary near `max` chars (keeps tool results tight for
// small models), adding an ellipsis if cut.
function truncate(s, max) {
  s = String(s || '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim() + '…';
}

// Fetch a page's fuller lead-paragraph extract — much richer than the search
// snippet. Same CORS-open, no-key REST API; returns null on any failure so the
// caller keeps the shorter search snippet.
async function wikiSummary(title) {
  try {
    const d = await fetchJSON(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`,
      { timeout: 6000 }
    );
    return d?.extract ? truncate(d.extract, 600) : null;
  } catch {
    return null;
  }
}

async function searchWikipedia(q, n) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search` +
    `&srsearch=${encodeURIComponent(q)}&format=json&srlimit=${n}&origin=*`;
  const d = await fetchJSON(url);
  const hits = (d?.query?.search || []).map(s => ({
    source: 'Wikipedia',
    title: s.title,
    url: `https://en.wikipedia.org/?curid=${s.pageid}`,
    snippet: stripHtml(s.snippet),
  }));
  // Upgrade the top hits' snippet to the article's fuller summary paragraph
  // (parallel; falls back to the search snippet if a summary can't be fetched).
  const enriched = await Promise.allSettled(hits.slice(0, 2).map(h => wikiSummary(h.title)));
  enriched.forEach((r, i) => { if (r.status === 'fulfilled' && r.value) hits[i].snippet = r.value; });
  return hits;
}

async function searchCrossref(q, n) {
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(q)}` +
    `&rows=${n}&select=title,URL,container-title,published,author`;
  const d = await fetchJSON(url);
  return (d?.message?.items || []).filter(i => i.title?.[0]).map(i => {
    const year = i.published?.['date-parts']?.[0]?.[0];
    const venue = i['container-title']?.[0];
    const a = i.author?.[0];
    const who = a ? `${a.family || a.name || ''}${(i.author.length > 1) ? ' et al.' : ''}`.trim() : '';
    const bits = [who, venue, year].filter(Boolean).join(' · ');
    return { source: 'Crossref', title: i.title[0], url: i.URL, snippet: bits || 'Scholarly work' };
  });
}

async function searchEuropePMC(q, n) {
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search` +
    `?query=${encodeURIComponent(q)}&format=json&pageSize=${n}`;
  const d = await fetchJSON(url);
  return (d?.resultList?.result || []).map(r => {
    const link = r.doi ? `https://doi.org/${r.doi}`
      : r.pmid ? `https://europepmc.org/article/MED/${r.pmid}`
      : `https://europepmc.org/abstract/${r.source}/${r.id}`;
    const bits = [r.authorString, r.journalTitle || r.source, r.pubYear].filter(Boolean).join(' · ');
    return { source: 'Europe PMC', title: r.title, url: link, snippet: bits };
  });
}

async function duckDuckGoIA(q) {
  const d = await fetchJSON(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1`);
  if (d?.AbstractText) {
    return [{ source: 'DuckDuckGo', title: d.Heading || q, url: d.AbstractURL, snippet: d.AbstractText }];
  }
  return [];
}

// Fan out across sources in parallel; a failing source contributes nothing rather
// than sinking the whole search. Results are round-robin interleaved so no single
// source dominates, deduped by URL/title, and capped at max_results.
async function federatedSearch(query, max_results) {
  const per = Math.max(2, Math.ceil(max_results / 2));
  const settled = await Promise.allSettled([
    searchWikipedia(query, per),
    searchCrossref(query, per),
    searchEuropePMC(query, per),
    duckDuckGoIA(query),
  ]);
  const groups = settled.map(s => (s.status === 'fulfilled' ? s.value : []));

  const merged = [];
  const seen = new Set();
  const maxLen = Math.max(0, ...groups.map(g => g.length));
  for (let i = 0; i < maxLen && merged.length < max_results; i++) {
    for (const g of groups) {
      if (i >= g.length || merged.length >= max_results) continue;
      const item = g[i];
      const key = (item.url || item.title || '').toLowerCase();
      if (key && !seen.has(key)) { seen.add(key); merged.push(item); }
    }
  }
  // Sanitize titles/snippets (some scholarly sources leave HTML entities/tags).
  return merged.map(x => ({ ...x, title: stripHtml(x.title), snippet: stripHtml(x.snippet) }));
}

function formatResults(results, query) {
  if (!results.length) {
    return `No results for "${query}" from the open knowledge sources (Wikipedia, Crossref, Europe PMC). ` +
      `They may be unreachable right now, or try rephrasing. Answer from your own knowledge and say the web returned nothing.`;
  }
  return results.map((x, i) => `[${i + 1}] (${x.source}) ${x.title}\n${x.url}\n${x.snippet}`).join('\n\n');
}

export const webSearchTool = {
  name: 'web_search',
  description:
    'Search the web for current or uncertain information and sources to cite. Searches ' +
    'Wikipedia plus scholarly databases (Crossref, Europe PMC) directly — best for facts, ' +
    'research, and topics where your knowledge may be stale. Returns titles, links, and sources.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query.' },
      max_results: { type: 'integer', description: 'How many results (1-8).', default: 5 }
    },
    required: ['query']
  },
  execute: async ({ query, max_results = 5 }) => {
    if (!query || !String(query).trim()) return 'Error: web_search needs a non-empty query.';
    const q = String(query).trim();
    const n = Math.min(Math.max(parseInt(max_results, 10) || 5, 1), 8);

    // Optional power-mode: if a local proxy is configured, try it first for full
    // open-web (DuckDuckGo general) results; fall through to the browser-native
    // federated search on any failure.
    const base = (typeof window !== 'undefined' && window.SOPHIA_SEARCH_PROXY) || null;
    if (base) {
      try {
        const data = await fetchJSON(`${base}/search?q=${encodeURIComponent(q)}&n=${n}`, { timeout: 12000 });
        if (data?.results?.length) {
          return data.results.map((x, i) => `[${i + 1}] ${x.title}\n${x.url}\n${x.snippet}`).join('\n\n');
        }
      } catch { /* proxy down/slow — use the no-proxy sources below */ }
    }

    try {
      return formatResults(await federatedSearch(q, n), q);
    } catch (e) {
      return `Search unavailable (${e.message}). Answer from your own knowledge and note the web could not be reached.`;
    }
  }
};
