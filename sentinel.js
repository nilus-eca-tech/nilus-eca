const express = require('express');
const Joi = require('joi');
const { fetchNdviStatistics } = require('../services/sentinelHub');

const router = express.Router();

const schema = Joi.object({
  ring: Joi.array().items(Joi.array().items(Joi.number()).length(2)).min(4).required(),
  fromDate: Joi.string().isoDate().required(),
  toDate: Joi.string().isoDate().required(),
});

// POST /api/sentinel/ndvi
router.post('/ndvi', async (req, res) => {
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const result = await fetchNdviStatistics(value.ring, value.fromDate, value.toDate);
    res.json(result);
  } catch (err) {
    if (err.code === 'NO_VALID_NDVI') {
      return res.status(422).json({ error: err.message });
    }
    console.error('Sentinel Hub error:', err.response?.data || err.message);
    res.status(502).json({ error: 'تعذّر الاتصال بـ Sentinel Hub Statistical API. حاول مرة أخرى لاحقاً.' });
  }
});

module.exports = router;
