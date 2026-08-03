// ============================================================================
// وحدة حساب الكربون (Carbon Calculator) — IPCC 2019 Tier 1 / VM0042-oriented
// ============================================================================
// ⚠️ هذه أول نسخة برمجية لمنطق الحساب. البنية (structure) الحسابية صحيحة
// ومبنية على IPCC 2019 Refinement Tier 1 defaults، لكن **معاملات كل محصول
// التفصيلية** (الـ 25 محصول المصري وملف الـ JSON الخاص بها، ومعادلة Water
// Stress Factor الكاملة المعتمدة رسمياً) لسه معندناش نسخة نهائية موقّعة منها
// في هذا الريبو. اللي حاططه هنا كقيم افتراضية هو فقط الأرقام اللي ظهرت في
// نقاشات المشروع السابقة (نطاق 0.5–1.5 طن CO2e/فدان/سنة للمحاصيل الحولية).
//
// **قبل استخدام هذا الملف في أي تقرير رسمي، شهادة كربون، أو تقديم لـ Verra:**
// استبدل CROP_SEQUESTRATION_DEFAULTS بالقيم النهائية من ملف الـ JSON المعتمد
// (الـ 25 محصول)، واستبدل applyWaterStressFactor() بالمعادلة الرسمية للـ WSF
// اللي اتعملها اعتماد. لحد ما يحصل ده، اعتبر أي رقم طالع من هنا "تقديري
// إرشادي أولي" وليس رقماً معتمداً — بالظبط زي التحذير الموجود في
// smartFarming.js لتقدير الإنتاجية.

// --------------------------------------------------------------------------
// 1) الانبعاثات (Emissions) — IPCC 2019 Tier 1 defaults
// --------------------------------------------------------------------------

// احتراق الديزل: 2.68 kg CO2/لتر — قيمة افتراضية شائعة (IPCC/DEFRA)، راجعها
// مقابل آخر إصدار من IPCC Emission Factor Database قبل الاعتماد النهائي.
const DIESEL_KG_CO2_PER_LITER = 2.68;

// اليوريا: 46% نيتروجين بالوزن. الانبعاث المباشر N2O من النيتروجين المُضاف:
// IPCC 2019 Tier 1 default EF1 = 0.01 kg N2O-N / kg N. تحويل N2O-N إلى N2O:
// ×(44/28). تحويل N2O إلى CO2e بمعامل الاحترار العالمي GWP100 = 265 (AR5).
const UREA_N_FRACTION = 0.46;
const EF1_N2O_N_PER_N = 0.01;
const N2O_N_TO_N2O = 44 / 28;
const N2O_GWP100 = 265;

function calculateEmissions({ dieselLiters = 0, ureaKg = 0, electricityKwh = 0, gridEmissionFactorKgPerKwh = null }) {
  const dieselCo2Kg = dieselLiters * DIESEL_KG_CO2_PER_LITER;

  const nApplied = ureaKg * UREA_N_FRACTION;
  const n2oNKg = nApplied * EF1_N2O_N_PER_N;
  const n2oKg = n2oNKg * N2O_N_TO_N2O;
  const fertilizerCo2eKg = n2oKg * N2O_GWP100;

  let electricityCo2Kg = 0;
  let electricityNote = null;
  if (electricityKwh > 0) {
    if (gridEmissionFactorKgPerKwh == null) {
      electricityNote =
        'تم إدخال استهلاك كهرباء لكن معامل انبعاث الشبكة المصرية (grid emission factor) غير مزوّد — ' +
        'لا يُحسب أي رقم بدلاً من افتراض قيمة قد تكون غير دقيقة. اجلب القيمة الرسمية المحدّثة من قاعدة بيانات ' +
        'IPCC Emission Factor Database أو من جهاز تنظيم الكهرباء المصري.';
    } else {
      electricityCo2Kg = electricityKwh * gridEmissionFactorKgPerKwh;
    }
  }

  const totalKg = dieselCo2Kg + fertilizerCo2eKg + electricityCo2Kg;

  return {
    dieselTons: Number((dieselCo2Kg / 1000).toFixed(4)),
    fertilizerTons: Number((fertilizerCo2eKg / 1000).toFixed(4)),
    electricityTons: Number((electricityCo2Kg / 1000).toFixed(4)),
    electricityNote,
    totalEmissionsTons: Number((totalKg / 1000).toFixed(4)),
    methodology: 'IPCC 2019 Refinement, Tier 1 defaults (diesel combustion + urea direct N2O + grid electricity)',
  };
}

// --------------------------------------------------------------------------
// 2) عزل الكربون (Sequestration) — تقدير مبدئي بانتظار ملف الـ 25 محصول
// --------------------------------------------------------------------------

// ⚠️ placeholder — استبدلها بملف JSON المعتمد (25 محصول مصري، منطق خاص
// للمحاصيل العشبية زي الموز والصبار حسب ما هو موثّق في نقاشات المشروع)
const CROP_SEQUESTRATION_DEFAULTS = {
  annual_default: { minTonsPerFeddanYear: 0.5, maxTonsPerFeddanYear: 1.5 },
  // أضف هنا بقية الـ 25 محصول بقيمهم المعتمدة رسمياً عند توفرها
};

/**
 * ⚠️ Water Stress Factor — هذا مجرد placeholder بمعامل ثابت 1.0 (بدون تعديل).
 * المعادلة الرسمية المعتمدة (المذكورة في وثائق المشروع كتعديل إلزامي لظروف
 * الري المصرية) لازم تُبنى هنا بدل الافتراض الحالي قبل أي استخدام رسمي.
 */
function applyWaterStressFactor(baseTons, _context) {
  const WSF_PLACEHOLDER = 1.0;
  return baseTons * WSF_PLACEHOLDER;
}

function calculateSequestration({ areaFeddan, cropType = 'annual_default', vegetationHealthBand = null }) {
  const rates = CROP_SEQUESTRATION_DEFAULTS[cropType] || CROP_SEQUESTRATION_DEFAULTS.annual_default;

  // نستخدم منتصف النطاق كتقدير مركزي، ونعدّله قليلاً حسب حالة الغطاء النباتي
  // الفعلية من القمر الصناعي (مؤشر اتجاه وليس معايرة كمية دقيقة)
  const midRate = (rates.minTonsPerFeddanYear + rates.maxTonsPerFeddanYear) / 2;
  const healthAdjustment = { 'ضعيف جداً': 0.6, 'ضعيف': 0.8, 'متوسط': 1.0, 'جيد': 1.1, 'ممتاز': 1.2 };
  const adjustment = healthAdjustment[vegetationHealthBand] ?? 1.0;

  const baseTons = areaFeddan * midRate * adjustment;
  const adjustedTons = applyWaterStressFactor(baseTons, { cropType, areaFeddan });

  return {
    estimatedTonsPerYear: Number(adjustedTons.toFixed(3)),
    rangeMinTons: Number((areaFeddan * rates.minTonsPerFeddanYear).toFixed(3)),
    rangeMaxTons: Number((areaFeddan * rates.maxTonsPerFeddanYear).toFixed(3)),
    cropType,
    vegetationHealthBand,
    disclaimer:
      'تقدير أولي إرشادي بناءً على نطاق عام للمحاصيل الحولية ومعامل ضغط مائي (WSF) غير مفعّل بعد (=1.0). ' +
      'غير معتمد لإصدار شهادات كربون أو تقديم PDD رسمي لحد ما يتم استبدال هذا الملف بالقيم النهائية المعتمدة.',
  };
}

// --------------------------------------------------------------------------
// 3) صافي الكربون
// --------------------------------------------------------------------------

function calculateNetCarbon({ emissionsInput, sequestrationInput }) {
  const emissions = calculateEmissions(emissionsInput);
  const sequestration = calculateSequestration(sequestrationInput);
  const netTons = sequestration.estimatedTonsPerYear - emissions.totalEmissionsTons;

  return {
    emissions,
    sequestration,
    netCarbonTonsPerYear: Number(netTons.toFixed(3)),
    isDraftEstimate: true,
  };
}

module.exports = { calculateEmissions, calculateSequestration, calculateNetCarbon };
