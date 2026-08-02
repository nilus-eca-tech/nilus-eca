// وحدة مشتركة لكل استدعاءات Sentinel Hub Statistical API — تستخدمها كل من
// /api/ndvi (القيمة الحالية) وخدمة الزراعة الذكية المدفوعة (سلسلة زمنية).
// توحيد الكود هنا يضمن مشاركة توكن OAuth المخزّن مؤقتاً بدل طلب توكن جديد من كل مسار.

const axios = require('axios');
const qs = require('qs');

const { SENTINEL_CLIENT_ID, SENTINEL_CLIENT_SECRET } = process.env;

const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const STATISTICS_URL = 'https://sh.dataspace.copernicus.eu/statistics/v1';

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
  let noWaterMask = samples.SCL === 6 ? 0 : 1;
  return {
    data: [ndvi],
    dataMask: [samples.dataMask * validNDVIMask * noWaterMask]
  };
}
`;

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
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

/**
 * @param {{lat:number,lng:number}[]} polygon
 * @param {string} from ISO date
 * @param {string} to ISO date
 * @param {string} aggregationOf - مثال 'P10D' (كل 10 أيام)
 * @returns {Promise<object>} الاستجابة الخام من Statistical API
 */
async function fetchNdviIntervals(polygon, from, to, aggregationOf = 'P10D') {
  const coords = polygon.map((p) => [Number(p.lng), Number(p.lat)]);
  coords.push(coords[0]);

  const token = await getAccessToken();

  const statsRequest = {
    input: {
      bounds: {
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' },
      },
      data: [{ type: 'sentinel-2-l2a', dataFilter: { mosaickingOrder: 'leastCC' } }],
    },
    aggregation: {
      timeRange: { from, to },
      aggregationInterval: { of: aggregationOf },
      evalscript: NDVI_EVALSCRIPT,
      resx: 10,
      resy: 10,
    },
  };

  const resp = await axios.post(STATISTICS_URL, statsRequest, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  return resp.data;
}

/** يحوّل استجابة Statistical API الخام إلى مصفوفة { date, ndvi } مرتبة زمنياً، متجاهلاً الفترات المغطاة بالغيوم بالكامل */
function extractValidIntervals(raw) {
  const intervals = raw.data || [];
  return intervals
    .map((i) => {
      const b0 = i.outputs?.data?.bands?.B0;
      const hasValidData = b0?.stats && b0.stats.sampleCount > b0.stats.noDataCount;
      return hasValidData
        ? { date: i.interval.from, ndvi: Number(b0.stats.mean.toFixed(3)) }
        : null;
    })
    .filter(Boolean);
}

module.exports = { fetchNdviIntervals, extractValidIntervals };
