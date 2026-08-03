const express = require('express');
const { verifyBucketAccess, uploadFieldAsset } = require('../services/s3Storage');

const router = express.Router();

// GET /api/storage/verify - يستبدل الدالة الوهمية اللي كانت ترجع نجاح دايماً
router.get('/verify', async (req, res) => {
  try {
    const result = await verifyBucketAccess();
    res.json(result);
  } catch (err) {
    console.error('S3 verify error:', err.message);
    res.status(502).json({ verified: false, error: 'تعذّر التحقق من صلاحيات الوصول لحاوية S3.' });
  }
});

// POST /api/storage/upload-snapshot
// body: { imageBase64, fieldId }
router.post('/upload-snapshot', express.json({ limit: '10mb' }), async (req, res) => {
  const { imageBase64, fieldId } = req.body;
  if (!imageBase64 || !fieldId) return res.status(400).json({ error: 'imageBase64 و fieldId مطلوبان' });

  try {
    const buffer = Buffer.from(imageBase64.replace(/^data:image\/png;base64,/, ''), 'base64');
    const result = await uploadFieldAsset({ buffer, contentType: 'image/png', keyPrefix: 'field-snapshots', fieldId });
    res.json(result);
  } catch (err) {
    console.error('S3 upload error:', err.message);
    res.status(502).json({ error: 'تعذّر رفع الصورة إلى S3.' });
  }
});

module.exports = router;
