const axios = require('axios');

// تخزين التوكن مؤقتاً في الذاكرة لتجنب التكرار (صالح غالباً لمدة ساعة)
let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * الحصول على OAuth2 access token من Copernicus Data Space Ecosystem
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
 * مكتبة المعادلات الطيفية (Evalscripts) لجميع الطبقات
 */
const EVALSCRIPTS = {
  trueColor: `
    //VERSION=3
    function setup() { return { input: ["B04", "B03", "B02"], output: { bands: 3 } }; }
    function evaluatePixel(sample) { return [sample.B04 * 2.5, sample.B03 * 2.5, sample.B02 * 2.5]; }
  `,
  falseColor: `
    //VERSION=3
    function setup() { return { input: ["B08", "B04", "B03"], output: { bands: 3 } }; }
    function evaluatePixel(sample) { return [sample.B08 * 2.5, sample.B04 * 2.5, sample.B03 * 2.5]; }
  `,
  moisture: `
    //VERSION=3
    function setup() { return { input: ["B8A", "B11"], output: { bands: 1, sampleType: "FLOAT32" } }; }
    function evaluatePixel(sample) { return [(sample.B8A - sample.B11) / (sample.B8A + sample.B11)]; }
  `,
  ndwi: `
    //VERSION=3
    function setup() { return { input: ["B03", "B08"], output: { bands: 1, sampleType: "FLOAT32" } }; }
    function evaluatePixel(sample) { return [(sample.B03 - sample.B08) / (sample.B03 + sample.B08)]; }
  `
};

/**
 * استدعاء حقيقي لـ Sentinel Hub Statistical API لحساب متوسط NDVI
 * لحدود حقل (GeoJSON Polygon) في نطاق زمني معيّن.
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

/**
 * استدعاء Process API لجلب صورة مرئية لأي طبقة وعرضها على الخريطة
 */
async function fetchMapImageLayer(ring, layerType, date) {
  const token = await getAccessToken();
  const evalscript = EVALSCRIPTS[layerType] || EVALSCRIPTS.trueColor;

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
            timeRange: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` },
            maxCloudCoverage: 30,
          },
        },
      ],
    },
    output: {
      width: 512,
      height: 512,
      responses: [{ identifier: 'default', format: { type: 'image/png' } }],
    },
    evalscript,
  };

  const response = await axios.post(process.env.SENTINEL_PROCESS_URL, requestBody, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    responseType: 'arraybuffer',
    timeout: 30000,
  });

  return response.data;
}

module.exports = {
  getAccessToken,
  fetchNdviStatistics,
  fetchMapImageLayer,
  EVALSCRIPTS
};