# -*- coding: utf-8 -*-
import os
import requests
from PIL import Image
import numpy as np

# ≈⁄œ«œ —«»ÿ «·ﬂ «·ÊÃ Ê—«»ÿ «·ÿ·» ·„‰ÿﬁ… «·„‰Ì«
url = "https://sh.dataspace.copernicus.eu/catalog/v1/search"

# »Ì«‰«  «·»ÕÀ «·Ã€—«›Ì Ê«·“„‰Ì („À«· ·ﬁÿ«⁄ „Õœœ)
data = {
    "bbox": [30.5, 27.8, 30.9, 28.3],
    "datetime": "2026-06-01T00:00:00Z/2026-08-13T23:59:59Z",
    "collections": ["sentinel-2-l2a"],
    "limit": 5,
}

print("Connecting to Copernicus Catalog API...")
response = requests.post(url, json=data)

if response.status_code == 200:
    result = response.json()
    print("SUCCESS: Catalog data retrieved successfully.")
    print(f"Total features found: {len(result.get('features', []))}")
    
    # Õ›Ÿ «·‰ «∆Ã √Ê «· ⁄«„· „⁄Â«
    os.makedirs('sectors_output', exist_ok=True)
    import json
    with open('sectors_output/catalog_results.json', 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=4)
    print("Saved catalog metadata to sectors_output/catalog_results.json")
else:
    print(f"ERROR: Failed with status code {response.status_code}")
    print(response.text)