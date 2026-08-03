# Nilus ECA — Backend موحّد (MRV الموثّق + الزراعة الذكية العامة)

## ⚠️ قبل أي حاجة تانية: أمن المفتاح المُسرَّب
لو لسه ماعملتش، ألغِ (revoke) الـ Sentinel Hub OAuth Client القديم من
[Copernicus dashboard](https://shapps.dataspace.copernicus.eu/dashboard/#/account/settings)
وأنشئ واحد جديد. المفتاح القديم كان مكتوباً صريحاً في `.env.example` على
ريبو عام — اعتبره مكشوفاً بشكل دائم حتى لو مسحته من آخر commit، لأنه لسه
موجود في تاريخ git. لو عايز تنضّف تاريخ الريبو نفسه (مش إلزامي طالما
المفتاح اتلغى، بس أنضف): استخدم `git filter-repo` أو BFG Repo-Cleaner.

## إيه اللي اتصلح في هذه النسخة

كان الريبو فيه دمج غير مقصود لمشروعين مختلفين رُفعوا في commit واحد بدون
فولدرات فرعية، فحصل تضارب أسماء (`sentinel.js` تحديداً) كسر أهم جزء في
النظام. هذه النسخة:

1. **أعادت هيكلة الملفات لبنية صحيحة** (`db/`, `routes/`, `services/`,
   `middleware/`, `scripts/`) وصلّحت كل مسارات `require()` تبعاً لذلك.
2. **استعادت `services/sentinel.js`** — الوحدة الحقيقية اللي بترجع
   `fetchNdviIntervals` و`extractValidIntervals` واللي كانت انمسحت
   بالغلط واستُبدلت بنسخة أبسط (راوتر) بنفس الاسم أثناء الدمج. من غيرها
   كل من `satelliteRoutes.js` (القياس الموثّق الموقّع) و`smartFarming.js`
   (تقرير الزراعة الذكية) كانا هيفشلوا فوراً بـ "fetchNdviIntervals is
   not a function".
3. **أضافت `services/carbonCalculator.js`** — كان ده أخطر فجوة: مفيش أي
   ملف في الريبو بيحوّل NDVI/بيانات الحيازة فعلياً لطن كربون (tCO2e).
   خط أنابيب الأقمار الصناعية (القياس + التوقيع + التخزين) كان ممتاز
   وموثّق، لكن مفيش معادلة تربطه برقم الكربون النهائي. **هذا الملف أول
   مسودة برمجية فقط** — القيم الدقيقة لكل محصول (ملف الـ 25 محصول) ومعادلة
   الـ Water Stress Factor النهائية لازم تُستبدل فيه قبل أي استخدام رسمي
   (راجع التحذيرات جوه الملف نفسه).
4. **أضافت `routes/authRoutes.js`** — كان `POST /auth/login` مش موجود
   أصلاً رغم إن كل باقي النظام (`requireAuth`, `requireRole`) بيفترض
   وجود توكن JWT.
5. **دمجت `server.js` واحد** يوصّل المنصتين مع بعض: مسارات عامة بدون
   تسجيل دخول لخدمة الزراعة الذكية (`/api/public/*`)، ومسارات محمية
   بـ JWT + RBAC لمنصة الـ MRV (`/api/onboarding`, `/api/satellite`,
   `/api/reports`, `/api/vvb`).
6. **وصّلت `index.html`** فعلياً بالـ backend: NDVI حقيقي بدل
   `Math.random()`، دفع حقيقي عبر Paymob بدل alert يطلب تحويل يدوي،
   تحقق S3 حقيقي، ورفع/إرسال فعلي للقطات والتقارير.
7. **`.gitignore`** يمنع `.env` من الرجوع للريبو تاني.

تم اختبار السيرفر فعلياً (`npm install && node server.js`) والتأكد إن
كل الـ `require()` بترتبط صح، وإن `/api/public/carbon-estimate` و
`/health` بيرجعوا نتائج صحيحة، وإن المسارات المحمية بترفض الطلبات من
غير توكن.

## التثبيت

```bash
npm install
cp .env.example .env   # املأ كل القيم (المفتاح الجديد بعد الإلغاء، DB، AWS، Paymob، SMTP)
psql $DATABASE_URL -f db/schema.sql
npm run create-admin -- admin@nilus-eca.com "كلمة مرور قوية" "اسمك"
npm start
```

## هيكل المشروع

```
db/            schema.sql + اتصال Postgres
middleware/    auth.js (login, JWT verify, RBAC)
services/      كل منطق العمل: sentinel, carbonCalculator, signing,
               auditLog, weather, smartFarming, reportPdf, s3Storage,
               paymob, emailReport, reportsStore
routes/        authRoutes, onboarding, satelliteRoutes, vvbRoutes,
               reportRoutes (كلهم محميين)، smartFarmingRoutes (عام)
scripts/       createAdmin.js
server.js      يوصّل كل حاجة
index.html     الواجهة العامة (حاسبة + خدمة الزراعة الذكية)
```

## نقاط لسه محتاجة قرارك أو مدخلات منك

- **`services/carbonCalculator.js`**: القيم الحالية placeholder. محتاج
  ملف الـ JSON المعتمد لـ 25 محصول ومعادلة WSF النهائية.
- **معامل انبعاث الشبكة الكهربائية المصرية**: مش موجود افتراضياً في
  الكود عمداً (بدل ما نفترض رقم غير موثّق) — لازم يُمرَّر صراحة لو حبيت
  تحسب انبعاثات الكهرباء.
- **`services/reportsStore.js`**: مخزن ملف JSON محلي مؤقت لطلبات الدفع
  العامة — مناسب للتجربة بس، مش للإنتاج على استضافة بدون تخزين دائم
  (Render/Railway بدون volume). استبدله بجدول Postgres عند الجاهزية.
- **دور `analyst` في `server.js`**: افترضت إنه المسموح له يشغّل قياس
  الأقمار الصناعية ويولّد تقارير PDD بجانب admin — راجع ده يطابق تصميم
  الأدوار اللي قررته فعلاً.
