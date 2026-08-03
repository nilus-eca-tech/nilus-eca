// مسارات عامة (بدون JWT) لخدمة الزراعة الذكية والحاسبة المتاحة للجمهور
// في index.html. منفصلة عمداً عن مسارات المنصة الموثّقة (satelliteRoutes,
// onboarding, vvbRoutes) التي تتطلب تسجيل دخول وترتبط بمشروع/حيازة مسجّلة
// رسمياً. أي رقم يطلع من هنا هو "تقديري إرشادي" للفلاح، وليس شهادة كربون.

const express = require('express');
const Joi = require('joi');

const { fetchNdviIntervals, extractValidIntervals } = require('../services/sentinel');
const { calculateNetCarbon } = require('../services/carbonCalculator');
const { verifyBucketAccess, uploadFieldAsset } = require('../services/s3Storage');
const { createPaymentIntention, isWebhookAuthentic } = require('../services/paymob');
const { createReport, getReport, updateReport, findByMerchantOrderId } = require('../services/reportsStore');
const { sendClimateReportEmail, sendSmartFarmingReportEmail } = require('../services/emailReport');

const router = express.Router();

// ---------------------------------------------------------------------
// 1) معاينة NDVI سريعة لحدود حقل تم رسمها على الخريطة (غير موقّعة، للعرض فقط)
// ---------------------------------------------------------------------
const ndviSchema = Joi.object({
  polygon: Joi.array().items(Joi.object({ lat: Joi.number().required(), lng: Joi.number().required() })).min(3).required(),
});

router.post('/ndvi-preview', async (req, res) => {
  const { error, value } = ndviSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const to = new Date();
    const from = new Date(to.getTime() - 15 * 24 * 3600 * 1000);
    const raw = await fetchNdviIntervals(value.polygon, from.toISOString(), to.toISOString(), 'P10D');
    const intervals = extractValidIntervals(raw);

    if (intervals.length === 0) {
      return res.status(422).json({ error: 'لا توجد قراءات NDVI صالحة حالياً (سحب كثيفة) — جرّب لاحقاً' });
    }
    res.json({ latest: intervals[intervals.length - 1], series: intervals });
  } catch (err) {
    console.error('ndvi-preview error:', err.response?.data || err.message);
    res.status(502).json({ error: 'تعذّر الاتصال بـ Sentinel Hub. حاول مرة أخرى لاحقاً.' });
  }
});

// ---------------------------------------------------------------------
// 2) تقدير الكربون (أولي، غير معتمد — راجع services/carbonCalculator.js)
// ---------------------------------------------------------------------
const carbonSchema = Joi.object({
  dieselLiters: Joi.number().min(0).default(0),
  ureaKg: Joi.number().min(0).default(0),
  electricityKwh: Joi.number().min(0).default(0),
  areaFeddan: Joi.number().min(0).required(),
  cropType: Joi.string().default('annual_default'),
  vegetationHealthBand: Joi.string().allow(null).default(null),
});

router.post('/carbon-estimate', (req, res) => {
  const { error, value } = carbonSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const result = calculateNetCarbon({
    emissionsInput: { dieselLiters: value.dieselLiters, ureaKg: value.ureaKg, electricityKwh: value.electricityKwh },
    sequestrationInput: { areaFeddan: value.areaFeddan, cropType: value.cropType, vegetationHealthBand: value.vegetationHealthBand },
  });
  res.json(result);
});

// ---------------------------------------------------------------------
// 3) تخزين S3 (لقطة الخريطة التوثيقية)
// ---------------------------------------------------------------------
router.get('/storage-verify', async (req, res) => {
  try {
    res.json(await verifyBucketAccess());
  } catch (err) {
    console.error('storage-verify error:', err.message);
    res.status(502).json({ verified: false, error: 'تعذّر التحقق من صلاحيات S3.' });
  }
});

router.post('/upload-snapshot', express.json({ limit: '10mb' }), async (req, res) => {
  const { imageBase64, fieldId } = req.body;
  if (!imageBase64 || !fieldId) return res.status(400).json({ error: 'imageBase64 و fieldId مطلوبان' });
  try {
    const buffer = Buffer.from(imageBase64.replace(/^data:image\/png;base64,/, ''), 'base64');
    res.json(await uploadFieldAsset({ buffer, contentType: 'image/png', keyPrefix: 'field-snapshots', fieldId }));
  } catch (err) {
    console.error('upload-snapshot error:', err.message);
    res.status(502).json({ error: 'تعذّر رفع الصورة.' });
  }
});

// ---------------------------------------------------------------------
// 4) الدفع (Paymob) لباقة الزراعة الذكية / حساسات IoT
// ---------------------------------------------------------------------
const PRICES = {
  satellite_package: { name: 'الباقة الفضائية المتقدمة', perFeddan: 150 },
  iot_soil_sensor: { name: 'حساسات رطوبة التربة IoT', flat: 300 },
};

const paymentSchema = Joi.object({
  ownerName: Joi.string().required(),
  phone: Joi.string().required(),
  feddan: Joi.number().positive().required(),
  cropType: Joi.string().default('غير محدد'),
  services: Joi.array().items(Joi.string().valid('satellite_package', 'iot_soil_sensor')).min(1).required(),
});

router.post('/payments/create-intention', async (req, res) => {
  const { error, value } = paymentSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const items = value.services.map((key) => {
    const p = PRICES[key];
    const priceEgp = p.perFeddan ? p.perFeddan * value.feddan : p.flat;
    return { name: p.name, priceEgp, description: key };
  });
  const amountEgp = items.reduce((sum, i) => sum + i.priceEgp, 0);
  const reportId = `NILUS-${Date.now()}`;

  try {
    const intention = await createPaymentIntention({
      amountEgp, orderId: reportId, customerName: value.ownerName, customerPhone: value.phone, items,
    });
    createReport(reportId, {
      status: 'pending_payment', priceEGP: amountEgp, cropType: value.cropType,
      customer: { firstName: value.ownerName, phone: value.phone },
    });
    res.json({ reportId, checkoutUrl: intention.checkoutUrl, amountEgp });
  } catch (err) {
    console.error('create-intention error:', err.response?.data || err.message);
    res.status(502).json({ error: 'تعذّر إنشاء عملية الدفع.' });
  }
});

// يُستدعى من سيرفرات Paymob مباشرة بعد إتمام الدفع فعلياً — هذا هو المصدر
// الوحيد الموثوق لتأكيد الدفع، وليس أي إجراء يتم من واجهة المتصفح
router.post('/payments/webhook', express.json(), async (req, res) => {
  const authentic = isWebhookAuthentic(req.body.obj, req.query.hmac, process.env.PAYMOB_HMAC);
  if (!authentic) return res.status(401).json({ error: 'توقيع غير موثّق' });

  const reportId = req.body.obj?.order?.extras?.order_id || req.body.obj?.order?.merchant_order_id;
  const success = req.body.obj?.success;
  if (!reportId) return res.sendStatus(200);

  const updated = updateReport(reportId, { status: success ? 'paid' : 'failed' });
  if (updated && success) {
    try {
      await sendSmartFarmingReportEmail(updated);
    } catch (err) {
      console.error('archive email after payment failed:', err.message);
    }
  }
  res.sendStatus(200);
});

router.get('/payments/status/:reportId', (req, res) => {
  const report = getReport(req.params.reportId);
  if (!report) return res.status(404).json({ error: 'الطلب غير موجود' });
  res.json({ status: report.status });
});

// ---------------------------------------------------------------------
// 5) إرسال تقرير الحاسبة العامة (غير المدفوعة) لبريد الشركة
// ---------------------------------------------------------------------
router.post('/send-report-email', express.json({ limit: '10mb' }), async (req, res) => {
  const { reportData, snapshotDataUrl } = req.body || {};
  if (!reportData) return res.status(400).json({ error: 'reportData مطلوب' });
  try {
    await sendClimateReportEmail(reportData, snapshotDataUrl);
    res.json({ sent: true });
  } catch (err) {
    console.error('send-report-email error:', err.message);
    res.status(502).json({ error: 'تعذّر إرسال التقرير — تأكد من إعداد SMTP في .env' });
  }
});

module.exports = router;
