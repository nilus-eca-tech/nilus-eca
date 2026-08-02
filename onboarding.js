// وحدة التسجيل (Onboarding): إدارة المشروعات والجمعيات الزراعية والحيازات.
// كل عملية إنشاء هنا تُسجَّل تلقائياً في سجل التدقيق ضمن نفس المعاملة (transaction)،
// بحيث يستحيل أن ينجح إدخال بيانات دون أن يُسجَّل تدقيقياً.

const express = require('express');
const { pool } = require('./db/pool');
const { recordAuditEntry } = require('./auditLog');

const router = express.Router();

router.post('/projects', async (req, res) => {
  const { projectName, methodology = 'VM0042', associationName } = req.body;
  if (!projectName) return res.status(400).json({ error: 'اسم المشروع مطلوب' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO projects (project_name, methodology, association_name, created_by)
       VALUES ($1,$2,$3,$4) RETURNING id, project_name, methodology, status, created_at`,
      [projectName, methodology, associationName || null, req.user.userId]
    );
    const project = rows[0];

    await recordAuditEntry(client, {
      actorUserId: req.user.userId, actorRole: req.user.role,
      action: 'CREATE_PROJECT', entityTable: 'projects', entityId: project.id,
      changeSummary: { projectName, methodology, associationName },
      ipAddress: req.ip,
    });

    await client.query('COMMIT');
    res.status(201).json({ project });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('create project error:', err.message);
    res.status(500).json({ error: 'فشل إنشاء المشروع' });
  } finally {
    client.release();
  }
});

router.post('/farms', async (req, res) => {
  const { projectId, ownerName, polygon, areaFeddan, cropType } = req.body;
  if (!projectId || !ownerName || !Array.isArray(polygon) || polygon.length < 3) {
    return res.status(400).json({ error: 'projectId و ownerName وحدود الحقل (polygon) مطلوبة' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO farms (project_id, owner_name, polygon_geojson, area_feddan, crop_type, registered_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, owner_name, area_feddan, crop_type, created_at`,
      [projectId, ownerName, JSON.stringify(polygon), areaFeddan || null, cropType || null, req.user.userId]
    );
    const farm = rows[0];

    await recordAuditEntry(client, {
      actorUserId: req.user.userId, actorRole: req.user.role,
      action: 'CREATE_FARM', entityTable: 'farms', entityId: farm.id,
      changeSummary: { projectId, ownerName, areaFeddan, cropType },
      ipAddress: req.ip,
    });

    await client.query('COMMIT');
    res.status(201).json({ farm });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('create farm error:', err.message);
    res.status(500).json({ error: 'فشل تسجيل الحيازة' });
  } finally {
    client.release();
  }
});

router.get('/projects', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, project_name, methodology, status, created_at FROM projects ORDER BY created_at DESC'
  );
  res.json({ projects: rows });
});

module.exports = router;
