# Nilus ECA — Smart Farming Backend

Backend حقيقي يستبدل كل الدوال المُحاكاة (simulated) في نسخة الـ HTML الأصلية.

## التثبيت
```bash
npm install
cp .env.example .env   # ثم املأ كل القيم الفعلية
npm start
```

## ما يحتاجه كل تكامل فعلياً
| الخدمة | من أين تجيب الاعتماد | مطلوب لأي مسار |
|---|---|---|
| Sentinel Hub | حساب Copernicus Data Space Ecosystem → OAuth Client (Client ID/Secret) | `/api/sentinel/ndvi` |
| AWS S3 | IAM user بصلاحيات `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` على الحاوية فقط (مش root كما في الـ IAM policy القديمة) | `/api/storage/*` |
| Paymob | حساب Merchant مفعّل + Secret/Public Key + HMAC Secret من إعدادات الـ Webhook | `/api/payments/*` |
| SMTP | حساب بريد بصلاحية App Password (لو Gmail) | `/api/reports/send` |

## التغييرات المطلوبة في الواجهة (index.html)
استبدل الدوال دي بالكامل — هي حالياً وهمية:

1. **`fetchSentinelStatisticsApiReal()`** → اعمل `POST /api/sentinel/ndvi` بإحداثيات `polygonPoints` بدل الـ `Math.random()`. لو رجع 422 (مفيش قراءة صالحة بسبب سحب)، اعرض رسالة واضحة للمستخدم بدل ما تفبرك رقم.

2. **`applyPaidServicesToReport()`** → استبدل الـ `alert()` بـ `POST /api/payments/create-intention`، ثم حوّل المستخدم فعلياً لـ `checkoutUrl` الراجعة. لا تعتبر الخدمة "مفعّلة" غير بعد ما تتأكد من حالة الدفع عبر `GET /api/payments/status/:orderId` (الـ webhook هو اللي بيحدّثها فعلياً).

3. **`validateAwsPolicyIntegration()`** → استبدلها بـ `GET /api/storage/verify` الحقيقية.

4. **`captureMapSnapshot()`** → بعد التقاط الصورة بـ html2canvas، ابعتها لـ `POST /api/storage/upload-snapshot` بدل ما تفضل في المتصفح بس.

5. **`sendCompanyEmailReport()`** → استبدلها بـ `POST /api/reports/send` بالبيانات المحسوبة.

## ملاحظة أمنية مهمة
رقم المحفظة (01006269629) ما ينفعش يفضل الطريقة الوحيدة لتأكيد الدفع — أي حد يقدر يدّعي إنه حوّل. الـ webhook + HMAC verification في `routes/payments.js` هو المصدر الوحيد الموثوق لتأكيد إن الدفع حصل فعلاً.
