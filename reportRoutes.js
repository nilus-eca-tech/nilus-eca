const express = require('express');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { pool } = require('./db/pool');
const { buildPddPdfBuffer } = require('./reportPdf');
const { recordAuditEntry } = require('./auditLog');

const router = express.Router();
const { AWS_REGION, AWS_S3_BUCKET } = process.env;
const s3 = AWS_S3_BUCKET ? new S3Client({ region: AWS_REGION }) : null;

router.post('/generate-pdd', async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: 'projectId مطلوب' });

  const client = await pool.connect();
  try {
    const pdfBuffer = await buildPddPdfBuffer(projectId);

    let pdfS3Key = null;
    if (s3) {
      pdfS3Key = `reports/pdd/${projectId}/${Date.now()}.pdf`;
      await s3.send(new PutObjectCommand({
        Bucket: AWS_S3_BUCKET, Key: pdfS3Key, Body: pdfBuffer, ContentType: 'application/pdf',
      }));
    }

    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO generated_reports (project_id, report_type, pdf_s3_key, generated_by)
       VALUES ($1,'PDD_DRAFT',$2,$3) RETURNING id, generated_at`,
      [projectId, pdfS3Key, req.user.userId]
    );
    await recordAuditEntry(client, {
      actorUserId: req.user.userId, actorRole: req.user.role,
      action: 'GENERATE_PDD_REPORT', entityTable: 'generated_reports', entityId: rows[0].id,
      changeSummary: { projectId, pdfS3Key },
      ipAddress: req.ip,
    });
    await client.query('COMMIT');

    // نعيد ملف الـ PDF مباشرة للتحميل (بالإضافة لحفظه في S3)
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="PDD-${projectId}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('generate-pdd error:', err.message);
    res.status(500).json({ error: 'فشل توليد التقرير' });
  } finally {
    client.release();
  }
});

module.exports = router;
