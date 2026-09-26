# Aurora Music Web

Aurora Music's responsive web client and streaming API, with song search, YouTube Music playback, synced and romanized lyrics, radio, queue, playlists, listening history, equalizer, and Liquid Glass styling.

## Run locally

Requirements: Node.js 22 or later and Python 3. Install the packages and start the combined Express and Vite app:

```sh
npm ci
python -m venv .venv
python -m pip install -r requirements.txt
npm run dev
```

Open `http://localhost:4173`. The web app uses yt-dlp for audio streams and an upstream YouTube Music client for catalog metadata. Upstream availability can change.

## Sign-in and personalized recommendations

Google sign-in is optional. Add the OAuth web client and YouTube Data API credentials described in `YOUTUBE_SIGN_IN.md` to the hosting service. Never commit secrets or `.env` files.

## Deploy to Render

This app includes a Render Blueprint. Connect the private GitHub repository to Render, select the Blueprint, and apply it. The build installs Node and yt-dlp in an isolated Python environment; the Express service streams audio for the length of the request.

The provided configuration uses Render's free web service, which can spin down after inactivity and take a little time to wake up. Choose a paid instance in Render if you need it to stay warm.
