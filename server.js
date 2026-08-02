const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// بيانات الاعتماد الخاصة بـ Sentinel Hub المحدثة مباشرة
const SENTINEL_CLIENT_ID = process.env.SENTINEL_CLIENT_ID || "sh-e3d1bc13-fba4-4982-9b17-a27138b48a25";
const SENTINEL_CLIENT_SECRET = process.env.SENTINEL_CLIENT_SECRET || "UG3EDpmNRbkUBaYlZkMaZY7poCZ6Wx19";

// وظيفة جلب رمز المصادقة (Access Token) من خادم Sentinel Hub
async function getSentinelAccessToken() {
    try {
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', SENTINEL_CLIENT_ID);
        params.append('client_secret', SENTINEL_CLIENT_SECRET);

        const response = await axios.post('https://services.sentinel-hub.com/oauth/token', params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        return response.data.access_token;
    } catch (error) {
        console.error('خطأ في المصادقة مع Sentinel Hub:', error.response?.data || error.message);
        throw new Error('فشل الاتصال بخادم المصادقة لـ Sentinel Hub');
    }
}

// مسار API لاختبار وجلب تحليلات الحقل و NDVI
app.post('/api/sentinel-analysis', async (req, asyncRes) => {
    try {
        const { bbox, timeFrom, timeTo } = req.body;
        
        // 1. جلب رمز التوثيق أولاً
        const accessToken = await getSentinelAccessToken();

        // 2. إعداد طلب Statistical API الخاص بـ Sentinel Hub
        const payload = {
            input: {
                bounds: {
                    bbox: bbox || [30.5, 28.5, 30.6, 28.6], // إحداثيات افتراضية في حال لم تُرسل
                    properties: {
                        crs: "http://www.opengis.net/def/crs/EPSG/0/4326"
                    }
                },
                data: [{
                    type: "sentinel-2-l2a",
                    dataFilter: {
                        maxCloudCoverage: 20
                    }
                }]
            },
            aggregation: {
                timeRange: {
                    from: timeFrom || "2026-01-01T00:00:00Z",
                    to: timeTo || "2026-08-01T23:59:59Z"
                },
                aggregationInterval: {
                    of: "P1D"
                },
                evalscript: `
                    //VERSION=3
                    function setup() {
                        return {
                            input: ["B04", "B08", "dataMask"],
                            output: [{ id: "ndvi", bands: 1, sampleType: "FLOAT32" }]
                        };
                    }
                    function evaluatePixel(samples) {
                        let ndvi = (samples.B08 - samples.B04) / (samples.B08 + samples.B04);
                        return { ndvi: [samples.dataMask === 1 ? ndvi : NaN] };
                    }
                `
            }
        };

        const sentinelResponse = await axios.post(
            'https://services.sentinel-hub.com/api/v1/statistics',
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            }
        );

        asyncRes.json({
            success: true,
            data: sentinelResponse.data
        });

    } catch (error) {
        console.error('خطأ أثناء جلب بيانات Sentinel:', error.response?.data || error.message);
        asyncRes.status(500).json({
            success: false,
            error: error.response?.data || error.message
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`خادم Nilus ECA يعمل بكفاءة على المنفذ ${PORT}`);
});
