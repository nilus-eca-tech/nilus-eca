// ⚠️ هذا مخزن بسيط قائم على ملف JSON محلي — مناسب للتجربة والتطوير فقط.
// في الإنتاج الحقيقي (خصوصاً مع تعدد نسخ الخادم أو النشر على منصات بدون تخزين دائم
// مثل بعض إعدادات Render/Railway) استبدله بقاعدة بيانات حقيقية (Postgres/MongoDB/SQLite
// مع volume دائم). البنية هنا (get/set/list حسب reportId) مصممة لتسهل الاستبدال لاحقاً.

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'reports-db.json');

function readAll() {
  if (!fs.existsSync(DB_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeAll(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function createReport(reportId, initialData) {
  const all = readAll();
  all[reportId] = { ...initialData, reportId, createdAt: new Date().toISOString() };
  writeAll(all);
  return all[reportId];
}

function getReport(reportId) {
  const all = readAll();
  return all[reportId] || null;
}

function updateReport(reportId, patch) {
  const all = readAll();
  if (!all[reportId]) return null;
  all[reportId] = { ...all[reportId], ...patch, updatedAt: new Date().toISOString() };
  writeAll(all);
  return all[reportId];
}

function findByMerchantOrderId(merchantOrderId) {
  const all = readAll();
  return Object.values(all).find((r) => r.reportId === merchantOrderId) || null;
}

module.exports = { createReport, getReport, updateReport, findByMerchantOrderId };
