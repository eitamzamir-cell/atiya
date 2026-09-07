/**
 * עטיה — ניהול מלאי.
 *
 * GET  ?key=…               → הקטלוג + המלאי הנוכחי
 * POST {key, levels:{id:n}} → עדכון המלאי
 *
 * הסיסמה נשמרת במשתנה סביבה ATYA_ADMIN_KEY בנטליפיי.
 * בלי משתנה כזה — הפונקציה מסרבת לכל בקשה (fail closed).
 */
const { catalog, levels, save } = require('./_stock');

const json = (code, body) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

/** השוואה בזמן קבוע — לא מדליפה כמה תווים התאימו */
function sameKey(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

exports.handler = async (event) => {
  const SECRET = process.env.ATYA_ADMIN_KEY;
  if (!SECRET) return json(503, { error: 'not_configured', message: 'חסר ATYA_ADMIN_KEY בהגדרות נטליפיי' });

  let body = {};
  if (event.httpMethod === 'POST') {
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad_json' }); }
  }
  const key = (event.queryStringParameters && event.queryStringParameters.key) || body.key || '';
  if (!sameKey(key, SECRET)) return json(401, { error: 'unauthorized' });

  if (event.httpMethod === 'GET') {
    const map = await levels();
    return json(200, {
      products: Object.entries(catalog).map(([id, p]) => ({
        id, name: p.name, cat: p.cat, price: p.price, stock: map[id] ?? p.stock,
      })),
    });
  }

  if (event.httpMethod === 'POST') {
    const incoming = body.levels;
    if (!incoming || typeof incoming !== 'object') return json(400, { error: 'no_levels' });
    const map = await levels();
    const changes = [];
    for (const [id, raw] of Object.entries(incoming)) {
      if (!catalog[id]) continue;
      const n = Math.floor(Number(raw));
      if (!Number.isFinite(n) || n < 0 || n > 9999) continue;
      if (map[id] !== n) changes.push({ id, name: catalog[id].name, from: map[id], to: n });
      map[id] = n;
    }
    const persisted = await save(map);
    return json(200, { ok: true, persisted, changes, levels: map });
  }

  return json(405, { error: 'method_not_allowed' });
};
