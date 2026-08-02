// تكامل Paymob (Accept) — بوابة الدفع الرئيسية في مصر.
// تدعم البطاقات (Visa/Mastercard) ومحافظ الموبايل (فودافون كاش/أورانج كاش) عبر نفس الـ API.
// المرجع: https://developers.paymob.com/paymob-docs/getting-started/overview
//
// التدفق المستخدم هنا هو "Intentions API" — الطريقة الحديثة الموصى بها من Paymob
// (تحل محل التدفق القديم Auth+Order+PaymentKey ثلاثي الخطوات):
//   1) الخادم ينشئ "Intention" بمبلغ ووسائل دفع محددة → يحصل على client_secret
//   2) نوجّه العميل لصفحة "Unified Checkout" المستضافة من Paymob لإتمام الدفع
//   3) Paymob يرسل Webhook للخادم بعد نجاح/فشل الدفع، ونتحقق من صحته عبر HMAC

const axios = require('axios');
const crypto = require('crypto');

const {
  PAYMOB_SECRET_KEY,
  PAYMOB_PUBLIC_KEY,
  PAYMOB_HMAC_SECRET,
  PAYMOB_BASE_URL = 'https://accept.paymob.com', // مصر — لدول أخرى غيّر النطاق (ksa/uae/oman)
  PAYMOB_CARD_INTEGRATION_ID,
  PAYMOB_WALLET_INTEGRATION_ID, // تفعيل فودافون كاش يتطلب تفعيل integration مخصص من حساب Paymob
} = process.env;

/**
 * إنشاء Intention للدفع (بطاقة + فودافون كاش معاً في نفس صفحة الدفع الموحّدة)
 * @param {object} params
 * @param {number} params.amountEGP - المبلغ بالجنيه المصري (سيتم تحويله لقروش تلقائياً)
 * @param {string} params.merchantOrderId - معرّف فريد من عندنا (نربطه بتقرير الفلاح)
 * @param {object} params.billingData - بيانات العميل (اسم، هاتف، إيميل)
 * @param {string} params.itemName - وصف الخدمة المدفوعة
 */
async function createPaymentIntention({ amountEGP, merchantOrderId, billingData, itemName }) {
  if (!PAYMOB_SECRET_KEY) {
    throw new Error('PAYMOB_SECRET_KEY غير مضبوط في .env');
  }

  const paymentMethods = [PAYMOB_CARD_INTEGRATION_ID, PAYMOB_WALLET_INTEGRATION_ID]
    .filter(Boolean)
    .map((id) => Number(id));

  if (paymentMethods.length === 0) {
    throw new Error('يجب ضبط PAYMOB_CARD_INTEGRATION_ID و/أو PAYMOB_WALLET_INTEGRATION_ID في .env');
  }

  const body = {
    amount: Math.round(amountEGP * 100), // Paymob يتعامل بالقروش (Cents)
    currency: 'EGP',
    payment_methods: paymentMethods,
    special_reference: merchantOrderId, // يُستخدم لاحقاً لربط الـ webhook بالتقرير الصحيح
    items: [
      {
        name: itemName,
        amount: Math.round(amountEGP * 100),
        description: itemName,
        quantity: 1,
      },
    ],
    billing_data: {
      first_name: billingData?.firstName || 'N/A',
      last_name: billingData?.lastName || 'N/A',
      phone_number: billingData?.phone || 'NA',
      email: billingData?.email || 'na@example.com',
      // الحقول التالية مطلوبة شكلياً من Paymob حتى لو غير متاحة فعلياً لمزارع فردي
      apartment: 'NA', floor: 'NA', street: 'NA', building: 'NA',
      city: billingData?.city || 'NA', country: 'EG', state: 'NA',
      postal_code: 'NA', shipping_method: 'NA',
    },
  };

  const resp = await axios.post(`${PAYMOB_BASE_URL}/v1/intention/`, body, {
    headers: {
      Authorization: `Token ${PAYMOB_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  return {
    clientSecret: resp.data.client_secret,
    intentionId: resp.data.id,
    checkoutUrl: `${PAYMOB_BASE_URL}/unifiedcheckout/?publicKey=${PAYMOB_PUBLIC_KEY}&clientSecret=${resp.data.client_secret}`,
  };
}

// ---------------------------------------------------------------------------
// التحقق من HMAC الخاص بـ Webhook التحويل (Transaction Processed Callback)
// المرجع: https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac
// الترتيب الثابت للحقول أدناه إلزامي (وليس أبجدياً) — هذا هو الترتيب الرسمي الموثق من Paymob،
// ويُحسب الـ HMAC بخوارزمية SHA-512.
// ⚠️ تأكد من مطابقته لتوثيق حسابك الفعلي (Dashboard → Developers → Webhooks) قبل الإنتاج،
// فبعض الحسابات القديمة/الجديدة قد تختلف قليلاً في نسخة الـ API المستخدمة.
// ---------------------------------------------------------------------------
const HMAC_FIELD_ORDER = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction',
  'id', 'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded',
  'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending',
  'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
];

function getNested(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function verifyPaymobHmac(transactionObj, receivedHmac) {
  if (!PAYMOB_HMAC_SECRET) {
    console.warn('[تحذير] PAYMOB_HMAC_SECRET غير مضبوط — لا يمكن التحقق من صحة الـ webhook!');
    return false;
  }
  const concatenated = HMAC_FIELD_ORDER
    .map((field) => {
      const v = getNested(transactionObj, field);
      return v === null || v === undefined ? '' : String(v);
    })
    .join('');

  const computed = crypto
    .createHmac('sha512', PAYMOB_HMAC_SECRET)
    .update(concatenated)
    .digest('hex');

  return computed === receivedHmac;
}

module.exports = { createPaymentIntention, verifyPaymobHmac };
