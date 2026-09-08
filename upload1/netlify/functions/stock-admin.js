/**
 * עטיה — ניהול מלאי.
 *
 * GET  ?key=…               → הקטלוג + המלאי הנוכחי
 * POST {key, levels:{id:n}} → עדכון המלאי
 *
 * הסיסמה נשמרת במשתנה סביבה ATYA_ADMIN_KEY בנטליפיי.
 * בלי משתנה כזה — הפונקציה מסרבת לכל בקשה (fail closed).
 */
const { catalog, levels, save, lastError, salesSummary,
        recordSale, deleteSale, reserve } = require('./_stock');

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
    const sum = await salesSummary();
    return json(200, {
      products: Object.entries(catalog).map(([id, p]) => ({
        id, name: p.name, cat: p.cat, price: p.price, stock: map[id] ?? p.stock,
        sold: (sum.perItem[id] || {}).qty || 0,
        soldValue: (sum.perItem[id] || {}).revenue || 0,
      })),
      sales: {
        orders: sum.orders, units: sum.units,
        revenue: sum.revenue, shipping: sum.shipping, recent: sum.recent,
      },
    });
  }

  /* ── רישום מכירה ידנית (מכירות עבר, וואטסאפ, שוק) ── */
  if (event.httpMethod === 'POST' && body.op === 'addSale') {
    const src = body.sale || {};
    const rows = Array.isArray(src.items) ? src.items : [];
    if (!rows.length) return json(400, { error: 'no_items' });

    const items = [];
    let subtotal = 0;
    for (const r of rows) {
      const p = catalog[r && r.id];
      const qty = Math.floor(Number(r && r.qty));
      if (!p) return json(400, { error: 'unknown_item', id: r && r.id });
      if (!Number.isFinite(qty) || qty < 1 || qty > 999) return json(400, { error: 'bad_qty' });
      const price = Number.isFinite(Number(r.price)) && Number(r.price) >= 0
        ? Number(r.price) : (p.price || 0);     // אפשר לדרוס מחיר — הנחה, מכירת שוק
      subtotal += price * qty;
      items.push({ id: r.id, name: p.name, qty, price });
    }

    const shipping = Math.max(0, Number(src.shipping) || 0);
    const total = Number.isFinite(Number(src.total)) && Number(src.total) > 0
      ? Number(src.total) : subtotal + shipping;

    let at = new Date().toISOString();
    if (src.at) { const d = new Date(src.at); if (!isNaN(d)) at = d.toISOString(); }

    const sale = {
      manual: true,
      orderId: (src.orderId || 'ידני').slice(0, 24),
      at, items, subtotal, shipping, total,
      delivery: (src.delivery || 'לא צוין').slice(0, 40),
      customer: (src.customer || '').slice(0, 40),
      note: (src.note || '').slice(0, 120),
    };

    const saved = await recordSale(sale);
    let stock = null;
    if (src.reduceStock) stock = await reserve(items.map(i => ({ id: i.id, qty: i.qty })));

    return json(200, { ok: true, persisted: saved, sale, stock,
                       diag: saved ? null : { error: lastError() } });
  }

  /* ── מחיקת רישום ── */
  if (event.httpMethod === 'POST' && body.op === 'deleteSale') {
    if (!body.sid) return json(400, { error: 'no_sid' });
    const r = await deleteSale(String(body.sid));
    return json(r.ok ? 200 : 400, r);
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
    return json(200, {
      ok: true, persisted, changes, levels: map,
      diag: persisted ? null : {
        error: lastError(),
        node: process.version,
        hasBlobsContext: !!(process.env.NETLIFY_BLOBS_CONTEXT || process.env.NETLIFY_PURGE_API_TOKEN),
        siteId: process.env.SITE_ID ? 'קיים' : 'חסר',
      },
    });
  }

  return json(405, { error: 'method_not_allowed' });
};
