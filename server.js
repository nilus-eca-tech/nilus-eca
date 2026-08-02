// خادم خلفي وسيط: يستقبل حدود الحقل (Polygon) من واجهة Nilus ECA،
// يستدعي Copernicus Sentinel Hub Statistical API فعلياً للحصول على NDVI،
// يخزّن الاستجابة الخام في AWS S3 للتدقيق، ويدير خدمة "الزراعة الذكية" المدفوعة
// عبر Paymob (بطاقات + فودافون كاش).
//
// لماذا خادم وسيط ولا نتصل من المتصفح مباشرة؟
// لأن Client Secret الخاص بـ Sentinel Hub، مفاتيح AWS، ومفاتيح Paymob السرية يجب
// ألا تظهر أبداً في كود يعمل على جهاز المستخدم.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const { fetchNdviIntervals, extractValidIntervals } = require('./sentinel');
const { createPaymentIntention, verifyPaymobHmac } = require('./paymob');
const { generateSmartFarmingReport } = require('./smartFarming');
const reportsStore = require('./reportsStore');

const app = express();

const {
  SENTINEL_CLIENT_ID,
  SENTINEL_CLIENT_SECRET,
  AWS_REGION,
  AWS_S3_BUCKET,
  PORT = 3001,
  FRONTEND_ORIGIN,
  SMART_REPORT_PRICE_EGP = 150,
} = process.env;

if (!SENTINEL_CLIENT_ID || !SENTINEL_CLIENT_SECRET) {
  console.warn('[تحذير] SENTINEL_CLIENT_ID / SENTINEL_CLIENT_SECRET غير مضبوطين في .env');
}

app.use(cors({ origin: FRONTEND_ORIGIN || '*' })); // في الإنتاج: حدد FRONTEND_ORIGIN بدل '*'
app.use(express.json({ limit: '2mb' }));

const s3 = AWS_S3_BUCKET ? new S3Client({ region: AWS_REGION }) : null;

// ===========================================================================
// 1) POST /api/ndvi — القيمة الحالية (تستخدمها لوحة المزارع المجانية الأصلية)
// body: { polygon: [{lat, lng}, ...], from?, to? }
// ===========================================================================
app.post('/api/ndvi', async (req, res) => {
  try {
    const { polygon, from, to } = req.body;
    if (!Array.isArray(polygon) || polygon.length < 3) {
      return res.status(400).json({ error: 'يجب إرسال حدود حقل (polygon) بثلاث نقاط GPS على الأقل' });
    }

    const fromDate = from || new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString();
    const toDate = to || new Date().toISOString();

    const raw = await fetchNdviIntervals(polygon, fromDate, toDate, 'P10D');

    let s3Key = null;
    if (s3) {
      s3Key = `ndvi-statistics/${new Date().toISOString().slice(0, 10)}/${Date.now()}.json`;
      await s3.send(new PutObjectCommand({
        Bucket: AWS_S3_BUCKET, Key: s3Key,
        Body: JSON.stringify(raw, null, 2), ContentType: 'application/json',
      }));
    }

    const intervals = extractValidIntervals(raw);
    if (intervals.length === 0) {
      return res.json({ ndvi: null, message: 'لا توجد مشاهد خالية من الغيوم في الفترة المطلوبة', s3Key });
    }
    const latest = intervals[intervals.length - 1];
    res.json({ ndvi: latest.ndvi, date: latest.date, s3Key });
  } catch (err) {
    console.error('NDVI fetch error:', err.response?.data || err.message);
    res.status(500).json({ error: 'فشل الاتصال بـ Sentinel Hub أو AWS S3', detail: err.response?.data || err.message });
  }
});

// ===========================================================================
// 2) POST /api/smart-farming/create-payment
// إنشاء طلب دفع Paymob لتقرير الزراعة الذكية (بطاقة أو فودافون كاش)
// body: { polygon, cropType, centerLat, centerLng, customer: {firstName,lastName,phone,email} }
// ===========================================================================
app.post('/api/smart-farming/create-payment', async (req, res) => {
  try {
    const { polygon, cropType, centerLat, centerLng, customer } = req.body;

    if (!Array.isArray(polygon) || polygon.length < 3) {
      return res.status(400).json({ error: 'يجب رسم حدود الحقل أولاً' });
    }
    if (centerLat == null || centerLng == null) {
      return res.status(400).json({ error: 'إحداثيات مركز الحقل مطلوبة لحساب بيانات الطقس' });
    }

    const reportId = crypto.randomUUID();

    reportsStore.createReport(reportId, {
      status: 'pending_payment',
      polygon, cropType: cropType || 'default', centerLat, centerLng,
      customer: customer || {},
      priceEGP: Number(SMART_REPORT_PRICE_EGP),
    });

    const { clientSecret, checkoutUrl } = await createPaymentIntention({
      amountEGP: Number(SMART_REPORT_PRICE_EGP),
      merchantOrderId: reportId,
      billingData: {
        firstName: customer?.firstName, lastName: customer?.lastName,
        phone: customer?.phone, email: customer?.email,
      },
      itemName: 'تقرير الزراعة الذكية — Nilus ECA',
    });

    reportsStore.updateReport(reportId, { paymobClientSecret: clientSecret });

    res.json({ reportId, checkoutUrl, priceEGP: Number(SMART_REPORT_PRICE_EGP) });
  } catch (err) {
    console.error('create-payment error:', err.response?.data || err.message);
    res.status(500).json({ error: 'فشل إنشاء طلب الدفع', detail: err.response?.data || err.message });
  }
});

// ===========================================================================
// 3) POST /api/webhooks/paymob — يستقبله Paymob بعد نجاح/فشل الدفع
// يجب ضبط هذا الرابط في Paymob Dashboard → Developers → Payment Integrations
// ===========================================================================
app.post('/api/webhooks/paymob', async (req, res) => {
  try {
    const receivedHmac = req.query.hmac;
    const transaction = req.body.obj; // Paymob يرسل بيانات التحويل داخل obj

    if (!transaction) {
      return res.status(400).json({ error: 'صيغة webhook غير متوقعة' });
    }

    const isValid = verifyPaymobHmac(transaction, receivedHmac);
    if (!isValid) {
      console.error('[أمان] HMAC غير صحيح — تم رفض webhook مشبوه');
      return res.status(401).json({ error: 'HMAC غير صالح' });
    }

    const reportId = transaction.order?.merchant_order_id || transaction.special_reference;
    const report = reportsStore.getReport(reportId);
    if (!report) {
      console.error('لم يتم العثور على تقرير مطابق لـ:', reportId);
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    if (transaction.success === true || transaction.success === 'true') {
      reportsStore.updateReport(reportId, { status: 'paid' });

      // نولّد التقرير فوراً بعد تأكيد الدفع الناجح فقط
      try {
        const reportData = await generateSmartFarmingReport({
          polygon: report.polygon, cropType: report.cropType,
          centerLat: report.centerLat, centerLng: report.centerLng,
        });
        reportsStore.updateReport(reportId, { status: 'ready', reportData });
      } catch (genErr) {
        console.error('فشل توليد التقرير بعد الدفع:', genErr.message);
        reportsStore.updateReport(reportId, { status: 'payment_ok_generation_failed', error: genErr.message });
      }
    } else {
      reportsStore.updateReport(reportId, { status: 'payment_failed' });
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('paymob webhook error:', err.message);
    res.status(500).json({ error: 'خطأ في معالجة webhook' });
  }
});

// ===========================================================================
// 4) GET /api/smart-farming/report/:reportId — الواجهة تستطلع (poll) هذا المسار
// بعد إعادة توجيه العميل من Paymob، لمعرفة حالة الدفع وجلب التقرير عند جاهزيته
// ===========================================================================
app.get('/api/smart-farming/report/:reportId', (req, res) => {
  const report = reportsStore.getReport(req.params.reportId);
  if (!report) return res.status(404).json({ error: 'الطلب غير موجود' });

  res.json({
    status: report.status, // pending_payment | paid | ready | payment_failed | payment_ok_generation_failed
    reportData: report.reportData || null,
    error: report.error || null,
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`Nilus ECA backend يعمل على المنفذ :${PORT}`));
