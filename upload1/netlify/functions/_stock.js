/**
 * עטיה — ניהול מלאי מתמיד.
 * משתמש ב-Netlify Blobs: אחסון מובנה של נטליפיי, בלי מסד נתונים חיצוני.
 * המלאי ההתחלתי נלקח מ-catalog.json, ומשם והלאה נשמר ומתעדכן כאן.
 */
const catalog = require('./catalog.json');

const STORE = 'atya-stock';
const KEY = 'levels';

async function store() {
  const { getStore } = await import('@netlify/blobs');
  return getStore(STORE);
}

/** מחזיר את מפת המלאי הנוכחית ({id: qty}) */
async function levels() {
  try {
    const s = await store();
    const saved = await s.get(KEY, { type: 'json' });
    if (saved && typeof saved === 'object') {
      // פריט חדש בקטלוג שעוד לא נשמר — נכנס עם המלאי ההתחלתי שלו
      const out = { ...saved };
      for (const [id, p] of Object.entries(catalog)) {
        if (!(id in out)) out[id] = p.stock;
      }
      return out;
    }
  } catch (_) { /* אחסון לא זמין — נופלים למלאי מהקטלוג */ }
  return Object.fromEntries(Object.entries(catalog).map(([id, p]) => [id, p.stock]));
}

async function save(map) {
  try {
    const s = await store();
    await s.setJSON(KEY, map);
    return true;
  } catch (_) { return false; }
}

/**
 * מוריד מהמלאי את הפריטים שבהזמנה — הכול או כלום.
 * מחזיר {ok:true} או {ok:false, unavailable:[{id,name,left}]}
 */
async function reserve(items) {
  const map = await levels();
  const short = [];
  for (const { id, qty } of items) {
    const have = map[id] ?? 0;
    if (have < qty) short.push({ id, name: catalog[id]?.name || id, left: have });
  }
  if (short.length) return { ok: false, unavailable: short };

  for (const { id, qty } of items) map[id] -= qty;
  const persisted = await save(map);
  return { ok: true, persisted, levels: map };
}

/** מחזיר פריטים למלאי — כשתשלום נכשל או בוטל */
async function release(items) {
  const map = await levels();
  for (const { id, qty } of items) map[id] = (map[id] ?? 0) + qty;
  await save(map);
  return map;
}

module.exports = { catalog, levels, save, reserve, release };
