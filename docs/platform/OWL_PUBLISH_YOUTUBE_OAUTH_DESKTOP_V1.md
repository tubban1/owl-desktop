OWL Publish YouTube OAuth Desktop V1

Metadata only: service identity records with needs_login do not authorize platform APIs.

Google: enable YouTube Data API v3, create Google OAuth Desktop app Client ID. Enter the public Client ID under Desktop > Account > Connected Service Identities > YouTube. Save. Connect YouTube opens official Google browser login, loopback callback on 127.0.0.1 with PKCE/state, requests youtube.readonly, youtube.upload, openid/email. Only verified Google email and exactly one owned channels.list mine=true channel becomes a verified identity. Tokens are encrypted via Electron safeStorage, not available in the renderer or MCP. Changing account information/client ID forces a reconnect.

Instagram: unchanged metadata; real Meta Professional login and app setup are not yet connected. No platform password should be stored.

Important: OAuth identity verified does not grant a Runtime publication approval. Official live Runtime provider, refresh and revocation, private YouTube upload and separate Instagram public approval are still release gates. No actual browser authentication/upload or fees in this implementation. Running Electron main process needs restart to expose the new IPC; do not restart current Runtime unnecessarily.

Verification: fake-Google OAuth loopback tests, encrypted-vault tests, npm test, npm run build.
