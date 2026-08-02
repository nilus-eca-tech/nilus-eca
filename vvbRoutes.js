// لوحة VVB (Validation & Verification Body) — كل المسارس هنا GET فقط، لا يوجد
// أي مسار كتابة على الإطلاق في هذا الملف. الحماية مزدوجة:
//   1) على مستوى التطبيق: requireRole('vvb_readonly', 'admin') في server.js
//   2) على مستوى قاعدة البيانات: دور Postgres منفصل بصلاحية SELECT فقط (انظر db/schema.sql)

const express = require('express');
const { pool } = require('./db/pool');
const { verifyChainIntegrity } = require('./auditLog');
const { verifySatelliteRecordSignature } = require('./signing');

const router = express.Router();

router.get('/projects', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, project_name, methodology, association_name, status, created_at FROM projects ORDER BY created_at DESC'
  );
  res.json({ projects: rows });
});

router.get('/farms/:projectId', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, owner_name, area_feddan, crop_type, created_at FROM farms WHERE project_id = $1 ORDER BY created_at DESC',
    [req.params.projectId]
  );
  res.json({ farms: rows });
});

// سجلات الأقمار الصناعية + حالة التحقق من كل توقيع رقمي (يُعاد حسابه هنا مباشرة،
// وليس فقط "موثوق به" — هذا هو معنى Audit-Ready الفعلي)
router.get('/satellite-records/:farmId', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, farm_id, measurement_date, methodology, ndvi_mean,
            raw_response_s3_key, raw_response_sha256, digital_signature, signed_at
     FROM satellite_records WHERE farm_id = $1 ORDER BY measurement_date ASC`,
    [req.params.farmId]
  );

  const recordsWithVerification = rows.map((r) => {
    const isValid = verifySatelliteRecordSignature(
      {
        farmId: r.farm_id, measurementDate: r.measurement_date.toISOString().slice(0, 10),
        methodology: r.methodology, ndviMean: Number(r.ndvi_mean),
        rawResponseS3Key: r.raw_response_s3_key, rawResponseSha256: r.raw_response_sha256,
      },
      r.digital_signature
    );
    return { ...r, signature_verified: isValid };
  });

  res.json({ records: recordsWithVerification });
});

// عرض سجل التدقيق الكامل (بدون أي إمكانية تعديل — القراءة فقط)
router.get('/audit-log', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const { rows } = await pool.query(
    `SELECT al.id, al.occurred_at, al.action, al.entity_table, al.entity_id,
            al.change_summary, u.email as actor_email, al.actor_role
     FROM audit_log al LEFT JOIN users u ON u.id = al.actor_user_id
     ORDER BY al.id DESC LIMIT $1`,
    [limit]
  );
  res.json({ auditLog: rows });
});

// التحقق من سلامة سلسلة سجل التدقيق بالكامل (يكتشف أي تلاعب محتمل فوراً)
router.get('/verify-integrity', async (req, res) => {
  const result = await verifyChainIntegrity();
  res.json(result);
});

module.exports = router;
