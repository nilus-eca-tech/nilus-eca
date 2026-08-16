# -*- coding: utf-8 -*-
import os
import requests

class NumericIndexPipeline:
    def __init__(self, output_dir="sectors_output"):
        self.output_dir = output_dir
        os.makedirs(self.output_dir, exist_ok=True)
        self.base_url = "https://sh.dataspace.copernicus.eu/batch/v2/process"

    def create_numeric_indexed_batch(self, oauth_client, s3_bucket, access_key, secret_key):
        """
        إنشاء طلب معالجة دفعة باستخدام المعرفات الرقمية للمدخلات (0 و 1) وتصفية SCL
        """
        print("[-] Creating Numeric Indexed Batch Request...")

        evalscript = """
        //VERSION=3
        function setup() {
          return {
            input: [
              {bands: ["B02", "B03", "B04"], units: "REFLECTANCE", mosaicking: "ORBIT"},
              {bands: ["SCL"], units: "DN", mosaicking: "ORBIT"}
            ],
            output: [
              {id: "default", bands: 3, sampleType: SampleType.AUTO}
            ]
          }
        }

        function evaluatePixel(samples) {
          var l1cMosaics = samples['0']; 
          var l1cSample = l1cMosaics[0]; 
          var scl = samples['1'][0].SCL; 
          
          if (2 <= scl && scl <= 7) {
            return [l1cSample.B04, l1cSample.B03, l1cSample.B02];
          }
          return [0, 0, 0];
        }
        """

        payload = {
            "processRequest": {
                "input": {
                    "bounds": {
                        "bbox": [30.5, 27.8, 30.9, 28.3],
                        "properties": {
                            "crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84"
                        }
                    },
                    "data": [
                        {
                            "type": "sentinel-2-l1c",
                            "dataFilter": {
                                "timeRange": {
                                    "from": "2026-06-01T00:00:00Z",
                                    "to": "2026-08-13T23:59:59Z"
                                },
                                "mosaickingOrder": "leastRecent"
                            }
                        },
                        {
                            "type": "sentinel-2-l2a",
                            "dataFilter": {
                                "timeRange": {
                                    "from": "2026-06-01T00:00:00Z",
                                    "to": "2026-08-13T23:59:59Z"
                                },
                                "mosaickingOrder": "leastRecent"
                            }
                        }
                    ]
                },
                "output": {
                    "responses": [{
                        "identifier": "default",
                        "format": {
                            "type": "image/tiff"
                        }
                    }]
                },
                "evalscript": evalscript
            },
            "input": {
                "type": "tiling-grid",
                "id": 0,
                "resolution": 60.0
            },
            "output": {
                "type": "raster",
                "delivery": {
                    "s3": {
                        "url": f"s3://{s3_bucket}",
                        "accessKey": access_key,
                        "secretAccessKey": secret_key
                    }
                }
            },
            "description": "Numeric Indexed Batch Processing for S2 L1C and L2A"
        }

        headers = {'Content-Type': 'application/json'}
        
        try:
            response = oauth_client.request("POST", self.base_url, headers=headers, json=payload)
            if response.status_code in [200, 201]:
                res_data = response.json()
                batch_id = res_data.get('id')
                print(f"[+] Numeric indexed batch request created successfully. Request ID: {batch_id}")
                return batch_id
            else:
                print(f"[!] Error {response.status_code}: {response.text}")
                return None
        except Exception as e:
            print(f"[!] Exception occurred: {e}")
            return None

if __name__ == "__main__":
    print("[-] Numeric Index Pipeline module is fully adjusted and ready.")