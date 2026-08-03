const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

async function sendClimateReport({ ownerName, locationName, feddan, ndvi, netCarbon, paidServicesTotal, snapshotUrl }) {
  const html = `
    <div dir="rtl" style="font-family: Cairo, Arial, sans-serif;">
      <h2>تقرير أصول المناخ ودخل الكربون - Nilus ECA</h2>
      <p><strong>اسم المستفيد:</strong> ${ownerName}</p>
      <p><strong>المنطقة:</strong> ${locationName}</p>
      <p><strong>المساحة:</strong> ${feddan} فدان</p>
      <p><strong>NDVI (مصدر: Sentinel-2 L2A):</strong> ${ndvi}</p>
      <p><strong>صافي رصيد الكربون:</strong> ${netCarbon} طن</p>
      ${paidServicesTotal ? `<p><strong>الخدمات المدفوعة:</strong> ${paidServicesTotal} ج.م (مؤكدة عبر Paymob)</p>` : ''}
      ${snapshotUrl ? `<p><a href="${snapshotUrl}">رابط لقطة الحقل الموثّقة</a></p>` : ''}
    </div>
  `;

  await transporter.sendMail({
    from: `"Nilus ECA System" <${process.env.SMTP_USER}>`,
    to: process.env.COMPANY_REPORT_EMAIL,
    subject: `تقرير أصول مناخ جديد - ${ownerName} - ${new Date().toLocaleDateString('ar-EG')}`,
    html,
  });
}

module.exports = { sendClimateReport };
