const express = require('express');
const Joi = require('joi');
const { sendClimateReport } = require('../services/mailer');

const router = express.Router();

const schema = Joi.object({
  ownerName: Joi.string().required(),
  locationName: Joi.string().allow('').required(),
  feddan: Joi.number().min(0).required(),
  ndvi: Joi.number().min(0).max(1).required(),
  netCarbon: Joi.number().required(),
  paidServicesTotal: Joi.number().min(0).default(0),
  snapshotUrl: Joi.string().uri().allow(null, ''),
});

// POST /api/reports/send
router.post('/send', async (req, res) => {
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    await sendClimateReport(value);
    res.json({ sent: true });
  } catch (err) {
    console.error('Mailer error:', err.message);
    res.status(502).json({ error: 'تعذّر إرسال التقرير بالبريد.' });
  }
});

module.exports = router;
