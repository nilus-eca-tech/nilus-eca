require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { requireAuth, requireRole } = require('./middleware/auth');

const authRoutes = require('./routes/authRoutes');
const onboardingRoutes = require('./routes/onboarding');
const satelliteRoutes = require('./routes/satelliteRoutes');
const vvbRoutes = require('./routes/vvbRoutes');
const reportRoutes = require('./routes/reportRoutes');
const smartFarmingRoutes = require('./routes/smartFarmingRoutes');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '1mb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use('/api', limiter);

// ---------------------------------------------------------------------
// خدمة الواجهة الأمامية الثابتة (Static Frontend)
// ---------------------------------------------------------------------
app.use(express.static(path.join(__dirname)));

// ---------------------------------------------------------------------
// عام (بدون تسجيل دخول) — حاسبة أصول المناخ العامة وخدمة الزراعة الذكية
// ---------------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/public', smartFarmingRoutes);

// ---------------------------------------------------------------------
// منصة الـ MRV الموثّقة — تتطلب تسجيل دخول لكل شيء تحت هذا الخط
// ---------------------------------------------------------------------
app.use('/api/onboarding', requireAuth, requireRole('admin', 'field_agent'), onboardingRoutes);
app.use('/api/satellite', requireAuth, requireRole('admin', 'analyst'), satelliteRoutes);
app.use('/api/reports', requireAuth, requireRole('admin', 'analyst'), reportRoutes);
app.use('/api/vvb', requireAuth, requireRole('vvb_readonly', 'admin'), vvbRoutes);

// فحص سلامة السيرفر
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// توجيه الصفحة الرئيسية مباشرة إلى index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// التعامل مع الأخطاء العامة
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'حدث خطأ غير متوقع في السيرفر.' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Nilus ECA backend running on port ${PORT}`));
