// وحدة الاتصال الفعلي بـ Sentinel Hub Statistical API (عبر Copernicus Data Space
// Ecosystem). هذه الوحدة تُستخدم من مكانين مختلفين بغرضين مختلفين:
//   1) satelliteRoutes.js  → القياس "الموثّق" الموقّع رقمياً لحيازة مسجّلة (audit-ready)
//   2) smartFarming.js     → تقرير الزراعة الذكية المدفوع للفلاح (سلسلة زمنية للمقارنة)
//
// ⚠️ ملاحظة تاريخية مهمة: كان هناك ملف بنفس الاسم يحتوي على نسخة أبسط (راوتر
// Express بدل دوال مساعدة) نتيجة دمج غير مقصود لملفين من مصدرين مختلفين — ما
// أدى لكسر كل من satelliteRoutes.js و smartFarming.js لأنهما يتوقعان دوال
// fetchNdviIntervals و extractValidIntervals تحديداً، وليس Router. هذه النسخة
// تستعيد الواجهة (interface) الصحيحة المتوقعة من باقي النظام.

const axios = require('axios');

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 30_000) {
    return cachedToken;
  }

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', process.env.SENTINEL_CLIENT_ID);
  params.append('client_secret', process.env.SENTINEL_CLIENT_SECRET);

  const { data } = await axios.post(process.env.SENTINEL_TOKEN_URL, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });

  cachedToken = data.access_token;
  tokenExpiresAt = now + data.expires_in * 1000;
  return cachedToken;
}

const NDVI_EVALSCRIPT = `
  //VERSION=3
  function setup() {
    return {
      input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }],
      output: [
        { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
        { id: "dataMask", bands: 1 }
      ]
    };
  }
  function evaluatePixel(sample) {
    let ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04);
    let validScl = [4, 5, 6, 11].includes(sample.SCL) ? 1 : 0; // استبعاد السحب والظلال
    return { ndvi: [ndvi], dataMask: [sample.dataMask * validScl] };
  }
`;

/**
 * يجلب سلسلة زمنية خام من Sentinel Hub Statistical API لحدود حقل معيّنة.
 *
 * @param {Array<{lat:number, lng:number}>} polygon - نقاط حدود الحقل
 * @param {string} fromISO - تاريخ البداية (ISO)
 * @param {string} toISO   - تاريخ النهاية (ISO)
 * @param {string} interval - مدة كل فترة تجميع، مثال 'P10D'
 * @returns {Promise<object>} الاستجابة الخام كاملة من الـ API
 */
async function fetchNdviIntervals(polygon, fromISO, toISO, interval = 'P10D') {
  const token = await getAccessToken();

  const ring = polygon.map((p) => [p.lng, p.lat]);
  // إغلاق المضلع إذا لم يكن مغلقاً
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);

  const requestBody = {
    input: {
      bounds: {
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' },
      },
      data: [
        {
          type: 'sentinel-2-l2a',
          dataFilter: {
            timeRange: { from: fromISO, to: toISO },
            maxCloudCoverage: 40,
          },
        },
      ],
    },
    aggregation: {
      timeRange: { from: fromISO, to: toISO },
      aggregationInterval: { of: interval },
      evalscript: NDVI_EVALSCRIPT,
    },
  };

  const { data } = await axios.post(process.env.SENTINEL_STATS_URL, requestBody, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  return data;
}

/**
 * يستخرج قائمة مبسّطة {date, ndvi, sampleCount} من الاستجابة الخام، مستبعداً
 * الفترات بدون بيانات صالحة (سحب كثيفة أو غياب تغطية).
 */
function extractValidIntervals(raw) {
  const entries = raw?.data ?? [];
  return entries
    .map((entry) => {
      const stats = entry?.outputs?.ndvi?.bands?.B0?.stats;
      const date = entry?.interval?.from?.slice(0, 10);
      if (!stats || stats.sampleCount === 0 || !date) return null;
      return {
        date,
        ndvi: Number(stats.mean.toFixed(3)),
        stdDev: Number((stats.stDev ?? 0).toFixed(3)),
        sampleCount: stats.sampleCount,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.date > b.date ? 1 : -1));
}

module.exports = { getAccessToken, fetchNdviIntervals, extractValidIntervals };
