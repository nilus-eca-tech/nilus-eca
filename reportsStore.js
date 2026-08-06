/**
 * Nilus ECA - Reports & Payment Requests Store (PostgreSQL Version)
 * تم استبدال التخزين المحلي (JSON) بقاعدة بيانات Postgres دائمة وآمنة للإنتاج
 */

const pool = require('../db'); // تأكد أن مسار اتصال قاعدة البيانات يطابق هيكل مشروعك

const ReportsStore = {
  /**
   * إنشاء تقرير أو طلب دفع جديد
   */
  async createReport(reportId, initialData) {
    const { 
      userEmail = initialData.userEmail || 'unknown@nilus-eca.com', 
      serviceType = initialData.serviceType || 'general_report', 
      amount = initialData.amount || 0, 
      currency = initialData.currency || 'EGP', 
      paymentStatus = initialData.paymentStatus || 'PENDING',
      paymobOrderId = initialData.paymobOrderId || null,
      ...metadata 
    } = initialData;

    const query = `
      INSERT INTO public_payment_requests 
      (request_id, user_email, service_type, amount, currency, payment_status, paymob_order_id, metadata, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING *;
    `;
    
    const values = [
      reportId, 
      userEmail, 
      serviceType, 
      amount, 
      currency, 
      paymentStatus, 
      paymobOrderId, 
      JSON.stringify(metadata)
    ];

    try {
      const result = await pool.query(query, values);
      const row = result.rows[0];
      return {
        reportId: row.request_id,
        userEmail: row.user_email,
        serviceType: row.service_type,
        amount: parseFloat(row.amount),
        currency: row.currency,
        paymentStatus: row.payment_status,
        paymobOrderId: row.paymob_order_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...row.metadata
      };
    } catch (error) {
      console.error('Error creating report in DB:', error);
      throw error;
    }
  },

  /**
   * جلب تقرير أو طلب بواسطة المعرف (reportId)
   */
  async getReport(reportId) {
    const query = `SELECT * FROM public_payment_requests WHERE request_id = $1;`;
    try {
      const result = await pool.query(query, [reportId]);
      if (result.rows.length === 0) return null;
      
      const row = result.rows[0];
      return {
        reportId: row.request_id,
        userEmail: row.user_email,
        serviceType: row.service_type,
        amount: parseFloat(row.amount),
        currency: row.currency,
        paymentStatus: row.payment_status,
        paymobOrderId: row.paymob_order_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...(typeof row.metadata === 'object' ? row.metadata : JSON.parse(row.metadata || '{}'))
      };
    } catch (error) {
      console.error('Error fetching report from DB:', error);
      throw error;
    }
  },

  /**
   * تحديث بيانات أو حالة التقرير / الطلب
   */
  async updateReport(reportId, patch) {
    // جلب السجل الحالي أولاً لدمج الـ metadata القديمة مع الجديدة
    const current = await this.getReport(reportId);
    if (!current) return null;

    const paymentStatus = patch.paymentStatus || current.paymentStatus;
    const paymobOrderId = patch.paymobOrderId || current.paymobOrderId;
    
    // استبعاد الحقول الأساسية من الـ metadata ودمج الباقي
    const { reportId: _, userEmail: __, serviceType: ___, amount: ____, currency: _____, paymentStatus: ______, paymobOrderId: _______, createdAt: ________, updatedAt: _________, ...patchMeta } = patch;
    
    const updatedMetadata = JSON.stringify({
      ...current,
      ...patchMeta
    });

    const query = `
      UPDATE public_payment_requests
      SET payment_status = $1, 
          paymob_order_id = COALESCE($2, paymob_order_id), 
          metadata = $3, 
          updated_at = NOW()
      WHERE request_id = $4
      RETURNING *;
    `;

    try {
      const result = await pool.query(query, [paymentStatus, paymobOrderId, updatedMetadata, reportId]);
      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        reportId: row.request_id,
        userEmail: row.user_email,
        serviceType: row.service_type,
        amount: parseFloat(row.amount),
        currency: row.currency,
        paymentStatus: row.payment_status,
        paymobOrderId: row.paymob_order_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...(typeof row.metadata === 'object' ? row.metadata : JSON.parse(row.metadata || '{}'))
      };
    } catch (error) {
      console.error('Error updating report in DB:', error);
      throw error;
    }
  },

  /**
   * البحث عن الطلب أو التقرير باستخدام معرّف التاجر (Paymob Merchant Order ID)
   */
  async findByMerchantOrderId(merchantOrderId) {
    const query = `SELECT * FROM public_payment_requests WHERE request_id = $1 OR paymob_order_id = $2;`;
    try {
      const result = await pool.query(query, [merchantOrderId, merchantOrderId]);
      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        reportId: row.request_id,
        userEmail: row.user_email,
        serviceType: row.service_type,
        amount: parseFloat(row.amount),
        currency: row.currency,
        paymentStatus: row.payment_status,
        paymobOrderId: row.paymob_order_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...(typeof row.metadata === 'object' ? row.metadata : JSON.parse(row.metadata || '{}'))
      };
    } catch (error) {
      console.error('Error finding report by merchant order ID:', error);
      throw error;
    }
  }
};

module.exports = ReportsStore;
