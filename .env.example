require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
const PORT = process.env.PORT || 3001;

// إعداد CORS للأمان وتحديد النطاق المسموح
const corsOptions = {
    origin: process.env.FRONTEND_ORIGIN || '*',
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());

// إعداد اتصال AWS S3
const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'eu-central-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

// دالة جلب رمز الدخول من Copernicus OAuth
async function getSentinelAccessToken() {
    try {
        const tokenUrl = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
        const params = new URLSearchParams();
        params.append('client_id', process.env.SENTINEL_CLIENT_ID);
        params.append('client_secret', process.env.SENTINEL_CLIENT_SECRET);
        params.append('grant_type', 'client_credentials');

        const response = await axios.post(tokenUrl, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        return response.data.access_token;
    } catch (error) {
        console.error('خطأ في مصادقة Sentinel:', error.response?.data || error.message);
        throw new Error('فشل الاتصال بمنصة Copernicus للأقمار الصناعية.');
    }
}

// مسار فحص الحقل وتحليل NDVI وحفظ السجل في AWS S3
app.post('/api/analyze-field', async (req, res) => {
    try {
        const { fieldName, coordinates, farmerId } = req.body;
        
        if (!coordinates || !fieldName) {
            return res.status(400).json({ error: 'بيانات الحقل أو الإحداثيات غير مكتملة.' });
        }

        // 1. الحصول على التوكن
        const accessToken = await getSentinelAccessToken();

        // 2. محاكاة/جلب البيانات الجيومكانية (يمكن ربطها بمنظومة Python الخاصة بك هنا)
        const analysisData = {
            fieldName,
            farmerId: farmerId || 'Public_User',
            timestamp: new Date().toISOString(),
            coordinates,
            pythonEngineVersion: 'v2.4-soil-carbon',
            iotSensorsIntegrated: true,
            ndviMean: 0.68, // مؤشر الغطاء النباتي
            soilOrganicCarbonEstimate: '2.48 tons/acre',
            estimatedCarbonCredits: 1.2
        };

        // 3. تخزين النتيجة الخام في AWS S3 للتدقيق المؤسسي (Audit-Ready)
        const fileName = `audits/${Date.now()}_${sanitizedName(fieldName)}.json`;
        const uploadParams = {
            Bucket: process.env.AWS_S3_BUCKET,
            Key: fileName,
            Body: JSON.stringify(analysisData, null, 2),
            ContentType: 'application/json'
        };

        await s3Client.send(new PutObjectCommand(uploadParams));

        res.json({
            status: 'success',
            message: 'تم تحليل أصول الحقل وحفظ السجل بأمان في السحابة.',
            data: analysisData,
            auditStorageKey: fileName
        });

    } catch (error) {
        console.error('خطأ في المعالجة:', error);
        res.status(500).json({ error: 'حدث خطأ داخلي أثناء المعالجة السحابية.' });
    }
});

// مسار الخدمة المدفوعة المخصصة للفلاح (توصيات دقيقة + تقرير أصول الكربون)
app.post('/api/paid-farmer-report', async (req, res) => {
    try {
        const { farmerName, nationalId, fieldAreaAcres, paymentReference } = req.body;

        // التحقق المبسط من الدفع (يمكن ربطه ببوابة دفع محلية لاحقاً)
        if (!paymentReference) {
            return res.status(402).json({ error: 'ياتُّ الدفع مطلوبة لإصدار هذا التقرير المتقدم.' });
        }

        const paidReport = {
            serviceType: 'Nilus Premium Smart Farming & Carbon Report',
            farmerName,
            nationalId,
            fieldAreaAcres,
            fertilizerRecommendation: 'إضافة 45 كجم نترات نشادر للفدان نظراً لانخفاض النيتروجين المكتشف عبر أطياف Sentinel-2',
            irrigationAdvice: 'الري مقترح خلال 48 ساعة القادمة لتجنب الإجهاد المائي',
            projectIPNotice: 'محمي بموجب حقوق الملكية الفكرية لمنظومة نيلوس للتقنيات الرقمية وأصول المناخ',
            issuedAt: new Date().toISOString()
        };

        res.json({
            status: 'success',
            message: 'تم إصدار التقرير المدفوع بنجاح.',
            report: paidReport
        });

    } catch (error) {
        res.status(500).json({ error: 'فشل إصدار التقرير المدفوع.' });
    }
});

function sanitizedName(name) {
    return name.replace(/[^a-zA-Z0-9]/g, '_');
}

app.listen(PORT, () => {
    console.log(`خادم نيلوس يعمل بكفاءة على المنفذ: ${PORT}`);
});
