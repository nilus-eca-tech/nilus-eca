from sentinelhub import SHConfig
from sentinelhub.oauth import SentinelHubSession

config = SHConfig()
config.sh_client_id = "38c9832d-1bdd-4172-8855-34b940b0af35"
config.sh_client_secret = "pp5Fb1TkDMtiITaeZmT4s3ZWKGfy93hO"

print("Attempting to get session token...")
try:
    session = SentinelHubSession(config=config)
    print("SUCCESS: Authenticated successfully! Token acquired.")
except Exception as e:
    print(f"FAILED: {e}")