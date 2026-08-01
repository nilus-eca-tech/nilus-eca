# Nilus ECA — خادم خلفي لـ Sentinel Hub + AWS S3

## التشغيل محلياً

```bash
cd nilus-backend
npm install
cp .env.example .env
# افتح .env واملأ SENTINEL_CLIENT_ID / SENTINEL_CLIENT_SECRET / بيانات AWS
npm start
```

الخادم سيعمل على `http://localhost:3001`.

## اختبار سريع (بعد تشغيل الخادم)

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

يجب أن يعيد شيئاً مثل:
```json
{ "ndvi": 0.412, "interval": {...}, "s3Key": "ndvi-statistics/2026-08-02/....json" }
```

## ربطه بالواجهة (index.html)

في أعلى وسم `<script>` في index.html، عدّل:
```js
const BACKEND_BASE_URL = 'https://YOUR-BACKEND-DOMAIN.com'; // بدّل هذا بعنوان الخادم بعد النشر
```

## النشر

يعمل على أي مزوّد Node.js (Render, Railway, AWS Elastic Beanstalk, EC2 خلف Nginx...).
تذكّر:
- لا ترفع `.env` إلى Git — أضفه إلى `.gitignore`
- في الإنتاج اضبط `FRONTEND_ORIGIN` في `.env` بدلاً من فتح CORS للجميع
- استخدم IAM User بصلاحية `s3:PutObject` فقط على الـ bucket المحدد (مبدأ أقل الصلاحيات)
