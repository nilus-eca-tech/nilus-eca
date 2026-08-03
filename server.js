require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const sentinelRoutes = require('./routes/sentinel');
const paymentRoutes = require('./routes/payments');
const storageRoutes = require('./routes/storage');
const reportRoutes = require('./routes/reports');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// حماية أساسية من إساءة الاستخدام (خصوصاً استدعاءات Sentinel Hub المكلفة)
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api', limiter);

app.use('/api/sentinel', sentinelRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/reports', reportRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// معالج أخطاء عام
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'حدث خطأ غير متوقع في السيرفر.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Nilus ECA backend running on port ${PORT}`));
