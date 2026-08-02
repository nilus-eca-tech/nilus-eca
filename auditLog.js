// سجل تدقيق متسلسل (hash-chained) — كل سجل يحمل hash السجل السابق، فأي محاولة
// تعديل سجل قديم بعد كتابته تكسر السلسلة ويمكن اكتشافها بسهولة عبر verifyChainIntegrity().
// هذا ليس "Blockchain" بالمعنى الموزّع الكامل، لكنه يحقق نفس الهدف العملي المطلوب هنا:
// إثبات عدم التلاعب بسجل تاريخي دون الحاجة لبنية تحتية موزّعة معقّدة.

const crypto = require('crypto');
const { pool } = require('./db/pool');

function computeHash({ occurred_at, actor_user_id, action, entity_table, entity_id, change_summary, previous_record_hash }) {
  const canonical = JSON.stringify({
    occurred_at, actor_user_id, action, entity_table, entity_id, change_summary, previous_record_hash,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * يسجّل عملية في سجل التدقيق. يجب استدعاؤها من داخل نفس المعاملة (transaction) التي
 * تنفّذ التعديل الفعلي على البيانات، بحيث لا يمكن لعملية تعديل أن تنجح دون تسجيل تدقيقي مرافق.
 */
async function recordAuditEntry(client, { actorUserId, actorRole, action, entityTable, entityId, changeSummary, ipAddress }) {
  const { rows } = await client.query(
    'SELECT record_hash FROM audit_log ORDER BY id DESC LIMIT 1'
  );
  const previousHash = rows[0]?.record_hash || '0'.repeat(64); // القيمة الأولى في السلسلة (genesis)

  const occurredAt = new Date().toISOString();
  const recordHash = computeHash({
    occurred_at: occurredAt, actor_user_id: actorUserId, action,
    entity_table: entityTable, entity_id: entityId, change_summary: changeSummary,
    previous_record_hash: previousHash,
  });

  await client.query(
    `INSERT INTO audit_log
      (occurred_at, actor_user_id, actor_role, action, entity_table, entity_id, change_summary, ip_address, previous_record_hash, record_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [occurredAt, actorUserId, actorRole, action, entityTable, entityId, changeSummary, ipAddress, previousHash, recordHash]
  );
}

/** يتحقق من سلامة السلسلة بالكامل — شغّلها دورياً (مثلاً يومياً) أو عند أي شك في التلاعب */
async function verifyChainIntegrity() {
  const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY id ASC');
  let expectedPrevious = '0'.repeat(64);

  for (const row of rows) {
    if (row.previous_record_hash !== expectedPrevious) {
      return { valid: false, brokenAtId: row.id, reason: 'previous_record_hash لا يطابق السجل السابق' };
    }
    const recomputed = computeHash({
      occurred_at: row.occurred_at.toISOString(), actor_user_id: row.actor_user_id,
      action: row.action, entity_table: row.entity_table, entity_id: row.entity_id,
      change_summary: row.change_summary, previous_record_hash: row.previous_record_hash,
    });
    if (recomputed !== row.record_hash) {
      return { valid: false, brokenAtId: row.id, reason: 'record_hash لا يطابق محتوى السجل — احتمال تلاعب' };
    }
    expectedPrevious = row.record_hash;
  }
  return { valid: true, totalRecords: rows.length };
}

/** Express middleware بسيط: يسجّل تلقائياً أي طلب كتابة (POST/PUT/PATCH/DELETE) بعد نجاحه */
function auditMiddleware(action, entityTable, getEntityId = (req, res) => req.params.id || 'n/a') {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = async (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const client = await pool.connect();
        try {
          await recordAuditEntry(client, {
            actorUserId: req.user?.userId || null,
            actorRole: req.user?.role || null,
            action, entityTable,
            entityId: String(getEntityId(req, res, body)),
            changeSummary: { method: req.method, path: req.path }, // ملخص مختصر — لا نخزن جسم الطلب كاملاً هنا تجنباً لتخزين بيانات حساسة مكررة
            ipAddress: req.ip,
          });
        } catch (err) {
          console.error('[Audit] فشل تسجيل عملية تدقيق:', err.message);
        } finally {
          client.release();
        }
      }
      return originalJson(body);
    };
    next();
  };
}

module.exports = { recordAuditEntry, verifyChainIntegrity, auditMiddleware };
