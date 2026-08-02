// وحدة إرسال التقارير إلى بريد الشركة عبر SMTP (nodemailer).
// تُستخدم من مسارين:
//   1) POST /api/send-report-email — تقرير حاسبة أصول المناخ (مُدخل يدوياً من الواجهة، غير معتمد رسمياً)
//   2) داخلياً بعد نجاح الدفع في خدمة الزراعة الذكية — نسخة تلقائية لكل تقرير مدفوع تُرسل للأرشيف
//
// الإعداد (راجع .env.example):
//   SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS
//   COMPANY_REPORT_EMAIL — البريد الذي تصل إليه كل التقارير (افتراضياً waadnasr144@gmail.com)
//
// ملاحظة عن Gmail: إذا كان SMTP_USER بريد Gmail، Google تطلب "App Password" مخصص
// (وليس كلمة مرور الحساب العادية) — يُنشأ من: myaccount.google.com/apppasswords
// (يتطلب تفعيل التحقق بخطوتين على الحساب أولاً).

const nodemailer = require('nodemailer');

const {
  SMTP_HOST = 'smtp.gmail.com',
  SMTP_PORT = 465,
  SMTP_SECURE = 'true',
  SMTP_USER,
  SMTP_PASS,
  COMPANY_REPORT_EMAIL = 'waadnasr144@gmail.com',
} = process.env;

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP_USER / SMTP_PASS غير مضبوطين في .env — لا يمكن إرسال البريد');
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: String(SMTP_SECURE) === 'true', // true لمنفذ 465، false لمنفذ 587 (STARTTLS)
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

/**
 * تنسيق رقم بفواصل الآلاف (لعرض أفضل في الإيميل)
 */
function fmt(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return '-';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * إرسال تقرير حاسبة أصول المناخ (مُدخل يدوي من العميل عبر الواجهة — غير معتمد رسمياً)
 * @param {object} data - بيانات التقرير القادمة من index.html
 * @param {string} [snapshotDataUrl] - صورة الخريطة الملتقطة (base64 data URL) اختياري
 */
async function sendClimateReportEmail(data, snapshotDataUrl) {
  const {
    owner, location, areaFeddan, ndvi,
    emissionsTons, absorbedTons, netCarbonTons,
    incomeMin, incomeMax,
  } = data;

  const html = `
    <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; max-width: 640px; margin: 0 auto; color:#0f172a;">
      <div style="background:#0f172a; padding:20px; border-radius:12px 12px 0 0;">
        <h2 style="color:#22d3ee; margin:0;">نيلوس للتقنيات الرقمية وأصول المناخ</h2>
        <p style="color:#94a3b8; margin:4px 0 0; font-size:13px;">تقرير حاسبة أصول المناخ ودخل الكربون — مُدخل من الواجهة العامة</p>
      </div>
      <div style="border:1px solid #e2e8f0; border-top:none; border-radius:0 0 12px 12px; padding:20px;">
        <p style="background:#fef9c3; border:1px solid #fde047; padding:10px 14px; border-radius:8px; font-size:12px; color:#854d0e;">
          ⚠️ هذا تقرير أولي إرشادي بناءً على بيانات أدخلها العميل يدوياً عبر الواجهة العامة، وليس شهادة كربون
          معتمدة. لأي استخدام رسمي أو تجاري يلزم تحقق ميداني ومراجعة من جهة تحقق معتمدة (VVB).
        </p>
        <table style="width:100%; border-collapse:collapse; font-size:14px; margin-top:12px;">
          <tr><td style="padding:8px 0; color:#64748b;">اسم العميل / الجهة</td><td style="padding:8px 0; font-weight:bold;">${owner || '-'}</td></tr>
          <tr><td style="padding:8px 0; color:#64748b;">المنطقة / المحافظة</td><td style="padding:8px 0; font-weight:bold;">${location || '-'}</td></tr>
          <tr><td style="padding:8px 0; color:#64748b;">المساحة المحسوبة</td><td style="padding:8px 0; font-weight:bold;">${fmt(areaFeddan)} فدان</td></tr>
          <tr><td style="padding:8px 0; color:#64748b;">مؤشر الغطاء النباتي (NDVI)</td><td style="padding:8px 0; font-weight:bold;">${ndvi ?? '-'}</td></tr>
          <tr><td style="padding:8px 0; color:#64748b;">إجمالي الانبعاثات</td><td style="padding:8px 0; font-weight:bold; color:#d97706;">${fmt(emissionsTons)} طن CO2e</td></tr>
          <tr><td style="padding:8px 0; color:#64748b;">الكربون الممتص (أشجار + مؤشر تربة)</td><td style="padding:8px 0; font-weight:bold; color:#059669;">${fmt(absorbedTons)} طن CO2/سنة</td></tr>
          <tr><td style="padding:8px 0; color:#64748b; border-top:1px solid #e2e8f0;">صافي الكربون المرصود</td><td style="padding:8px 0; font-weight:bold; color:#0891b2; border-top:1px solid #e2e8f0;">${fmt(netCarbonTons)} طن</td></tr>
          <tr><td style="padding:8px 0; color:#64748b;">العائد المتوقع ($18-$40/طن)</td><td style="padding:8px 0; font-weight:bold;">$${fmt(incomeMin, 0)} - $${fmt(incomeMax, 0)}</td></tr>
        </table>
        <p style="font-size:11px; color:#94a3b8; margin-top:20px; border-top:1px solid #e2e8f0; padding-top:10px;">
          أُرسل تلقائياً من منصة Nilus ECA بتاريخ ${new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })}
        </p>
      </div>
    </div>
  `;

  const mailOptions = {
    from: `"Nilus ECA" <${SMTP_USER}>`,
    to: COMPANY_REPORT_EMAIL,
    subject: `تقرير أصول المناخ — ${owner || 'عميل غير مسمى'} (${fmt(areaFeddan)} فدان)`,
    html,
  };

  if (snapshotDataUrl && snapshotDataUrl.startsWith('data:image/')) {
    const base64 = snapshotDataUrl.split(',')[1];
    mailOptions.attachments = [{
      filename: 'field-map-snapshot.png',
      content: base64,
      encoding: 'base64',
    }];
  }

  await getTransporter().sendMail(mailOptions);
}

/**
 * إرسال نسخة أرشيفية تلقائية لتقرير الزراعة الذكية المدفوع (بعد نجاح الدفع وتوليد التقرير)
 * @param {object} report - سجل التقرير الكامل من reportsStore (يشمل reportData)
 */
async function sendSmartFarmingReportEmail(report) {
  const r = report.reportData;
  if (!r) return;

  const html = `
    <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; max-width: 640px; margin: 0 auto; color:#0f172a;">
      <div style="background:#0f172a; padding:20px; border-radius:12px 12px 0 0;">
        <h2 style="color:#f59e0b; margin:0;">نيلوس ECA — تقرير الزراعة الذكية (مدفوع)</h2>
        <p style="color:#94a3b8; margin:4px 0 0; font-size:13px;">نسخة أرشيفية تلقائية بعد تأكيد الدفع عبر Paymob</p>
      </div>
      <div style="border:1px solid #e2e8f0; border-top:none; border-radius:0 0 12px 12px; padding:20px; font-size:14px;">
        <table style="width:100%; border-collapse:collapse;">
          <tr><td style="padding:6px 0; color:#64748b;">معرّف الطلب</td><td style="padding:6px 0; font-weight:bold;">${report.reportId}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">العميل</td><td style="padding:6px 0; font-weight:bold;">${report.customer?.firstName || '-'} — ${report.customer?.phone || '-'}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">المحصول</td><td style="padding:6px 0; font-weight:bold;">${report.cropType}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">السعر المدفوع</td><td style="padding:6px 0; font-weight:bold;">${report.priceEGP} جنيه</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">صحة المحصول</td><td style="padding:6px 0; font-weight:bold;">${r.cropHealth?.band} — ${r.cropHealth?.note}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">إنذار الإجهاد</td><td style="padding:6px 0; font-weight:bold;">${r.stressAlert?.message}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">توصية الري</td><td style="padding:6px 0; font-weight:bold;">${r.irrigation?.recommendation} (${r.irrigation?.netIrrigationNeedM3PerFeddan} م³/فدان)</td></tr>
          <tr><td style="padding:6px 0; color:#64748b;">تقدير الإنتاجية (نوعي)</td><td style="padding:6px 0; font-weight:bold;">${r.yieldEstimate?.band}</td></tr>
        </table>
        <p style="font-size:11px; color:#94a3b8; margin-top:20px; border-top:1px solid #e2e8f0; padding-top:10px;">
          أُنشئ تلقائياً بتاريخ ${new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })}
        </p>
      </div>
    </div>
  `;

  await getTransporter().sendMail({
    from: `"Nilus ECA" <${SMTP_USER}>`,
    to: COMPANY_REPORT_EMAIL,
    subject: `[أرشيف] تقرير زراعة ذكية مدفوع — ${report.reportId}`,
    html,
  });
}

module.exports = { sendClimateReportEmail, sendSmartFarmingReportEmail };
