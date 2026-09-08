/**
 * עטיה — יצירת דף תשלום מאובטח ב-Hyp.
 *
 * הפונקציה רצה בשרת של נטליפיי, לא בדפדפן, ולכן מפתחות ה-API
 * לעולם לא נחשפים למבקרות באתר.
 *
 * ── מה צריך להגדיר (Netlify → Site configuration → Environment variables) ──
 *   HYP_MASOF   מספר המסוף שקיבלתם מ-Hyp
 *   HYP_KEY     מפתח ה-API
 *   HYP_PASSP   סיסמת ה-API
 * כל עוד השלושה לא מוגדרים, הפונקציה מחזירה configured:false
 * והאתר ממשיך לעבוד בדיוק כמו היום — הזמנה במייל וקישור תשלום ידני.
 */
const HYP_ENDPOINT = 'https://pay.hyp.co.il/p/';
const { catalog, reserve, release } = require('./_stock');

const json = (code, body) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const { HYP_MASOF, HYP_KEY, HYP_PASSP } = process.env;
  if (!HYP_MASOF || !HYP_KEY || !HYP_PASSP) {
    return json(200, { configured: false, reason: 'missing HYP_MASOF / HYP_KEY / HYP_PASSP' });
  }


  let order;
  try { order = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'bad json' }); }

  // ── הסכום נחשב כאן, מהקטלוג של השרת. מה שהדפדפן שלח כמחיר לא נלקח בחשבון כלל.
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) return json(400, { error: 'empty cart' });

  const clean = [];
  let subtotal = 0;
  for (const it of items) {
    const p = catalog[it && it.id];
    const qty = Math.floor(Number(it && it.qty));
    if (!p || p.price == null) return json(400, { error: 'unknown item: ' + (it && it.id) });
    if (!Number.isFinite(qty) || qty < 1 || qty > 20) return json(400, { error: 'bad qty' });
    subtotal += p.price * qty;
    clean.push({ id: it.id, qty });
  }

  // ── משלוח: אותם כללים כמו בעמוד
  const SHIPPING_FEE = 30;
  const FREE_OVER    = 300;
  const pickup   = order.delivery === 'pickup';          // איסוף עצמי — בלי דמי משלוח
  const shipping = pickup ? 0 : (subtotal >= FREE_OVER ? 0 : SHIPPING_FEE);
  const amount   = subtotal + shipping;
  if (amount <= 0 || amount > 100000) return json(400, { error: 'invalid amount' });

  // ── מלאי: שריון לפני שליחה לתשלום, כדי ששתי לקוחות לא יקנו את אותו פריט יחיד
  const held = await reserve(clean);
  if (!held.ok) {
    return json(409, {
      error: 'out_of_stock',
      unavailable: held.unavailable,
      message: held.unavailable.map(u =>
        u.left === 0 ? `${u.name} אזל מהמלאי` : `${u.name} — נותרו ${u.left} בלבד`).join(', '),
    });
  }

  const origin = `https://${event.headers.host}`;
  const params = {
    action:      'APISign',
    What:        'SIGN',
    Sign:        'True',
    Masof:       HYP_MASOF,
    KEY:         HYP_KEY,
    PassP:       HYP_PASSP,
    Amount:      amount.toFixed(2),
    Coin:        '1',                    // 1 = ILS
    Info:        ((pickup ? '[איסוף עצמי] ' : '') + (order.info || 'הזמנה מאתר עטיה')).slice(0, 80),
    Order:       (order.orderId || '').slice(0, 40),
    ClientName:  (order.firstName || '').slice(0, 40),
    ClientLName: (order.lastName || '').slice(0, 40),
    email:       (order.email || '').slice(0, 80),
    cell:        (order.phone || '').replace(/\D/g, '').slice(0, 15),
    city:        (order.city || '').slice(0, 40),
    street:      (order.address || '').slice(0, 60),
    Tash:        '1',
    UTF8:        'True',
    UTF8out:     'True',
    PageLang:    'HEB',
    sendemail:   'True',
    MoreData:    'True',
    tmp:         '1',
    UrlBuyer:    `${origin}/thanks.html`,
    ErrorUrl:    `${origin}/payment-error.html`,
  };

  const qs = Object.entries(params)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  try {
    const res = await fetch(`${HYP_ENDPOINT}?${qs}`, { method: 'GET' });
    const text = (await res.text()).trim();

    if (!res.ok) {
      await release(clean);
      return json(502, { error: 'hyp http ' + res.status, detail: text.slice(0, 300) });
    }
    if (!/signature=/.test(text)) {
      await release(clean);
      return json(502, { error: 'no signature in response', detail: text.slice(0, 300) });
    }

    // התשובה החתומה מוחזרת כמחרוזת query — מצרפים אותה לכתובת דף התשלום
    const signed = text.replace(/^[?&]/, '');
    const payUrl = `${HYP_ENDPOINT}?${signed.replace(/action=APISign/, 'action=pay')}`;

    return json(200, { configured: true, url: payUrl, amount, subtotal, shipping });
  } catch (e) {
    await release(clean);
    return json(502, { error: 'hyp request failed', detail: String(e).slice(0, 200) });
  }
};
