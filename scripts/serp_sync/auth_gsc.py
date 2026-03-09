"""
One-time Google Search Console OAuth2 setup.

Run this script ONCE to authenticate and save a refresh token.
Subsequent runs of main.py will use the saved token automatically.

Usage:
    python auth_gsc.py

What happens:
    1. Opens your browser at Google's login page
    2. You log in with the Google account that has GSC access
    3. You grant permission to read Search Console data
    4. The refresh token is saved to gsc_token.json

Requirements:
    - bpm_client_secret.json must exist at the path set in config.py
    - The Google Cloud project must have the Search Console API enabled
      (console.cloud.google.com > APIs & Services > Search Console API)
"""
import json
import sys
import os

# Ensure we can import config from the same directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from google_auth_oauthlib.flow import InstalledAppFlow
import config


def setup() -> None:
    if not os.path.exists(config.GSC_CLIENT_SECRET_FILE):
        print(f"ERROR: Client secret file not found:\n  {config.GSC_CLIENT_SECRET_FILE}")
        sys.exit(1)

    print("Starting OAuth2 flow for Google Search Console...")
    print(f"  Client secret : {config.GSC_CLIENT_SECRET_FILE}")
    print(f"  Token will be : {config.GSC_TOKEN_FILE}")
    print(f"  Scopes        : {config.GSC_SCOPES}")
    print()
    print("Your browser will open. Log in and grant access.")
    print()

    flow = InstalledAppFlow.from_client_secrets_file(
        config.GSC_CLIENT_SECRET_FILE,
        scopes=config.GSC_SCOPES,
    )
    # run_local_server opens the browser and handles the redirect automatically
    creds = flow.run_local_server(port=0, open_browser=True)

    token_data = {
        "token":         creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri":     creds.token_uri,
        "client_id":     creds.client_id,
        "client_secret": creds.client_secret,
        "scopes":        list(creds.scopes) if creds.scopes else config.GSC_SCOPES,
    }

    os.makedirs(os.path.dirname(config.GSC_TOKEN_FILE), exist_ok=True)
    with open(config.GSC_TOKEN_FILE, "w") as f:
        json.dump(token_data, f, indent=2)

    print(f"\nSuccess! Token saved to:\n  {config.GSC_TOKEN_FILE}")
    print("\nYou can now run main.py — it will use this token automatically.")

    # Quick verification
    if not creds.refresh_token:
        print("\nWARNING: No refresh_token received.")
        print("This usually means the app was already authorized.")
        print("To force a new token, delete gsc_token.json and run this script again,")
        print("or go to https://myaccount.google.com/permissions and revoke access first.")


if __name__ == "__main__":
    setup()
