# עטיה — atiya.online

אתר החנות. סטטי + פונקציות של נטליפיי.

## מבנה
- `public/` — האתר עצמו (זה מה שמתפרסם)
- `netlify/functions/` — קוד צד שרת
  - `create-payment.js` — יוצר דף תשלום מאובטח ב-Hyp, מחשב סכום ומשריין מלאי
  - `stock.js` — המלאי החי שהאתר קורא
  - `stock-admin.js` — צפייה ועדכון מלאי (מוגן בסיסמה)
  - `catalog.json` — מחירים ומלאי התחלתי

## משתני סביבה (Netlify → Project configuration → Environment variables)
| שם | תיאור |
|---|---|
| `HYP_MASOF` | מספר המסוף ב-Hyp |
| `HYP_KEY` | מפתח API |
| `HYP_PASSP` | סיסמת API |
| `ATYA_ADMIN_KEY` | סיסמה לעמוד ניהול המלאי |

## עדכון מחירים או מלאי
המחירים יושבים בשני מקומות שחייבים להישאר זהים:
`public/index.html` (מערך `PRODUCTS`) ו-`netlify/functions/catalog.json`.
המלאי השוטף מנוהל דרך `/stock.html`.
