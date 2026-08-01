// /js/analysis.js

function validateNumberInput(id, options = {}) {
    const el = document.getElementById(id);
    if (!el) return null;

    let val = parseFloat(el.value);
    const {
        min = 0,
        max = null,
        allowZero = true,
        fieldLabel = id
    } = options;

    if (isNaN(val)) {
        showToast(`⚠️ الحقل (${fieldLabel}) يجب أن يحتوي رقمًا صالحًا`, 'error');
        el.classList.add('border-red-500');
        return null;
    }

    if (!allowZero && val === 0) {
        showToast(`⚠️ الحقل (${fieldLabel}) لا يجب أن يكون صفرًا`, 'error');
        el.classList.add('border-red-500');
        return null;
    }

    if (val < min) {
        showToast(`⚠️ الحقل (${fieldLabel}) لا يجب أن يكون أقل من ${min}`, 'error');
        el.classList.add('border-red-500');
        return null;
    }

    if (max !== null && val > max) {
        showToast(`⚠️ الحقل (${fieldLabel}) لا يجب أن يكون أكبر من ${max}`, 'error');
        el.classList.add('border-red-500');
        return null;
    }

    el.classList.remove('border-red-500');
    return val;
}

function validateFormInputs() {
    const feddans = validateNumberInput('calculatedFeddan', {
        min: 0.1,
        fieldLabel: currentLang === 'ar' ? 'المساحة بالفدان' : 'Area (Feddan)',
        allowZero: false
    });
    const ndvi = validateNumberInput('ndviInput', {
        min: 0,
        max: 1,
        fieldLabel: 'NDVI'
    });
    const diesel = validateNumberInput('dieselInput', {
        min: 0,
        fieldLabel: currentLang === 'ar' ? 'الديزل (لتر/سنة)' : 'Diesel (L/year)'
    });
    const fert = validateNumberInput('fertInput', {
        min: 0,
        fieldLabel: currentLang === 'ar' ? 'اليوريا (كجم/سنة)' : 'Urea (kg/year)'
    });
    const trees = validateNumberInput('palmCountInput', {
        min: 0,
        fieldLabel: currentLang === 'ar' ? 'عدد الأشجار' : 'Tree count'
    });

    if ([feddans, ndvi, diesel, fert, trees].some(v => v === null)) {
        showToast(currentLang === 'ar' ? '❌ يرجى تصحيح الأخطاء في المدخلات قبل الحساب' : '❌ Please fix input errors before calculation', 'error');
        return null;
    }

    return { feddans, ndvi, diesel, fert, trees };
}

export function calculateResults() {
    const validated = validateFormInputs();
    if (!validated) return;

    const { feddans, ndvi, diesel, fert, trees } = validated;
    const owner = document.getElementById('ownerName').value || (currentLang === 'ar' ? 'عميل غير محدد' : 'Unspecified Client');

    const emissions = ((diesel * 2.68) + (fert * 1.35)) / 1000;
    const carbonAbsorbed = (trees * 0.025) + (ndvi * feddans * 4.5);
    const netCarbon = Math.max(0, carbonAbsorbed - emissions);
    const minIncome = netCarbon * 18;
    const maxIncome = netCarbon * 40;

    document.getElementById('resOwnerName').innerText = owner;
    document.getElementById('resAreaVal').innerText = `${feddans.toFixed(2)} ${currentLang === 'ar' ? 'فدان' : 'Feddans'}`;
    document.getElementById('resNdviVal').innerText = ndvi;
    document.getElementById('resEmissions').innerText = `${emissions.toFixed(2)} طن مكافئ CO2`;
    document.getElementById('resTrees').innerText = `${carbonAbsorbed.toFixed(2)} طن CO2 سنوياً`;
    document.getElementById('resNet').innerText = `${netCarbon.toFixed(2)} طن مرصود (عائد مقدر: $${minIncome.toFixed(0)} - $${maxIncome.toFixed(0)})`;

    document.getElementById('resultsArea').classList.remove('hidden');
    showToast(currentLang === 'ar' ? '🚀 تم إتمام تحليل أصول المناخ وحساب دخل الكربون بنجاح' : '🚀 Climate assets & carbon calculation completed', 'success');
}

export async function sendCompanyEmailReport() {
    const validated = validateFormInputs();
    if (!validated) return;

    calculateResults();
    
    const owner = document.getElementById('ownerName').value || 'Nilus ECA Client';
    const reportData = {
        owner: owner,
        area: validated.feddans,
        ndvi: validated.ndvi,
        diesel: validated.diesel,
        fert: validated.fert,
        trees: validated.trees
    };

    showToast(currentLang === 'ar' ? `📧 جاري إرسال التقرير المالي والبيئي للعميل (${owner}) لبريد الشركة...` : `📧 Sending report for (${owner}) to company email...`, 'info');

    try {
        const response = await fetch('/api/send-report', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(reportData)
        });

        if (response.ok) {
            showToast(currentLang === 'ar' ? '✅ تم إرسال التقرير وشهادة أصول المناخ إلى البريد بنجاح' : '✅ Report sent to company email successfully', 'success');
        } else {
            throw new Error('Failed to send report');
        }
    } catch (error) {
        console.error('Email error:', error);
        showToast(currentLang === 'ar' ? '❌ فشل إرسال التقرير - تحقق من الاتصال بالخادم' : '❌ Failed to send report - check server connection', 'error');
    }
}