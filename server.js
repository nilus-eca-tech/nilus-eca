// خادم خلفي وسيط: يستقبل حدود الحقل (Polygon) من واجهة Nilus ECA،
// يستدعي Copernicus Sentinel Hub Statistical API فعلياً للحصول على NDVI،
// ثم يخزّن الاستجابة الخام في AWS S3 للتدقيق (auditability).
//
// لماذا خادم وسيط ولا نتصل من المتصفح مباشرة؟
// لأن Client Secret و AWS Secret Key يجب ألا يظهرا أبداً في كود يعمل على
// جهاز المستخدم (يمكن لأي شخص قراءتهما من Network tab / View Source).

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const qs = require('qs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const app = express();

const {
  SENTINEL_CLIENT_ID,
  SENTINEL_CLIENT_SECRET,
  AWS_REGION,
  AWS_S3_BUCKET,
  PORT = 3001,
  FRONTEND_ORIGIN,
} = process.env;

if (!SENTINEL_CLIENT_ID || !SENTINEL_CLIENT_SECRET) {
  console.warn('[تحذير] SENTINEL_CLIENT_ID / SENTINEL_CLIENT_SECRET غير مضبوطين في .env');
}

app.use(cors({ origin: FRONTEND_ORIGIN || '*' })); // في الإنتاج: حدد FRONTEND_ORIGIN بدل '*'
app.use(express.json({ limit: '2mb' }));

// ---------------------------------------------------------------------------
// المصادقة مع Copernicus Data Space Ecosystem (OAuth2 client_credentials)
// المرجع: https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview/Authentication.html
// ---------------------------------------------------------------------------
const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const STATISTICS_URL = 'https://sh.dataspace.copernicus.eu/statistics/v1';

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken; // أعد استخدام التوكن الحالي (لا تطلب توكن جديد في كل نداء — هذا محدود المعدل)
  }
  const body = qs.stringify({
    grant_type: 'client_credentials',
    client_id: SENTINEL_CLIENT_ID,
    client_secret: SENTINEL_CLIENT_SECRET,
  });
  const resp = await axios.post(TOKEN_URL, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  cachedToken = resp.data.access_token;
  tokenExpiresAt = Date.now() + resp.data.expires_in * 1000;
  return cachedToken;
}

// ---------------------------------------------------------------------------
// Evalscript لحساب NDVI مع استبعاد بكسلات الماء والبيانات غير الصالحة
// (نفس المثال الرسمي من توثيق Copernicus Statistical API)
// ---------------------------------------------------------------------------
const NDVI_EVALSCRIPT = `
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }],
    output: [
      { id: "data", bands: 1 },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(samples) {
  let ndvi = (samples.B08 - samples.B04) / (samples.B08 + samples.B04);
  let validNDVIMask = (samples.B08 + samples.B04) === 0 ? 0 : 1;
  let noWaterMask = samples.SCL === 6 ? 0 : 1; // SCL=6 يعني بكسل ماء
  return {
    data: [ndvi],
    dataMask: [samples.dataMask * validNDVIMask * noWaterMask]
  };
}
`;

const s3 = AWS_S3_BUCKET ? new S3Client({ region: AWS_REGION }) : null;

// ---------------------------------------------------------------------------
// POST /api/ndvi
// body: { polygon: [{lat, lng}, ...], from?: ISOString, to?: ISOString }
// (نفس شكل drawingPoints في واجهة Leaflet — لا حاجة لتحويل يدوي في الواجهة)
// ---------------------------------------------------------------------------
app.post('/api/ndvi', async (req, res) => {
  try {
    const { polygon, from, to } = req.body;

    if (!Array.isArray(polygon) || polygon.length < 3) {
      return res.status(400).json({ error: 'يجب إرسال حدود حقل (polygon) بثلاث نقاط GPS على الأقل' });
    }

    // Leaflet يعطي {lat, lng} — GeoJSON يتطلب [lng, lat]، والحلقة يجب أن تُغلق
    const coords = polygon.map((p) => [Number(p.lng), Number(p.lat)]);
    coords.push(coords[0]);

    const token = await getAccessToken();

    const timeRange = {
      from: from || new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(), // آخر 20 يوماً افتراضياً
      to: to || new Date().toISOString(),
    };

    const statsRequest = {
      input: {
        bounds: {
          geometry: { type: 'Polygon', coordinates: [coords] },
          properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' }, // WGS84 lon/lat (يطابق إحداثيات Leaflet مباشرة)
        },
        data: [{ type: 'sentinel-2-l2a', dataFilter: { mosaickingOrder: 'leastCC' } }], // أقل نسبة غيوم
      },
      aggregation: {
        timeRange,
        aggregationInterval: { of: 'P10D' }, // نفس فترة P10D المذكورة في الواجهة الأصلية
        evalscript: NDVI_EVALSCRIPT,
        resx: 10,
        resy: 10,
      },
    };

    const shResp = await axios.post(STATISTICS_URL, statsRequest, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    const raw = shResp.data;

    // أرشفة الاستجابة الخام كاملة في S3 — هذا ما يجعل البيانات قابلة للتدقيق فعلياً
    let s3Key = null;
    if (s3) {
      s3Key = `ndvi-statistics/${new Date().toISOString().slice(0, 10)}/${Date.now()}.json`;
      await s3.send(new PutObjectCommand({
        Bucket: AWS_S3_BUCKET,
        Key: s3Key,
        Body: JSON.stringify(raw, null, 2),
        ContentType: 'application/json',
      }));
    }

    // خذ أحدث فترة زمنية تحتوي بيانات فعلية (وليست مغطاة بالكامل بالغيوم)
    const intervals = raw.data || [];
    const latestValid = [...intervals].reverse().find((i) => {
      const b0 = i.outputs?.data?.bands?.B0;
      return b0?.stats && b0.stats.sampleCount > b0.stats.noDataCount;
    });

    if (!latestValid) {
      return res.json({ ndvi: null, message: 'لا توجد مشاهد خالية من الغيوم في الفترة المطلوبة', s3Key });
    }

    const meanNdvi = latestValid.outputs.data.bands.B0.stats.mean;
    res.json({
      ndvi: Number(meanNdvi.toFixed(3)),
      interval: latestValid.interval,
      s3Key,
    });
  } catch (err) {
    console.error('NDVI fetch error:', err.response?.data || err.message);
    res.status(500).json({
      error: 'فشل الاتصال بـ Sentinel Hub أو AWS S3',
      detail: err.response?.data || err.message,
    });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`Nilus ECA backend يعمل على المنفذ :${PORT}`));
