const axios = require('axios');

// نخزّن التوكن مؤقتاً في الذاكرة (كل توكن صالح غالباً لمدة ساعة)
let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * الحصول على OAuth2 access token من Copernicus Data Space Ecosystem
 * (client_credentials flow - النوع المستخدم فعلياً لـ Sentinel Hub APIs)
 */
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

/**
 * استدعاء حقيقي لـ Sentinel Hub Statistical API لحساب متوسط NDVI
 * لحدود حقل (GeoJSON Polygon) في نطاق زمني معيّن.
 *
 * @param {Array<[number, number]>} ring - نقاط الحدود بصيغة [lng, lat], مضلع مغلق
 * @param {string} fromDate - YYYY-MM-DD
 * @param {string} toDate   - YYYY-MM-DD
 */
async function fetchNdviStatistics(ring, fromDate, toDate) {
  const token = await getAccessToken();

  const evalscript = `
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
      // استبعاد السحب والظلال حسب Scene Classification Layer
      let validScl = [4, 5, 6, 11].includes(sample.SCL) ? 1 : 0;
      return {
        ndvi: [ndvi],
        dataMask: [sample.dataMask * validScl]
      };
    }
  `;

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
            timeRange: { from: `${fromDate}T00:00:00Z`, to: `${toDate}T23:59:59Z` },
            maxCloudCoverage: 40,
          },
        },
      ],
    },
    aggregation: {
      timeRange: { from: `${fromDate}T00:00:00Z`, to: `${toDate}T23:59:59Z` },
      aggregationInterval: { of: 'P10D' },
      evalscript,
    },
  };

  const { data } = await axios.post(process.env.SENTINEL_STATS_URL, requestBody, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  // نستخرج آخر قراءة NDVI صالحة (أقل نسبة سحب) من السلسلة الزمنية
  const intervals = data?.data ?? [];
  const validReadings = intervals
    .map((entry) => entry?.outputs?.ndvi?.bands?.B0?.stats)
    .filter((stats) => stats && stats.sampleCount > 0);

  if (validReadings.length === 0) {
    const err = new Error('لا توجد قراءات NDVI صالحة (سحب كثيفة أو نطاق زمني بدون تغطية) لهذا الحقل والفترة المطلوبة');
    err.code = 'NO_VALID_NDVI';
    throw err;
  }

  const latest = validReadings[validReadings.length - 1];
  return {
    ndvi: Number(latest.mean.toFixed(3)),
    stdDev: Number(latest.stDev.toFixed(3)),
    sampleCount: latest.sampleCount,
    source: 'sentinel-2-l2a',
    rawIntervals: intervals.length,
  };
}

module.exports = { getAccessToken, fetchNdviStatistics };
