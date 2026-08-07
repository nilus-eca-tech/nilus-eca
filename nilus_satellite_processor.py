import requests
import json

def fetch_sentinel_data_api(client_id, client_secret, bbox, time_interval):
    """
    الاتصال بـ Sentinel Hub OGC API لسحب بيانات ورطوبة التربة والـ NDVI لحقل معين.
    """
    # 1. الحصول على رمز المصادقة (OAuth2 Token)
    auth_url = "https://services.sentinel-hub.com/oauth/token"
    auth_data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "client_credentials"
    }
    
    response = requests.post(auth_url, data=auth_data)
    if response.status_code != 200:
        print(f"فشل الاتصال بالمصادقة: {response.text}")
        return None
        
    token = response.json().get("access_token")
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    # 2. إعداد طلب بيانات الرصد (Process API)
    process_url = "https://services.sentinel-hub.com/api/v1/process"
    
    evalscript = """
    //VERSION=3
    function setup() {
      return {
        input: ["B04", "B08", "dataMask"],
        output: { bands: 3, sampleType: "FLOAT32" }
      }
    }

    function evaluatePixel(sample) {
      let ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04 + 0.0001);
      // تقدير رطوبة التربة مبدئياً ومؤشر NDVI
      return [ndvi, sample.dataMask, sample.B08];
    }
    """

    payload = {
        "input": {
            "bounds": {
                "bbox": bbox
            },
            "data": [{
                "type": "sentinel-2-l2a",
                "dataFilter": {
                    "timeRange": {
                        "from": time_interval["from"],
                        "to": time_interval["to"]
                    },
                    "maxCloudCoverage": 20
                }
            }]
        },
        "output": {
            "width": 512,
            "height": 512,
            "responses": [{
                "identifier": "default",
                "format": { "type": "image/tiff" }
            }]
        },
        "evalscript": evalscript
    }

    res = requests.post(process_url, headers=headers, json=payload)
    if res.status_code == 200:
        print("تم استلام بيانات الأقمار الصناعية بنجاح لحقل الزراعة التعاقدية!")
        return res.content
    else:
        print(f"خطأ في جلب البيانات: {res.status_code} - {res.text}")
        return None

# مثال توضيحي للإحداثيات (منطقة المنيا/دماريس):
# bbox_minya = [30.740, 27.695, 30.765, 27.715] # [minLon, minLat, maxLon, maxLat]
# dates = {"from": "2026-06-01T00:00:00Z", "to": "2026-08-07T23:59:59Z"}
# result_tiff = fetch_sentinel_data_api("YOUR_CLIENT_ID", "YOUR_CLIENT_SECRET", bbox_minya, dates)
