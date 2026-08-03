const axios = require('axios');

const BASE = process.env.PAYMOB_API_BASE;

/**
 * ينشئ "Payment Intention" حقيقية عبر Paymob Unified Intention API
 * ويرجع رابط دفع (checkout URL) يقدر المزارع يدفع من خلاله ببطاقة
 * أو فودافون كاش، مع تتبّع حقيقي لحالة الدفع بعدين عبر webhook.
 *
 * هذا يستبدل الزر القديم اللي كان مجرد alert() يقول للمستخدم
 * "حوّل يدوياً على رقم المحفظة" بدون أي تحقق فعلي من حدوث الدفع.
 */
async function createPaymentIntention({ amountEgp, orderId, customerName, customerPhone, items }) {
  const { data } = await axios.post(
    `${BASE}/v1/intention/`,
    {
      amount: Math.round(amountEgp * 100), // Paymob يتعامل بالقروش
      currency: 'EGP',
      payment_methods: ['card', 'vodafone_cash'],
      items: items.map((i) => ({
        name: i.name,
        amount: Math.round(i.priceEgp * 100),
        description: i.description,
        quantity: 1,
      })),
      billing_data: {
        first_name: customerName?.split(' ')[0] || 'مزارع',
        last_name: customerName?.split(' ').slice(1).join(' ') || 'معتمد',
        phone_number: customerPhone || '+201000000000',
        email: 'na@nilus-eca.com',
        country: 'EG',
      },
      extras: { order_id: orderId },
    },
    {
      headers: {
        Authorization: `Token ${process.env.PAYMOB_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );

  return {
    clientSecret: data.client_secret,
    checkoutUrl: `https://accept.paymob.com/unifiedcheckout/?publicKey=${process.env.PAYMOB_PUBLIC_KEY}&clientSecret=${data.client_secret}`,
    intentionId: data.id,
  };
}

/**
 * التحقق من توقيع الـ webhook القادم من Paymob قبل تأكيد أي دفعة.
 * لازم تتأكد من الـ HMAC قبل ما تعتبر أي طلب "مدفوع فعلاً".
 */
function isWebhookAuthentic(payload, receivedHmac, hmacSecret) {
  const crypto = require('crypto');
  const orderedFields = [
    'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction',
    'id', 'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded',
    'is_standalone_payment', 'is_voided', 'order', 'owner', 'pending', 'source_data.pan',
    'source_data.sub_type', 'source_data.type', 'success',
  ];
  const concatenated = orderedFields.map((f) => f.split('.').reduce((o, k) => o?.[k], payload)).join('');
  const computed = crypto.createHmac('sha512', hmacSecret).update(concatenated).digest('hex');
  return computed === receivedHmac;
}

module.exports = { createPaymentIntention, isWebhookAuthentic };
