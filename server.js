// خادم Nilus ECA — يجمع:
//   - Sentinel Hub NDVI (معاينة عامة غير موثّقة + قياس موثّق مرتبط بحيازة)
//   - AWS S3 لأرشفة البيانات الخام
//   - Paymob لخدمة الزراعة الذكية المدفوعة
//   - طبقة الامتثال: توثيق (JWT) + صلاحيات (RBAC) + سجل تدقيق متسلسل + توقيع رقمي
//     لبيانات الأقمار الصناعية + لوحة VVB للقراءة فقط + توليد تقارير PDD

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const { fetchNdviIntervals, extractValidIntervals } = require('./sentinel');
const { createPaymentIntention, verifyPaymobHmac } = require('./paymob');
const { generateSmartFarmingReport } = require('./smartFarming');
const reportsStore = require('./reportsStore');

const { login, requireAuth, requireRole, blockReadOnlyRole } = require('./auth');
const { auditMiddleware } = require('./auditLog');
const onboardingRoutes = require('./onboarding');
const satelliteRoutes = require('./satelliteRoutes');
const vvbRoutes = require('./vvbRoutes');
const reportRoutes = require('./reportRoutes');

const app = express();

const {
  SENTINEL_CLIENT_ID, SENTINEL_CLIENT_SECRET,
  AWS_REGION, AWS_S3_BUCKET,
  PORT = 3001, FRONTEND_ORIGIN,
  SMART_REPORT_PRICE_EGP = 150,
} = process.env;

if (!SENTINEL_CLIENT_ID || !SENTINEL_CLIENT_SECRET) {
  console.warn('[تحذير] SENTINEL_CLIENT_ID / SENTINEL_CLIENT_SECRET غير مضبوطين في .env');
}

app.use(cors({ origin: FRONTEND_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

const s3 = AWS_S3_BUCKET ? new S3Client({ region: AWS_REGION }) : null;

// ===========================================================================
// المصادقة
// ===========================================================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await login(email, password);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ===========================================================================
// اللوحة العامة (بدون تسجيل دخول) — نفس سلوك النسخة السابقة، للمعاينة السريعة فقط
// وليست جزءاً من السجل الموثّق رسمياً (استخدم /api/satellite/measure لذلك)
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
      s3Key = `ndvi-preview/${new Date().toISOString().slice(0, 10)}/${Date.now()}.json`;
      await s3.send(new PutObjectCommand({
        Bucket: AWS_S3_BUCKET, Key: s3Key, Body: JSON.stringify(raw, null, 2), ContentType: 'application/json',
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
// خدمة الزراعة الذكية المدفوعة (Paymob) — بدون تغيير عن النسخة السابقة
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
      status: 'pending_payment', polygon, cropType: cropType || 'default', centerLat, centerLng,
      customer: customer || {}, priceEGP: Number(SMART_REPORT_PRICE_EGP),
    });
    const { clientSecret, checkoutUrl } = await createPaymentIntention({
      amountEGP: Number(SMART_REPORT_PRICE_EGP), merchantOrderId: reportId,
      billingData: { firstName: customer?.firstName, lastName: customer?.lastName, phone: customer?.phone, email: customer?.email },
      itemName: 'تقرير الزراعة الذكية — Nilus ECA',
    });
    reportsStore.updateReport(reportId, { paymobClientSecret: clientSecret });
    res.json({ reportId, checkoutUrl, priceEGP: Number(SMART_REPORT_PRICE_EGP) });
  } catch (err) {
    console.error('create-payment error:', err.response?.data || err.message);
    res.status(500).json({ error: 'فشل إنشاء طلب الدفع', detail: err.response?.data || err.message });
  }
});

app.post('/api/webhooks/paymob', async (req, res) => {
  try {
    const receivedHmac = req.query.hmac;
    const transaction = req.body.obj;
    if (!transaction) return res.status(400).json({ error: 'صيغة webhook غير متوقعة' });

    if (!verifyPaymobHmac(transaction, receivedHmac)) {
      console.error('[أمان] HMAC غير صحيح — تم رفض webhook مشبوه');
      return res.status(401).json({ error: 'HMAC غير صالح' });
    }

    const reportId = transaction.order?.merchant_order_id || transaction.special_reference;
    const report = reportsStore.getReport(reportId);
    if (!report) return res.status(404).json({ error: 'الطلب غير موجود' });

    if (transaction.success === true || transaction.success === 'true') {
      reportsStore.updateReport(reportId, { status: 'paid' });
      try {
        const reportData = await generateSmartFarmingReport({
          polygon: report.polygon, cropType: report.cropType, centerLat: report.centerLat, centerLng: report.centerLng,
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

app.get('/api/smart-farming/report/:reportId', (req, res) => {
  const report = reportsStore.getReport(req.params.reportId);
  if (!report) return res.status(404).json({ error: 'الطلب غير موجود' });
  res.json({ status: report.status, reportData: report.reportData || null, error: report.error || null });
});

// ===========================================================================
// المسارات المحمية (تتطلب تسجيل دخول) — الترتيب هنا مهم: requireAuth أولاً،
// ثم blockReadOnlyRole (يمنع vvb_readonly من أي مسار كتابة قبل الوصول للمنطق أصلاً)
// ===========================================================================

// وحدة التسجيل (Onboarding) — admin و field_agent فقط يمكنهم الإضافة
app.use('/api/onboarding',
  requireAuth, blockReadOnlyRole, requireRole('admin', 'field_agent'),
  auditMiddleware('ONBOARDING_ACTION', 'onboarding'),
  onboardingRoutes);

// وحدة التحليل الذاتي الموثّق — admin و analyst فقط
app.use('/api/satellite',
  requireAuth, blockReadOnlyRole, requireRole('admin', 'analyst'),
  satelliteRoutes);

// وحدة التقارير — admin و analyst فقط
app.use('/api/reports',
  requireAuth, blockReadOnlyRole, requireRole('admin', 'analyst'),
  reportRoutes);

// لوحة VVB — قراءة فقط، لدور vvb_readonly أو admin (للمراجعة الداخلية)
app.use('/api/vvb',
  requireAuth, requireRole('vvb_readonly', 'admin'),
  vvbRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`Nilus ECA backend يعمل على المنفذ :${PORT}`));
