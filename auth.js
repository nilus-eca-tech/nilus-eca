// نظام التوثيق (Authentication) والصلاحيات (RBAC).
// كل مستخدم يملك دوراً واحداً من: admin, field_agent, analyst, vvb_readonly
// (معرّف في قاعدة البيانات — انظر db/schema.sql). التوكن JWT يحمل الدور،
// ويتحقق middleware الصلاحيات من الدور المسموح به لكل مسار.

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { pool } = require('./db/pool');

const { JWT_SECRET, JWT_EXPIRES_IN = '8h' } = process.env;

async function login(email, password) {
  const { rows } = await pool.query(
    'SELECT id, email, password_hash, full_name, role, is_active FROM users WHERE email = $1',
    [email]
  );
  const user = rows[0];
  if (!user || !user.is_active) throw new Error('بيانات الدخول غير صحيحة');

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new Error('بيانات الدخول غير صحيحة');

  const token = jwt.sign(
    { userId: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  return { token, user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role } };
}

/** Middleware: يتحقق من صحة التوكن ويحمّل بيانات المستخدم في req.user */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'مطلوب تسجيل الدخول' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'جلسة غير صالحة أو منتهية' });
  }
}

/** Middleware factory: يقيّد الوصول لأدوار معينة فقط. الاستخدام: requireRole('admin', 'analyst') */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'مطلوب تسجيل الدخول' });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'لا تملك صلاحية الوصول لهذا المسار' });
    }
    next();
  };
}

/** Middleware صريح لحماية أي مسار كتابة من دور vvb_readonly، حتى لو حصل خطأ في requireRole */
function blockReadOnlyRole(req, res, next) {
  if (req.user?.role === 'vvb_readonly') {
    return res.status(403).json({ error: 'حساب جهة التحقق للقراءة فقط — لا يمكن التعديل على البيانات' });
  }
  next();
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

module.exports = { login, requireAuth, requireRole, blockReadOnlyRole, hashPassword };
