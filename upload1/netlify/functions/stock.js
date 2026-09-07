/**
 * עטיה — המלאי החי, לקריאת האתר.
 * GET  /.netlify/functions/stock          → {levels:{id:qty}}
 * העמוד קורא את זה בטעינה ומסמן "אזל מהמלאי" לפי המצב האמיתי.
 */
const { levels } = require('./_stock');

exports.handler = async () => {
  try {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=30',
      },
      body: JSON.stringify({ levels: await levels() }),
    };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ levels: null }) };
  }
};
