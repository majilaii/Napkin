// Napkin share-page renderer.
// Supabase free-tier edge functions force Content-Type: text/plain + sandbox CSP
// on *.supabase.co, so the share-page HTML shows as raw source in browsers.
// This proxy fetches that HTML and re-serves it as proper text/html (which also
// fixes the charset mojibake). All the live/verified/escaping/410 logic stays in
// the Supabase share-page function — this only fixes content-type.
const SUPABASE = 'https://ftvmseaqwwlcxtdlvxxz.supabase.co';

const TOMBSTONE = (msg) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
  `<body style="font-family:-apple-system,Manrope,sans-serif;background:#fffdf8;` +
  `color:#1c1c19;padding:64px 24px;max-width:480px;margin:0 auto;text-align:center">` +
  `<p style="font-style:italic;font-size:18px;opacity:0.7">${msg}</p></body></html>`;

export default async function handler(req, res) {
  const token = (req.query.t || '').toString();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!token) {
    res.status(404).send(TOMBSTONE('this napkin has been folded away.'));
    return;
  }
  try {
    const r = await fetch(`${SUPABASE}/functions/v1/share-page?t=${encodeURIComponent(token)}`, {
      headers: { accept: 'text/html' },
    });
    const html = await r.text();
    res.status(r.status).send(html);
  } catch (e) {
    res.status(502).send(TOMBSTONE('could not load this napkin. try again in a moment.'));
  }
}
