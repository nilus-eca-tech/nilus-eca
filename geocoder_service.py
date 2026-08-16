from flask import Flask, request, jsonify
from geopy.geocoders import Nominatim
import time

app = Flask(__name__)

# تهيئة خدمة الـ Geocoding مع تحديد User-Agent خاص بالمنصة
geolocator = Nominatim(user_agent="nilus_eca_platform_v2")

def get_admin_location(lat, lon):
    try:
        # جلب البيانات الجغرافية باللغة العربية
        location = geolocator.reverse((lat, lon), language='ar', timeout=10)
        if location and 'address' in location.raw:
            address = location.raw['address']
            
            # استخراج الهيكل الإداري بدقة مع توفير قيم افتراضية
            governorate = address.get('state') or address.get('province') or 'غير معروف'
            district = address.get('county') or address.get('district') or address.get('state_district') or 'غير معروف'
            village = address.get('village') or address.get('town') or address.get('city') or address.get('hamlet') or 'غير معروف'
            
            return {
                "governorate": governorate,
                "district": district,
                "village": village,
                "display_name": location.raw.get('display_name', '')
            }
    except Exception as e:
        print(f"[ERROR] Geocoding failed: {str(e)}")
    
    return {"governorate": "غير محدد", "district": "غير محدد", "village": "غير محدد", "display_name": ""}

@app.route('/api/analyze-point', methods=['POST'])
def analyze_point():
    data = request.json
    lat = data.get('lat')
    lon = data.get('lon')
    
    if not lat or not lon:
        return jsonify({"error": "الإحداثيات غير متوفرة"}), 400

    # 1. جلب الموقع الإداري (المحافظة، المركز، القرية)
    admin_info = get_admin_location(lat, lon)
    
    # محاكاة تحليل البصمة الطيفية (Sentinel-2 NDVI & Roth-C)
    # يمكنك استبدالها بدالة المعالجة الفعلية الخاصة بك
    ndvi_value = 0.65  # مثال محاكاة
    terrain_type = "أرض زراعية خضراء نشطة" if ndvi_value > 0.2 else "ظهير صحراوي / أرض استصلاح جديدة"
    
    # صياغة السجلات تماماً كما تظهر في واجهة المنصة
    logs = [
        f"[{time.strftime('%H:%M:%S')}] [LOCATION-API] تم تحديد الموقع الجغرافي الإداري بنجاح:",
        f" ├── المحافظة: {admin_info['governorate']}",
        f" ├── المركز: {admin_info['district']}",
        f" └── القرية / النطاق: {admin_info['village']}",
        f"[{time.strftime('%H:%M:%S')}] [DESERT-PIPELINE] تحليل البصمة الطيفية B8 و B4 للإحداثيات ({lat}, {lon})...",
        f"[{time.strftime('%H:%M:%S')}] [SUCCESS] تم استخراج مؤشر NDVI بنجاح: {ndvi_value} | التضاريس: {terrain_type}"
    ]

    return jsonify({
        "status": "success",
        "coordinates": {"lat": lat, "lon": lon},
        "admin_location": admin_info,
        "ndvi": ndvi_value,
        "terrain": terrain_type,
        "logs": logs
    })

if __name__ == '__main__':
    app.run(debug=True, port=5000)