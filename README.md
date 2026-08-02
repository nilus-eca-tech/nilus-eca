# Nilus ECA — خادم خلفي لـ Sentinel Hub + AWS S3 + خدمة الزراعة الذكية المدفوعة

## التشغيل محلياً

```bash
cd nilus-backend
npm install
cp .env.example .env
# افتح .env واملأ SENTINEL_CLIENT_ID / SENTINEL_CLIENT_SECRET / بيانات AWS / بيانات Paymob
npm start
```

الخادم سيعمل على `http://localhost:3001`.

## إعداد Paymob (خدمة الزراعة الذكية المدفوعة)

1. سجّل حساباً على `paymob.com` (أو استخدم حسابك الحالي)
2. من Dashboard → **Settings**: انسخ `API Key` و`Secret Key` و`Public Key` و`HMAC` → ضعهم في `.env`
3. من Dashboard → **Developers → Payment Integrations**: فعّل تكامل **Card** وتكامل **Mobile Wallet (Vodafone Cash)**
   منفصلين — كل واحد له `Integration ID` رقمي، ضعهما في `PAYMOB_CARD_INTEGRATION_ID` و `PAYMOB_WALLET_INTEGRATION_ID`
4. من نفس صفحة **Payment Integrations**: أضف رابط الـ webhook الخاص بك في خانة
   **Transaction processed callback**:
   `https://YOUR-BACKEND-DOMAIN.com/api/webhooks/paymob`
5. جرّب أولاً في **Test mode** ببطاقات الاختبار الموجودة في توثيق Paymob قبل التحويل لـ Live

## اختبار سريع لـ NDVI (بعد تشغيل الخادم)

```bash
curl -X POST http://localhost:3001/api/ndvi \
  -H "Content-Type: application/json" \
  -d '{
    "polygon": [
      {"lat": 30.0444, "lng": 31.2357},
      {"lat": 30.0450, "lng": 31.2357},
      {"lat": 30.0450, "lng": 31.2365},
      {"lat": 30.0444, "lng": 31.2365}
    ]
  }'
```

## ربطه بالواجهة (index.html)

في أعلى وسم `<script>` في index.html، عدّل:
```js
const BACKEND_BASE_URL = 'https://YOUR-BACKEND-DOMAIN.com'; // بدّل هذا بعنوان الخادم بعد النشر
```

## بنية خدمة الزراعة الذكية المدفوعة

```
المستخدم يضغط "ادفع" → POST /api/smart-farming/create-payment
                       → الخادم ينشئ Paymob Intention + يحفظ الطلب بحالة "pending_payment"
                       → الواجهة تفتح صفحة دفع Paymob في تبويب جديد
العميل يدفع (بطاقة/فودافون كاش) → Paymob يستدعي POST /api/webhooks/paymob
                                  → الخادم يتحقق من HMAC، يحدّث الحالة إلى "paid"
                                  → يولّد التقرير فعلياً (NDVI + طقس) ويحفظه بحالة "ready"
الواجهة تستطلع (poll) → GET /api/smart-farming/report/:id كل 4 ثوانٍ
                        → تعرض التقرير فور توفره
```

⚠️ **ملاحظة مهمة عن التقدير الإنتاجي**: من أصل الميزات الأربع المطلوبة، تقدير الإنتاجية هو
الأضعف علمياً — لا يوجد نموذج عالمي دقيق يربط NDVI وحده بالإنتاجية الفعلية بدون معايرة محلية
ببيانات إنتاجية تاريخية حقيقية. لهذا يُعرض كـ"نطاق نوعي" (ضعيف/متوسط/جيد) وليس رقماً بالطن/الفدان،
تجنباً لتضليل الفلاح. راجع التعليقات في `smartFarming.js` للتفاصيل الكاملة.

⚠️ **قاعدة البيانات الحالية (`reportsStore.js`) ملف JSON محلي بسيط** — مناسب للتجربة فقط.
قبل الإنتاج الفعلي استبدلها بقاعدة بيانات حقيقية (Postgres/MongoDB) خصوصاً لو نشرت الخادم
على منصة بدون تخزين دائم (ephemeral filesystem).

## طبقة الامتثال والتدقيق (Compliance & Audit)

### 1) إعداد قاعدة البيانات

```bash
# أنشئ قاعدة بيانات PostgreSQL فارغة أولاً، ثم:
psql "postgresql://user:password@host:5432/nilus_eca" -f db/schema.sql
```

هذا ينشئ: جدول المستخدمين والأدوار، سجل التدقيق المتسلسل (audit_log)، المشروعات
والحيازات، سجلات الأقمار الصناعية الموقّعة، وجدول التقارير المُصدرة.

### 2) إنشاء أول حساب Admin

```bash
node scripts/createAdmin.js admin@yourdomain.com "كلمة-مرور-قوية-جداً" "اسم المدير"
```

### 3) إنشاء حسابات لجهات التحقق (VVB)

حالياً لا يوجد مسار عام لإنشاء حسابات — أنشئها يدوياً عبر SQL (أو أضف مسار admin
مخصص لاحقاً):
```sql
-- استخدم hashPassword() من auth.js لتوليد password_hash أولاً (لا تخزن كلمة مرور نصية أبداً)
INSERT INTO users (email, password_hash, full_name, role, organization)
VALUES ('vvb-auditor@verra-partner.com', '<bcrypt_hash>', 'اسم المدقق', 'vvb_readonly', 'اسم جهة التحقق');
```

### 4) الأدوار المتاحة

| الدور | الصلاحيات |
|---|---|
| `admin` | كل شيء |
| `field_agent` | تسجيل مشروعات وحيازات جديدة فقط (Onboarding) |
| `analyst` | تشغيل قياسات الأقمار الصناعية الموثّقة + توليد تقارير PDD |
| `vvb_readonly` | **قراءة فقط بالكامل** — عبر `/api/vvb/*` — لا يمكنه أي تعديل، محمي على مستوى الكود وعلى مستوى قاعدة البيانات نفسها (انظر آخر سطور `db/schema.sql`) |

### 5) تدفق الاستخدام النموذجي

```
1. field_agent يسجّل دخول → POST /api/auth/login → يحصل على JWT
2. field_agent يسجّل مشروعاً جديداً → POST /api/onboarding/projects
3. field_agent يسجّل حيازة داخل المشروع → POST /api/onboarding/farms
4. analyst يشغّل قياس موثّق للحيازة → POST /api/satellite/measure { farmId }
   → يُخزَّن في S3 + يُوقَّع رقمياً + يُسجَّل تدقيقياً تلقائياً
5. analyst يولّد مسودة PDD → POST /api/reports/generate-pdd { projectId } → يرجع PDF
6. جهة التحقق (VVB) تسجّل دخول بحسابها → تستعرض كل شيء عبر /api/vvb/*
   بما فيها التحقق من صحة كل توقيع رقمي والتأكد من سلامة سلسلة سجل التدقيق كاملة:
   GET /api/vvb/verify-integrity
```

### 6) حدود هذا النظام — بصراحة

- **هذا PDF مسودة بيانات، وليس PDD معتمداً جاهزاً للتقديم.** إعداد PDD حقيقي يتطلب
  أقساماً سردية (خط الأساس، التسرب، خطة المراقبة التفصيلية) يكتبها استشاري كربون
  معتمد، باستخدام هذه البيانات كمدخل تقني موثّق.
- **التوقيع الرقمي هنا HMAC متماثل** (نفس المفتاح للتوقيع والتحقق) — مناسب للتحقق
  الداخلي، لكن لو احتاجت جهة التحقق توقيعاً يمكنها التحقق منه بمفتاح عام دون الوصول
  لسر الخادم، يلزم الترقية لتوقيع غير متماثل (RSA/ECDSA).
- **الامتثال الفعلي لمنهجية Verra VM0042 قرار بشري من جهة VVB معتمدة**، لا يضمنه أي
  كود لوحده. هذا النظام يوفر البنية التحتية التقنية الداعمة فقط.

## النشر

يعمل على أي مزوّد Node.js (Render, Railway, AWS Elastic Beanstalk, EC2 خلف Nginx...).
تذكّر:
- لا ترفع `.env` إلى Git — أضفه إلى `.gitignore`
- في الإنتاج اضبط `FRONTEND_ORIGIN` في `.env` بدلاً من فتح CORS للجميع
- استخدم IAM User بصلاحية `s3:PutObject` فقط على الـ bucket المحدد (مبدأ أقل الصلاحيات)
- فعّل Paymob **Live mode** فقط بعد اختبار كامل في Test mode
- خذ نسخة احتياطية دورية من قاعدة البيانات (خصوصاً `audit_log` — فقدانها يعني فقدان
  القدرة على إثبات عدم التلاعب بالبيانات التاريخية)
- شغّل `GET /api/vvb/verify-integrity` دورياً (مثلاً يومياً عبر cron) وراقب النتيجة

