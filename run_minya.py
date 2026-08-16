import os  
import numpy as np  
from PIL import Image  
from dotenv import load_dotenv  
from sentinelhub import SentinelHubRequest, BBox, CRS, SHConfig  
load_dotenv()  
config = SHConfig()  
config.sh_client_id = os.getenv('SH_CLIENT_ID')  
config.sh_client_secret = os.getenv('SH_CLIENT_SECRET')  
bbox = BBox(bbox=[30.5, 27.8, 30.9, 28.3], crs=CRS.WGS84)  
request = SentinelHubRequest(evalscript="function setup() { return { input: [{bands: [\"B04\", \"B03\", \"B02\"]}], output: {bands: 3} }; } function evaluatePixel(sample) { return [2.5 * sample.B04, 2.5 * sample.B03, 2.5 * sample.B02]; }", input_data=[SentinelHubRequest.input_data(data_collection="SENTINEL-2", time_interval=("2026-06-01", "2026-08-13"))], responses=[SentinelHubRequest.output_response('default', mime_type='image/tiff')], bbox=bbox, resolution=10, config=config)  
print("Connecting and fetching data for Minya...")  
data = request.get_data()  
if data and len(data)  
    os.makedirs('sectors_output', exist_ok=True)  
    image = np.array(data[0])  
    img = Image.fromarray(image.astype('uint8'))  
    img.save('sectors_output/minya_analysis.tiff')  
    print("SUCCESS: Saved to sectors_output/minya_analysis.tiff")  
else:  
