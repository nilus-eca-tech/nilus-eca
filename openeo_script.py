import openeo
import os

def main():
    # 1. الاتصال بمنصة Copernicus Data Space
    print("--- جارٍ الاتصال بمنصة OpenEO ---")
    connection = openeo.connect("https://openeosh.dataspace.copernicus.eu/")
    
    # 2. المصادقة التلقائية
    print("--- يرجى إتمام عملية المصادقة في المتصفح ---")
    connection.authenticate_oidc()
    
    # 3. إحداثيات المنطقة (دماريس - المنيا)
    # ملاحظة: يمكنك تعديلها باستخدام geojson.io إذا أردت مساحة أدق
    spatial_bbox = {
        "west": 30.73,  # خط طول المنيا
        "south": 28.08, # خط عرض المنيا
        "east": 30.78,
        "north": 28.13
    }
    
    temporal_range = ["2026-08-01", "2026-08-10"] # تحديث التاريخ ليناسب الوقت الحالي

    print("--- جارٍ بناء نموذج معالجة بيانات Sentinel-2 ---")
    
    # تحميل المجموعة
    s2_collection = connection.load_collection(
        id="sentinel-2-l2a",
        spatial_extent=spatial_bbox,
        temporal_extent=temporal_range,
        bands=["B04", "B08"]
    )

    # 4. معالجة متقدمة: دمج البيانات (تقليل السحب) وحساب NDVI
    # نقوم بعمل median لتقليل تأثير السحب في الفترة الزمنية
    ndvi_cube = s2_collection.reduce_dimension(
        dimension="t", 
        reducer="median"
    ).ndvi(red="B04", nir="B08", target_band="NDVI")

    # 5. حفظ النتيجة بصيغة GeoTIFF (ملف خريطة وليس مجرد صورة)
    print("--- جارٍ إرسال طلب المعالجة إلى السحابة ---")
    result = ndvi_cube.save_result(format="GTiff")

    # 6. التنفيذ والتحميل التلقائي
    output_filename = "Minya_NDVI_August_2026.tif"
    print(f"--- جارٍ المعالجة... سيتم حفظ الملف باسم: {output_filename} ---")
    
    try:
        result.download(output_filename)
        print(f"--- تم بنجاح! تم تحميل خريطة NDVI لمنطقة المنيا في ملف: {output_filename} ---")
    except Exception as e:
        print(f"--- حدث خطأ أثناء المعالجة أو التحميل: {e} ---")

if __name__ == "__main__":
    main()