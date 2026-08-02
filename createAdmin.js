// شغّل هذا السكريبت مرة واحدة فقط بعد إعداد قاعدة البيانات لإنشاء أول حساب admin:
//   node scripts/createAdmin.js admin@nilus-eca.com "كلمة مرور قوية هنا" "اسم المدير"
require('dotenv').config();
const { pool } = require('../db/pool');
const { hashPassword } = require('../auth');

async function main() {
  const [, , email, password, fullName] = process.argv;
  if (!email || !password || !fullName) {
    console.log('الاستخدام: node scripts/createAdmin.js <email> <password> <fullName>');
    process.exit(1);
  }
  const passwordHash = await hashPassword(password);
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1,$2,$3,'admin') RETURNING id, email`,
    [email, passwordHash, fullName]
  );
  console.log('تم إنشاء حساب admin:', rows[0]);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
