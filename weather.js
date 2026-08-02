// حساب توصية الري بمنهجية FAO-56 القياسية:
//   ETc (احتياج المحصول المائي) = ET0 (التبخر-نتح المرجعي) × Kc (معامل المحصول)
//   صافي احتياج الري = ETc - الأمطار الفعلية
//
// مصدر ET0: Open-Meteo API (مجاني، بدون مفتاح) — يحسبها بمعادلة FAO-56 Penman-Monteith
// القياسية من الحرارة/الرياح/الرطوبة/الإشعاع الشمسي.
// المرجع: https://open-meteo.com/en/docs (متغير daily=et0_fao_evapotranspiration)
//
// مصدر Kc: قيم "منتصف الموسم" (mid-season) الرسمية من جداول FAO Irrigation and Drainage
// Paper 56 (Allen et al., 1998), Table 12 — تقدير عام وليس دقيقاً لكل مرحلة نمو، لأننا
// لا نملك تاريخ الزراعة الفعلي لكل حقل.

const axios = require('axios');

// قيم Kc لمنتصف الموسم — FAO-56 Table 12 (تقريبية، تحتاج ضبط محلي لمرحلة النمو الفعلية)
const CROP_KC_MID_SEASON = {
  wheat: 1.15,   // قمح
  maize: 1.20,   // ذرة
  cotton: 1.15,  // قطن
  rice: 1.20,    // أرز
  tomato: 1.15,  // طماطم
  potato: 1.15,  // بطاطس
  date_palm: 0.90, // نخيل بلغ (تقدير عام، القيمة الفعلية تتغير كثيراً حسب الكثافة الزراعية)
  citrus: 0.70,  // موالح (مع غطاء أرضي كامل)
  alfalfa: 1.20, // برسيم
  default: 1.0,
};

async function fetchWeatherAndIrrigation({ lat, lng, cropType = 'default', pastDays = 10 }) {
  const url = 'https://api.open-meteo.com/v1/forecast';
  const resp = await axios.get(url, {
    params: {
      latitude: lat,
      longitude: lng,
      daily: 'et0_fao_evapotranspiration,precipitation_sum',
      past_days: pastDays,
      forecast_days: 3, // نظرة قريبة على الأمطار القادمة
      timezone: 'auto',
    },
  });

  const { time, et0_fao_evapotranspiration, precipitation_sum } = resp.data.daily;

  // نجمع بيانات آخر pastDays يوم فعلياً (استبعاد أيام التوقع القادمة من مجموع ET0/المطر الماضي)
  const pastIdx = time.length - 3; // آخر 3 أيام هي forecast_days
  const sumET0 = et0_fao_evapotranspiration.slice(0, pastIdx).reduce((a, b) => a + (b || 0), 0);
  const sumRain = precipitation_sum.slice(0, pastIdx).reduce((a, b) => a + (b || 0), 0);
  const upcomingRain = precipitation_sum.slice(pastIdx).reduce((a, b) => a + (b || 0), 0);

  const kc = CROP_KC_MID_SEASON[cropType] || CROP_KC_MID_SEASON.default;
  const etcMm = sumET0 * kc; // احتياج المحصول المائي بالملم خلال الفترة
  const netIrrigationMm = Math.max(0, etcMm - sumRain);

  // تحويل من ملم إلى م³/فدان: 1 ملم فوق 4200.83 م² = 4.20083 م³
  const netIrrigationM3PerFeddan = netIrrigationMm * 4.20083;

  let recommendation;
  if (upcomingRain > 5) {
    recommendation = 'يوجد أمطار متوقعة قريباً (>5مم) — يُفضّل تأجيل الري حتى تهطل الأمطار';
  } else if (netIrrigationMm < 3) {
    recommendation = 'رطوبة التربة كافية حالياً — لا حاجة عاجلة للري';
  } else if (netIrrigationMm < 15) {
    recommendation = 'يُنصح بري خفيف خلال 2-3 أيام القادمة';
  } else {
    recommendation = 'يُنصح بالري قريباً — العجز المائي المتراكم مرتفع نسبياً';
  }

  return {
    periodDays: pastIdx,
    et0TotalMm: Number(sumET0.toFixed(1)),
    rainfallTotalMm: Number(sumRain.toFixed(1)),
    upcomingRainMm: Number(upcomingRain.toFixed(1)),
    cropCoefficientKc: kc,
    cropWaterNeedMm: Number(etcMm.toFixed(1)),
    netIrrigationNeedMm: Number(netIrrigationMm.toFixed(1)),
    netIrrigationNeedM3PerFeddan: Number(netIrrigationM3PerFeddan.toFixed(1)),
    recommendation,
    // ⚠️ تقدير عام يعتمد على Kc لمنتصف الموسم فقط — لا يأخذ مرحلة النمو الفعلية،
    // نوع التربة، أو كفاءة نظام الري في الحسبان. مناسب كمؤشر إرشادي وليس جدول ري دقيق.
  };
}

module.exports = { fetchWeatherAndIrrigation, CROP_KC_MID_SEASON };
