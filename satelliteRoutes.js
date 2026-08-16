// وحدة التحليل الذاتي (Auto-Analysis) — الجزء "الموثّق" منها: كل قياس NDVI مرتبط
// بحيازة (farm) محددة، يُحفظ في S3 + قاعدة البيانات مع توقيع رقمي و checksum،
// ويُسجَّل تدقيقياً.

const express = require('express');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { pool } = require('./db/pool');
const { fetchNdviStatistics, fetchMapImageLayer, EVALSCRIPTS } = require('./sentinelHub');
const { signSatelliteRecord, sha256OfString } = require('./signing');
const { recordAuditEntry } = require('./auditLog');

const router = express.Router();
const { AWS_REGION, AWS_S3_BUCKET } = process.env;
const s3 = AWS_S3_BUCKET ? new S3Client({ region: AWS_REGION }) : null;

/**
 * مسار قياس وتوثيق NDVI للحقل
 */
router.post('/measure', async (req, res) => {
  const { farmId } = req.body;
  if (!farmId) return res.status(400).json({ error: 'farmId مطلوب' });

  const client = await pool.connect();
  try {
    const { rows: farmRows } = await client.query('SELECT * FROM farms WHERE id = $1', [farmId]);
    const farm = farmRows[0];
    if (!farm) return res.status(404).json({ error: 'الحيازة غير موجودة' });

    // تحويل إحداثيات المضلع إلى صيغة مصفوفة [lng, lat] التي يتطلبها Sentinel Hub
    const ring = farm.polygon_geojson.map((p) => [p.lng, p.lat]);
    // التأكد من إغلاق المضلع (أول نقطة تساوي آخر نقطة)
    if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
      ring.push([...ring[0]]);
    }

    const to = new Date();
    const from = new Date(to.getTime() - 15 * 24 * 3600 * 1000);
    const formatDate = (d) => d.toISOString().split('T')[0];

    // استخدام دالة fetchNdviStatistics الموحدة من ملف sentinelHub.js
    const statsResult = await fetchNdviStatistics(ring, formatDate(from), formatDate(to));
    const measurementDate = formatDate(to);

    // 1) تخزين البيانات الخام في S3 + حساب checksum
    const rawContent = JSON.stringify(statsResult, null, 2);
    const rawSha256 = sha256OfString(rawContent);
    let s3Key = null;
    if (s3) {
      s3Key = `satellite-records/${farmId}/${measurementDate}-${Date.now()}.json`;
      await s3.send(new PutObjectCommand({
        Bucket: AWS_S3_BUCKET, Key: s3Key, Body: rawContent, ContentType: 'application/json',
      }));
    }

    // 2) بناء السجل وتوقيعه رقمياً
    const methodology = 'Sentinel-2 L2A NDVI via Copernicus Statistical API (VM0042-compatible input)';
    const recordForSigning = {
      farmId, measurementDate, methodology,
      ndviMean: statsResult.ndvi, rawResponseS3Key: s3Key || 'not-archived', rawResponseSha256: rawSha256,
    };
    const signature = signSatelliteRecord(recordForSigning);

    // 3) حفظ في قاعدة البيانات + تسجيل تدقيقي — في نفس المعاملة
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO satellite_records
        (farm_id, measurement_date, methodology, ndvi_mean, raw_response_s3_key, raw_response_sha256, digital_signature)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, measurement_date, ndvi_mean`,
      [farmId, measurementDate, methodology, statsResult.ndvi, s3Key, rawSha256, signature]
    );
    const savedRecord = rows[0];

    await recordAuditEntry(client, {
      actorUserId: req.user?.userId || 1, actorRole: req.user?.role || 'ADMIN',
      action: 'CREATE_SATELLITE_RECORD', entityTable: 'satellite_records', entityId: savedRecord.id,
      changeSummary: { farmId, measurementDate, ndvi: statsResult.ndvi },
      ipAddress: req.ip,
    });
    await client.query('COMMIT');

    res.status(201).json({ record: savedRecord, signed: true, details: statsResult });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('measure error:', err.message);
    res.status(500).json({ error: err.message || 'فشل قياس وتوثيق بيانات القمر الصناعي' });
  } finally {
    client.release();
  }
});

/**
 * مسار جديد لجلب الصور المرئية (True Color, Moisture, NDWI, إلخ) وعرضها على خريطة اللوحة
 */
router.post('/map-layer', async (req, res) => {
  const { farmId, layerType, date } = req.body;
  if (!farmId || !layerType) return res.status(400).json({ error: 'farmId و layerType مطلوبان' });

  const client = await pool.connect();
  try {
    const { rows: farmRows } = await client.query('SELECT * FROM farms WHERE id = $1', [farmId]);
    const farm = farmRows[0];
    if (!farm) return res.status(404).json({ error: 'الحيازة غير موجودة' });

    const ring = farm.polygon_geojson.map((p) => [p.lng, p.lat]);
    if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
      ring.push([...ring[0]]);
    }

    const targetDate = date || new Date().toISOString().split('T')[0];
    const imageBuffer = await fetchMapImageLayer(ring, layerType, targetDate);

    res.setHeader('Content-Type', 'image/png');
    res.send(imageBuffer);
  } catch (err) {
    console.error('map-layer error:', err.message);
    res.status(500).json({ error: 'فشل جلب طبقة الخريطة المرئية' });
  } finally {
    client.release();
  }
});

module.exports = router;