import os
import numpy as np
from PIL import Image
from sentinelhub import SentinelHubRequest, BBox, CRS, SHConfig, DataCollection, MimeType
config = SHConfig()
config.sh_client_id = "sh-b97194a6-7b69-44e5-8237-f8d797bdf140"
config.sh_client_secret = "z8Ngup25USAtKvfPsEqueuEhI1zWWNVi"
bbox = BBox(bbox=[27.8, 30.5, 28.3, 30.9], crs=CRS.WGS84)
request = SentinelHubRequest(
    evalscript="""
        function setup() {
            return {
                input: [{bands: ["B04", "B03", "B02"]}],
                output: {bands: 3}
            };
        }
        function evaluatePixel(sample) {
            return [2.5 * sample.B04, 2.5 * sample.B03, 2.5 * sample.B02];
        }
    """,
    input_data=[
        SentinelHubRequest.input_data(
            data_collection=DataCollection.SENTINEL2_L2A,
            time_interval=("2026-06-01", "2026-08-13"),
        )
    ],
    responses=[
    ],
    bbox=bbox,
    resolution=(10, 10),
    config=config
)
