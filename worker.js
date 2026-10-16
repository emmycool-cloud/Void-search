// Cloudflare Worker: searches the web for gigs with Claude and flags likely scams.
// Secrets to add in Cloudflare: ANTHROPIC_API_KEY and APP_TOKEN (any password you choose).
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,x-token',
  'access-control-allow-methods': 'POST,OPTIONS'
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'content-type': 'application/json' } });

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    if (!env.APP_TOKEN || req.headers.get('x-token') !== env.APP_TOKEN) return json({ error: 'Wrong worker password' }, 401);
    let b;
    try { b = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
    const q = String(b.q || '').slice(0, 120);
    const city = String(b.city || '').slice(0, 60);

    const prompt = `Search the web for up to 8 current, real gig or job openings matching "${q}"${city ? `, preferring ones in or open to people in ${city}` : ''}. Any kind of work counts, not only tech. Do not use Upwork or Fiverr. Prefer direct postings that have an apply link or an apply email. Only include pages you actually found.

For each one, judge whether it looks real. Red flags: asks the applicant to pay a fee, contact only through WhatsApp or Telegram, a "company" using a free email address, vague or unverifiable company, pay that is too good to be true, an old or expired posting.

Reply with ONLY a JSON array, no prose, no markdown. Each item:
{"title":"","company":"","url":"","email":"apply email if listed, else empty","loc":"","pay":"if listed, else empty","posted":"","summary":"two sentences","verdict":"likely real" | "caution" | "risky","flags":["short red flags or reasons"]}`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const d = await r.json();
    if (!r.ok) return json({ error: (d.error && d.error.message) || 'API error' }, 502);

    const text = (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const m = text.match(/\[[\s\S]*\]/);
    let jobs = [];
    try { jobs = JSON.parse(m ? m[0] : '[]'); } catch { return json({ error: 'Could not read results, try again' }, 502); }
    jobs = jobs.filter(j => j && j.title && /^https?:\/\//.test(j.url || '')).slice(0, 10);
    return json({ jobs });
  }
};
