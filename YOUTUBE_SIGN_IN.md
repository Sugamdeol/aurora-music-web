# YouTube Music sign-in for web

Aurora uses Google's read-only YouTube authorization to read the signed-in channel's liked videos, then uses those video IDs as seeds for Aurora's existing related-music recommendations. It does not upload or store the Google access token or persist the account's likes on the server.

## Configure Google

1. In Google Cloud Console, enable **YouTube Data API v3** and configure the OAuth consent screen.
2. Create a **Web application** OAuth client. Add the exact JavaScript origins where Aurora runs, such as `http://localhost:4173`, `http://localhost:4174`, and the production HTTPS origin.
3. Create an API key and restrict it to **YouTube Data API v3**.
4. Copy `.env.example` to `.env` and set:

```dotenv
VITE_GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
GOOGLE_YOUTUBE_API_KEY=your-server-only-api-key
```

The two client ID values must match. Keep the API key in the server-only `GOOGLE_YOUTUBE_API_KEY` variable; do not add it to a `VITE_` variable or commit `.env`. Restart the web server after setting these values.

The Google consent requests `https://www.googleapis.com/auth/youtube.readonly`. Google may require OAuth app verification before this sensitive scope can be used by the public.
