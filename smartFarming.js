const { fetchNdviIntervals, extractValidIntervals } = require('./sentinel');
const { fetchWeatherAndIrrigation } = require('./weather');

// تصنيف عام لصحة الغطاء النباتي حسب قيمة NDVI — تصنيف مرجعي شائع الاستخدام في
// الاستشعار عن بعد الزراعي (وليس معادلة دقيقة لكل محصول):
// NDVI < 0.2 أرض عارية/إجهاد شديد | 0.2-0.4 غطاء نباتي ضعيف/مبكر | 0.4-0.6 متوسط |
// 0.6-0.8 جيد وكثيف | > 0.8 كثيف جداً
function classifyVegetationHealth(ndvi) {
  if (ndvi == null) return { band: 'غير متاح', note: 'لا توجد بيانات كافية' };
  if (ndvi < 0.2) return { band: 'ضعيف جداً', note: 'أرض شبه عارية أو إجهاد شديد — يُنصح بفحص ميداني عاجل' };
  if (ndvi < 0.4) return { band: 'ضعيف', note: 'غطاء نباتي مبكر أو متفرق' };
  if (ndvi < 0.6) return { band: 'متوسط', note: 'نمو نباتي معتدل' };
  if (ndvi < 0.8) return { band: 'جيد', note: 'غطاء نباتي كثيف وصحي' };
  return { band: 'ممتاز', note: 'كثافة نباتية عالية جداً' };
}

// كشف إجهاد/آفة محتملة: مقارنة آخر قراءة NDVI بمتوسط القراءات السابقة لنفس الحقل.
// انخفاض نسبي > 15% هو حد إرشادي شائع في تطبيقات المراقبة الزراعية (وليس عتبة معتمدة رسمياً)
function detectStressAlert(intervals) {
  if (intervals.length < 2) {
    return { alert: false, message: 'لا توجد بيانات تاريخية كافية بعد لمقارنة الاتجاه' };
  }
  const latest = intervals[intervals.length - 1];
  const previous = intervals.slice(0, -1);
  const avgPrevious = previous.reduce((a, b) => a + b.ndvi, 0) / previous.length;
  const changePercent = ((latest.ndvi - avgPrevious) / avgPrevious) * 100;

  if (changePercent <= -15) {
    return {
      alert: true,
      severity: changePercent <= -30 ? 'عالية' : 'متوسطة',
      changePercent: Number(changePercent.toFixed(1)),
      message: `انخفاض ملحوظ في صحة الغطاء النباتي (${changePercent.toFixed(1)}%) مقارنة بالمتوسط السابق — يُنصح بفحص ميداني للتأكد من عدم وجود إجهاد مائي أو آفة`,
    };
  }
  return {
    alert: false,
    changePercent: Number(changePercent.toFixed(1)),
    message: 'لا توجد مؤشرات إجهاد ملحوظة حالياً',
  };
}

// ⚠️ تقدير إنتاجية تقريبي جداً — هذا أضعف عنصر في التقرير من الناحية العلمية.
// لا يوجد نموذج عالمي دقيق يربط NDVI وحده بالإنتاجية الفعلية بدون معايرة محلية
// (بيانات إنتاجية تاريخية حقيقية من نفس المنطقة/الصنف). لذلك نعيد "نطاق" نوعي فقط
// (ضعيف/متوسط/جيد) مبني على متوسط NDVI خلال الموسم، وليس رقماً كمياً (طن/فدان)،
// تجنباً لتضليل المستخدم برقم دقيق غير موثوق.
function estimateYieldBand(intervals) {
  if (intervals.length === 0) {
    return { band: 'غير متاح', disclaimer: 'بيانات غير كافية' };
  }
  const avgNdvi = intervals.reduce((a, b) => a + b.ndvi, 0) / intervals.length;
  let band;
  if (avgNdvi < 0.35) band = 'ضعيف';
  else if (avgNdvi < 0.55) band = 'متوسط';
  else if (avgNdvi < 0.7) band = 'جيد';
  else band = 'جيد جداً';

  return {
    band,
    avgSeasonNdvi: Number(avgNdvi.toFixed(3)),
    disclaimer:
      'هذا تقدير نوعي إرشادي فقط بناءً على متوسط الغطاء النباتي، وليس رقماً دقيقاً بالطن/الفدان. ' +
      'الدقة الفعلية تتطلب معايرة بنموذج محلي باستخدام بيانات إنتاجية تاريخية حقيقية لنفس المحصول والمنطقة.',
  };
}

/**
 * يبني التقرير الكامل المدفوع لحقل معيّن.
 */
async function generateSmartFarmingReport({ polygon, cropType, centerLat, centerLng }) {
  const to = new Date();
  const from = new Date(to.getTime() - 60 * 24 * 3600 * 1000); // آخر 60 يوماً — ~6 فترات P10D

  const [rawNdvi, irrigation] = await Promise.all([
    fetchNdviIntervals(polygon, from.toISOString(), to.toISOString(), 'P10D'),
    fetchWeatherAndIrrigation({ lat: centerLat, lng: centerLng, cropType }),
  ]);

  const intervals = extractValidIntervals(rawNdvi);
  const latestNdvi = intervals.length ? intervals[intervals.length - 1].ndvi : null;

  return {
    generatedAt: new Date().toISOString(),
    cropType,
    ndviSeries: intervals,
    cropHealth: classifyVegetationHealth(latestNdvi),
    stressAlert: detectStressAlert(intervals),
    irrigation,
    yieldEstimate: estimateYieldBand(intervals),
  };
}

module.exports = { generateSmartFarmingReport };
