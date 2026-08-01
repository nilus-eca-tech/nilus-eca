from flask import Flask, request, jsonify
from flask_cors import CORS
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os

app = Flask(__name__)
CORS(app)

# إعدادات البريد (من متغيرات البيئة)
SMTP_SERVER = os.getenv('SMTP_SERVER', 'smtp.gmail.com')
SMTP_PORT = int(os.getenv('SMTP_PORT', '587'))
EMAIL_ADDRESS = os.getenv('EMAIL_ADDRESS')
EMAIL_PASSWORD = os.getenv('EMAIL_PASSWORD')
COMPANY_EMAIL = os.getenv('COMPANY_EMAIL', 'reports@niluseca.com')

@app.route('/api/send-report', methods=['POST'])
def send_report():
    try:
        data = request.json
        
        owner = data.get('owner', 'Unknown')
        area = float(data.get('area', 0))
        ndvi = float(data.get('ndvi', 0))
        diesel = float(data.get('diesel', 0))
        fert = float(data.get('fert', 0))
        trees = float(data.get('trees', 0))

        # حسابات بسيطة
        emissions = ((diesel * 2.68) + (fert * 1.35)) / 1000
        carbon_absorbed = (trees * 0.025) + (ndvi * area * 4.5)
        net_carbon = max(0, carbon_absorbed - emissions)

        # إنشاء محتوى البريد
        subject = f"تقرير أصول المناخ - {owner}"
        body = f"""
تقرير تحليل أصول المناخ

العميل: {owner}
المساحة: {area:.2f} فدان
NDVI: {ndvi:.2f}

الانبعاثات: {emissions:.2f} طن CO2
الكربون الممتص: {carbon_absorbed:.2f} طن CO2
صافي الكربون: {net_carbon:.2f} طن

نيلوس للتقنيات الرقمية وأصول المناخ © 2026
        """

        msg = MIMEMultipart()
        msg['From'] = EMAIL_ADDRESS
        msg['To'] = COMPANY_EMAIL
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain', 'utf-8'))

        # إرسال البريد
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls()
            server.login(EMAIL_ADDRESS, EMAIL_PASSWORD)
            server.send_message(msg)

        return jsonify({'status': 'success', 'message': 'Report sent successfully'}), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)