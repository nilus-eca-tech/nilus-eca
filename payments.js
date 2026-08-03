const express = require('express');
const Joi = require('joi');
const { createPaymentIntention, isWebhookAuthentic } = require('../services/paymob');

const router = express.Router();

// في نظام حقيقي هذا يكون جدول DB - هنا Map مؤقتة للتوضيح فقط
const orders = new Map();

const createSchema = Joi.object({
  ownerName: Joi.string().required(),
  phone: Joi.string().required(),
  feddan: Joi.number().positive().required(),
  services: Joi.array().items(Joi.string().valid('satellite_package', 'iot_soil_sensor')).min(1).required(),
});

const PRICES = {
  satellite_package: { name: 'الباقة الفضائية المتقدمة', perFeddan: 150 },
  iot_soil_sensor: { name: 'حساسات رطوبة التربة IoT', flat: 300 },
};

// POST /api/payments/create-intention
router.post('/create-intention', async (req, res) => {
  const { error, value } = createSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const items = value.services.map((key) => {
    const p = PRICES[key];
    const priceEgp = p.perFeddan ? p.perFeddan * value.feddan : p.flat;
    return { name: p.name, priceEgp, description: key };
  });
  const amountEgp = items.reduce((sum, i) => sum + i.priceEgp, 0);
  const orderId = `NILUS-${Date.now()}`;

  try {
    const intention = await createPaymentIntention({
      amountEgp, orderId, customerName: value.ownerName, customerPhone: value.phone, items,
    });
    orders.set(orderId, { status: 'pending', amountEgp, ownerName: value.ownerName, services: value.services });
    res.json({ orderId, checkoutUrl: intention.checkoutUrl, amountEgp });
  } catch (err) {
    console.error('Paymob error:', err.response?.data || err.message);
    res.status(502).json({ error: 'تعذّر إنشاء عملية الدفع. حاول مرة أخرى.' });
  }
});

// POST /api/payments/webhook  (يُستدعى من سيرفرات Paymob بعد إتمام الدفع فعلياً)
router.post('/webhook', express.json(), (req, res) => {
  const hmacFromQuery = req.query.hmac;
  const authentic = isWebhookAuthentic(req.body.obj, hmacFromQuery, process.env.PAYMOB_HMAC_SECRET);
  if (!authentic) return res.status(401).json({ error: 'توقيع غير موثّق' });

  const orderId = req.body.obj?.order?.extras?.order_id;
  const success = req.body.obj?.success;
  if (orderId && orders.has(orderId)) {
    orders.set(orderId, { ...orders.get(orderId), status: success ? 'paid' : 'failed' });
  }
  res.sendStatus(200);
});

// GET /api/payments/status/:orderId
router.get('/status/:orderId', (req, res) => {
  const order = orders.get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  res.json(order);
});

module.exports = router;
