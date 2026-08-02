// توقيع رقمي (HMAC-SHA256) لكل سجل بيانات قمر صناعي — يربط القياس بـ Metadata
// (تاريخ القياس، المنهجية، checksum الاستجابة الخام) بطريقة يمكن التحقق منها لاحقاً
// دون طلب بيانات إضافية من جهة التحقق (VVB), تماشياً مع متطلبات "Audit-Ready".
//
// ⚠️ هذا توقيع HMAC متماثل (نفس المفتاح للتوقيع والتحقق) — مناسب للتحقق الداخلي بين
// مكونات نظامك (يثبت أن البيانات لم تتغيّر منذ حفظها). لو احتجت توقيعاً يمكن لطرف
// خارجي (VVB) التحقق منه دون الوصول لمفتاحك السري، فالخطوة التالية الصحيحة هي التوقيع
// بمفتاح غير متماثل (RSA/ECDSA) ونشر المفتاح العام فقط — أضفها لاحقاً إذا طلبت جهة
// التحقق ذلك تحديداً.

const crypto = require('crypto');

const { SATELLITE_SIGNING_SECRET } = process.env;

function canonicalize(record) {
  // ترتيب الحقول ثابت ومعروف — أي تغيير في أي حقل يُغيّر الناتج بالكامل
  return JSON.stringify({
    farmId: record.farmId,
    measurementDate: record.measurementDate,
    methodology: record.methodology,
    ndviMean: record.ndviMean,
    rawResponseS3Key: record.rawResponseS3Key,
    rawResponseSha256: record.rawResponseSha256,
  });
}

function signSatelliteRecord(record) {
  if (!SATELLITE_SIGNING_SECRET) {
    throw new Error('SATELLITE_SIGNING_SECRET غير مضبوط في .env');
  }
  return crypto
    .createHmac('sha256', SATELLITE_SIGNING_SECRET)
    .update(canonicalize(record))
    .digest('hex');
}

function verifySatelliteRecordSignature(record, signature) {
  const expected = signSatelliteRecord(record);
  // مقارنة بزمن ثابت (timing-safe) لمنع هجمات قياس التوقيت
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sha256OfString(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

module.exports = { signSatelliteRecord, verifySatelliteRecordSignature, sha256OfString };
