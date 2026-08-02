-- ============================================================================
-- Nilus ECA — قاعدة بيانات الامتثال والتدقيق (PostgreSQL 14+)
-- ============================================================================
-- يستبدل هذا الملف مخزن JSON التجريبي (reportsStore.js) بقاعدة بيانات حقيقية
-- تدعم: سجل تدقيق (Audit Trail)، صلاحيات (RBAC مع دور VVB للقراءة فقط)،
-- وربط بيانات الأقمار الصناعية بـ Metadata موقّعة رقمياً (Audit-Ready).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1) المستخدمون والأدوار (Access Control)
-- ---------------------------------------------------------------------------
-- الأدوار الأربعة المقترحة:
--   admin        : صلاحية كاملة (إدارة، تعديل، مراجعة)
--   field_agent  : إدخال بيانات الحيازات/المشروعات (Onboarding) فقط
--   analyst      : تشغيل التحليل الذاتي وتوليد التقارير، بدون حذف بيانات
--   vvb_readonly : قراءة فقط — جهات التحقق والمصادقة (لا يوجد أي مسار INSERT/UPDATE/DELETE متاح لهذا الدور على مستوى الـ API، ومفروض أيضاً على مستوى قاعدة البيانات أدناه)
CREATE TYPE user_role AS ENUM ('admin', 'field_agent', 'analyst', 'vvb_readonly');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, -- bcrypt — لا تُخزّن كلمات مرور نصية أبداً
    full_name TEXT NOT NULL,
    role user_role NOT NULL,
    organization TEXT, -- اسم جهة التحقق (VVB) أو الجمعية الزراعية، إن وجد
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2) سجل التدقيق (Audit Trail) — غير قابل للتعديل أو الحذف
-- ---------------------------------------------------------------------------
-- كل عملية إدخال/تعديل على أي جدول حساس تُسجَّل هنا تلقائياً (عبر التطبيق، انظر
-- auditLog.js). التصميم "hash-chained": كل سجل يحتوي على hash للسجل السابق، فأي
-- محاولة تعديل أو حذف سجل قديم تكسر السلسلة ويمكن اكتشافها فوراً (نفس فكرة دفتر
-- الأستاذ الموزّع المبسّطة — وليس Blockchain حقيقي، لكنه كافٍ لإثبات عدم التلاعب).
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_user_id UUID REFERENCES users(id),
    actor_role user_role,
    action TEXT NOT NULL,           -- مثال: 'CREATE_FARM', 'UPDATE_NDVI_RECORD', 'GENERATE_PDD_REPORT'
    entity_table TEXT NOT NULL,     -- الجدول المتأثر
    entity_id TEXT NOT NULL,        -- معرّف السجل المتأثر
    change_summary JSONB,           -- القيم قبل/بعد (لا تُخزّن هنا بيانات حساسة خام، بل ملخص)
    ip_address TEXT,
    previous_record_hash TEXT NOT NULL, -- hash السجل السابق في السلسلة
    record_hash TEXT NOT NULL           -- hash هذا السجل (يُحسب من كل الحقول أعلاه + previous_record_hash)
);

-- منع أي UPDATE أو DELETE على سجل التدقيق على مستوى قاعدة البيانات نفسها،
-- حتى لو حصل حد على صلاحية admin بالخطأ على مستوى التطبيق
CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- 3) وحدة التسجيل (Onboarding) — المشروعات والجمعيات الزراعية والحيازات
-- ---------------------------------------------------------------------------
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_name TEXT NOT NULL,
    methodology TEXT NOT NULL DEFAULT 'VM0042', -- منهجية Verra المستخدمة
    association_name TEXT,          -- اسم الجمعية الزراعية
    status TEXT NOT NULL DEFAULT 'draft', -- draft | under_review | vvb_approved | rejected
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE farms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id),
    owner_name TEXT NOT NULL,
    polygon_geojson JSONB NOT NULL, -- حدود الحقل
    area_feddan NUMERIC(10,2),
    crop_type TEXT,
    registered_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 4) سجلات الأقمار الصناعية الموقّعة رقمياً (Audit-Ready satellite records)
-- ---------------------------------------------------------------------------
-- كل سجل NDVI/غطاء نباتي مرتبط إلزامياً بـ:
--   - تاريخ القياس الفعلي (measurement_date، من Sentinel Hub وليس تاريخ الإدخال)
--   - المنهجية المستخدمة (methodology)
--   - checksum لبيانات الاستجابة الخام (لضمان عدم التلاعب بها بعد الحفظ في S3)
--   - توقيع رقمي (digital_signature) — HMAC-SHA256 محسوب من كل الحقول أعلاه
--     بمفتاح لا يُخزَّن إلا على الخادم (انظر signing.js) — أي تعديل لأي حقل
--     يُبطل التوقيع فوراً عند إعادة التحقق
CREATE TABLE satellite_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    farm_id UUID NOT NULL REFERENCES farms(id),
    measurement_date DATE NOT NULL,       -- تاريخ التقاط المشهد الفعلي من القمر الصناعي
    methodology TEXT NOT NULL DEFAULT 'Sentinel-2 L2A NDVI via Copernicus Statistical API',
    ndvi_mean NUMERIC(5,3) NOT NULL,
    raw_response_s3_key TEXT NOT NULL,    -- مسار الاستجابة الخام في S3
    raw_response_sha256 TEXT NOT NULL,    -- checksum لملف S3 وقت الحفظ
    digital_signature TEXT NOT NULL,      -- HMAC-SHA256 لكل الحقول أعلاه مجتمعة
    signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5) التقارير المُصدرة (PDF/PDD)
-- ---------------------------------------------------------------------------
CREATE TABLE generated_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id),
    report_type TEXT NOT NULL, -- 'PDD_DRAFT' | 'MONITORING_REPORT' | 'FARMER_SMART_REPORT'
    pdf_s3_key TEXT,
    generated_by UUID REFERENCES users(id),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- صلاحيات قاعدة البيانات على مستوى الدور vvb_readonly (دفاع إضافي تحت مستوى التطبيق)
-- ---------------------------------------------------------------------------
-- ينشئ دور Postgres مطابق (منفصل عن جدول users أعلاه، هذا على مستوى محرك قاعدة
-- البيانات نفسه) بحيث حتى لو كان هناك ثغرة في كود التطبيق، قاعدة البيانات نفسها
-- ترفض أي محاولة كتابة من هذا الدور.
-- شغّل هذا الجزء يدوياً مرة واحدة من admin على قاعدة البيانات:
--
-- CREATE ROLE nilus_vvb_readonly LOGIN PASSWORD '...ضع كلمة مرور قوية هنا...';
-- GRANT CONNECT ON DATABASE nilus_eca TO nilus_vvb_readonly;
-- GRANT USAGE ON SCHEMA public TO nilus_vvb_readonly;
-- GRANT SELECT ON projects, farms, satellite_records, generated_reports, audit_log TO nilus_vvb_readonly;
-- -- ملاحظة: لا نمنح SELECT على جدول users لحماية بيانات حسابات المستخدمين الآخرين
