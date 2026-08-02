// وحدة التقارير (Reporting Engine) — توليد مسودة PDF لوثيقة تصميم المشروع (PDD).
//
// ⚠️ توضيح مهم: هذا PDF يجمع البيانات الموثقة (المشروع، الحيازات، قياسات NDVI الموقّعة،
// ملخص سجل التدقيق) في شكل منظم يسهّل على فريقك وعلى جهة التحقق (VVB) المراجعة.
// لكنه "مسودة بيانات" وليس PDD معتمداً جاهزاً للتقديم لـ Verra — إعداد PDD كامل
// يتطلب أقساماً سردية ومنهجية إضافية (وصف خط الأساس Baseline، حسابات التسرب
// Leakage، خطة المراقبة التفصيلية...) يكتبها عادة استشاري كربون معتمد بالاستعانة
// بالبيانات التقنية التي يوفرها هذا التقرير كمدخل، وليس كبديل عن ذلك العمل.

const PDFDocument = require('pdfkit');
const { pool } = require('./db/pool');

async function buildPddPdfBuffer(projectId) {
  const { rows: projectRows } = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
  const project = projectRows[0];
  if (!project) throw new Error('المشروع غير موجود');

  const { rows: farms } = await pool.query('SELECT * FROM farms WHERE project_id = $1', [projectId]);

  const farmIds = farms.map((f) => f.id);
  let satelliteRecords = [];
  if (farmIds.length > 0) {
    const { rows } = await pool.query(
      `SELECT * FROM satellite_records WHERE farm_id = ANY($1) ORDER BY measurement_date ASC`,
      [farmIds]
    );
    satelliteRecords = rows;
  }

  const totalArea = farms.reduce((sum, f) => sum + (Number(f.area_feddan) || 0), 0);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // العنوان
    doc.fontSize(20).text('مسودة بيانات وثيقة تصميم المشروع (PDD Draft)', { align: 'center' });
    doc.fontSize(12).fillColor('gray').text('Nilus ECA — Climate Asset Documentation', { align: 'center' });
    doc.moveDown(1.5);
    doc.fillColor('black');

    // بيانات المشروع
    doc.fontSize(14).text('1. بيانات المشروع', { underline: true });
    doc.fontSize(10);
    doc.text(`اسم المشروع: ${project.project_name}`);
    doc.text(`المنهجية المعتمدة: ${project.methodology}`);
    doc.text(`الجمعية الزراعية: ${project.association_name || 'غير محدد'}`);
    doc.text(`حالة المشروع: ${project.status}`);
    doc.text(`تاريخ الإنشاء: ${project.created_at.toISOString().slice(0, 10)}`);
    doc.moveDown(1);

    // ملخص الحيازات
    doc.fontSize(14).text('2. ملخص الحيازات المسجّلة', { underline: true });
    doc.fontSize(10);
    doc.text(`عدد الحيازات: ${farms.length}`);
    doc.text(`إجمالي المساحة: ${totalArea.toFixed(2)} فدان`);
    doc.moveDown(0.5);
    farms.forEach((f, idx) => {
      doc.text(`${idx + 1}. ${f.owner_name} — ${f.area_feddan || '-'} فدان — محصول: ${f.crop_type || 'غير محدد'}`);
    });
    doc.moveDown(1);

    // بيانات الأقمار الصناعية الموقّعة
    doc.fontSize(14).text('3. سجلات الأقمار الصناعية الموقّعة رقمياً', { underline: true });
    doc.fontSize(9);
    if (satelliteRecords.length === 0) {
      doc.text('لا توجد قياسات مسجّلة بعد.');
    } else {
      satelliteRecords.forEach((r) => {
        doc.text(
          `${r.measurement_date.toISOString().slice(0, 10)} | NDVI: ${r.ndvi_mean} | ` +
          `المنهجية: ${r.methodology} | Checksum: ${r.raw_response_sha256.slice(0, 16)}... | ` +
          `التوقيع: ${r.digital_signature.slice(0, 16)}...`
        );
      });
    }
    doc.moveDown(1);

    // ملاحظة الامتثال
    doc.fontSize(14).text('4. ملاحظة الامتثال والتدقيق', { underline: true });
    doc.fontSize(9).fillColor('gray').text(
      'كل سجل بيانات قمر صناعي أعلاه موقّع رقمياً (HMAC-SHA256) ومرتبط بتاريخ قياس فعلي ' +
      'ومنهجية موثّقة وchecksum للبيانات الخام المخزّنة في S3. يمكن التحقق من صحة كل توقيع ' +
      'بشكل مستقل عبر لوحة VVB دون طلب بيانات إضافية. سجل التدقيق الكامل لكل عملية إدخال ' +
      'أو تعديل متاح كذلك عبر نفس اللوحة.'
    );

    doc.end();
  });
}

module.exports = { buildPddPdfBuffer };
