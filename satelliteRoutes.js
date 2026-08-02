// وحدة التحليل الذاتي (Auto-Analysis) — الجزء "الموثّق" منها: كل قياس NDVI مرتبط
// بحيازة (farm) محددة، يُحفظ في S3 + قاعدة البيانات مع توقيع رقمي و checksum،
// ويُسجَّل تدقيقياً. هذا يختلف عن /api/ndvi العام (في server.js) المخصص للمعاينة
// السريعة غير الموثّقة في اللوحة العامة للفلاحين.

const express = require('express');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { pool } = require('./db/pool');
const { fetchNdviIntervals, extractValidIntervals } = require('./sentinel');
const { signSatelliteRecord, sha256OfString } = require('./signing');
const { recordAuditEntry } = require('./auditLog');

const router = express.Router();
const { AWS_REGION, AWS_S3_BUCKET } = process.env;
const s3 = AWS_S3_BUCKET ? new S3Client({ region: AWS_REGION }) : null;

router.post('/measure', async (req, res) => {
  const { farmId } = req.body;
  if (!farmId) return res.status(400).json({ error: 'farmId مطلوب' });

  const client = await pool.connect();
  try {
    const { rows: farmRows } = await client.query('SELECT * FROM farms WHERE id = $1', [farmId]);
    const farm = farmRows[0];
    if (!farm) return res.status(404).json({ error: 'الحيازة غير موجودة' });

    const polygon = farm.polygon_geojson.map((p) => ({ lat: p.lat, lng: p.lng }));
    const to = new Date();
    const from = new Date(to.getTime() - 15 * 24 * 3600 * 1000);

    const raw = await fetchNdviIntervals(polygon, from.toISOString(), to.toISOString(), 'P10D');
    const intervals = extractValidIntervals(raw);
    if (intervals.length === 0) {
      return res.status(200).json({ message: 'لا توجد مشاهد صافية من الغيوم حالياً — أعد المحاولة لاحقاً' });
    }
    const latest = intervals[intervals.length - 1];

    // 1) تخزين الاستجابة الخام في S3 + حساب checksum
    const rawContent = JSON.stringify(raw, null, 2);
    const rawSha256 = sha256OfString(rawContent);
    let s3Key = null;
    if (s3) {
      s3Key = `satellite-records/${farmId}/${latest.date}-${Date.now()}.json`;
      await s3.send(new PutObjectCommand({
        Bucket: AWS_S3_BUCKET, Key: s3Key, Body: rawContent, ContentType: 'application/json',
      }));
    }

    // 2) بناء السجل وتوقيعه رقمياً
    const methodology = 'Sentinel-2 L2A NDVI via Copernicus Statistical API (VM0042-compatible input)';
    const recordForSigning = {
      farmId, measurementDate: latest.date, methodology,
      ndviMean: latest.ndvi, rawResponseS3Key: s3Key || 'not-archived', rawResponseSha256: rawSha256,
    };
    const signature = signSatelliteRecord(recordForSigning);

    // 3) حفظ في قاعدة البيانات + تسجيل تدقيقي — في نفس المعاملة
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO satellite_records
        (farm_id, measurement_date, methodology, ndvi_mean, raw_response_s3_key, raw_response_sha256, digital_signature)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, measurement_date, ndvi_mean`,
      [farmId, latest.date, methodology, latest.ndvi, s3Key, rawSha256, signature]
    );
    const savedRecord = rows[0];

    await recordAuditEntry(client, {
      actorUserId: req.user.userId, actorRole: req.user.role,
      action: 'CREATE_SATELLITE_RECORD', entityTable: 'satellite_records', entityId: savedRecord.id,
      changeSummary: { farmId, measurementDate: latest.date, ndvi: latest.ndvi },
      ipAddress: req.ip,
    });
    await client.query('COMMIT');

    res.status(201).json({ record: savedRecord, signed: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('measure error:', err.message);
    res.status(500).json({ error: 'فشل قياس وتوثيق بيانات القمر الصناعي' });
  } finally {
    client.release();
  }
});

module.exports = router;
