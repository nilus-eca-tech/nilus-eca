import os  
from dotenv import load_dotenv  
from sentinelhub import SHConfig  
load_dotenv()  
config = SHConfig()  
print("Credentials Configured Successfully!") 
