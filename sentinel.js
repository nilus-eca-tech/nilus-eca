const axios = require('axios');

// الثوابت والمعرّفات الصحيحة الخاصة بالاتصال بمنصة Sentinel Hub
const SENTINEL_CONFIG = {
  clientId: 'sh-d9ee10c4-c640-4042-b1c6-e8fde81bf083',
  clientSecret: 'qq0FQHtUIUeintaQ9xUIZ1bNr79n7LOG',
  layerId: 'd52b179f-0358-43dd-b844-17e7602c696d'
};

// دالة لتوليد رمز الدخول (Access Token) باستخدام بيانات الاعتماد المباشرة
async function getAccessToken() {
  const tokenUrl = 'https://services.sentinel-hub.com/oauth/token';
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', SENTINEL_CONFIG.clientId);
  params.append('client_secret', SENTINEL_CONFIG.clientSecret);

  try {
    const response = await axios.post(tokenUrl, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return response.data.access_token;
  } catch (error) {
    console.error('خطأ في المصادقة مع Sentinel Hub:', error.response?.data || error.message);
    throw new Error('فشل الاتصال المصرح به مع خادم الأقمار الصناعية');
  }
}

// دالة لجلب فترات مؤشر NDVI للحقل بناءً على المضلع (Polygon)
async function fetchNdviIntervals(polygonCoordinates, fromDate, toDate, resolution = 'P10D') {
  const accessToken = await getAccessToken();
  const statisticsUrl = 'https://services.sentinel-hub.com/api/v1/statistics';

  // معادلة التقييم لاستخراج مؤشر NDVI وتصفية الغيوم
  const evalscript = `
    //VERSION=3
    function evaluatePixel(samples) {
      if ([3, 8, 9, 10].includes(samples.SCL)) {
        return { ndvi: null, dataValid: 0 };
      }
      let ndvi = (samples.B08 - samples.B04) / (samples.B08 + samples.B04);
      return { ndvi: isNaN(ndvi) ? null : ndvi, dataValid: 1 };
    }
  `;

  const payload = {
    input: {
      bounds: {
        properties: { crs: 'http://www.opengis.net/def/crs/OGC/0/CRS84' },
        geometry: {
          type: 'Polygon',
          coordinates: [polygonCoordinates],
        },
      },
      data: [
        {
          type: 'sentinel-2-l2a',
          dataFilter: { maxCloudCoverage: 30 },
        },
      ],
    },
    aggregation: {
      timeRange: {
        from: `${fromDate}T00:00:00Z`,
        to: `${toDate}T23:59:59Z`,
      },
      aggregationInterval: {
        evalscript: evalscript,
        evalscriptVersion: 3,
        layerId: SENTINEL_CONFIG.layerId,
        timeStep: resolution,
      },
    },
    calculations: {
      default: {
        histograms: {
          default: { bins: 10, range: [-1, 1] },
        },
      },
    },
  };

  try {
    const response = await axios.post(statisticsUrl, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data.data;
  } catch (error) {
    console.error('خطأ أثناء جلب بيانات NDVI:', error.response?.data || error.message);
    throw new Error('تعذر جلب إحصائيات الأقمار الصناعية للحقل');
  }
}

// دالة لاستخراج الفترات الصالحة وتصفية القيم المعدومة أو الفارغة
function extractValidIntervals(rawNdviData) {
  if (!rawNdviData) return [];
  return rawNdviData
    .filter((item) => item.outputs?.default?.bands?.ndvi?.stats?.mean != null)
    .map((item) => ({
      date: item.interval.from.split('T')[0],
      ndvi: Number(item.outputs.default.bands.ndvi.stats.mean.toFixed(3)),
    }));
}

module.exports = {
  fetchNdviIntervals,
  extractValidIntervals,
};
