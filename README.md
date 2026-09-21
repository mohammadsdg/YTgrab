# YTgrab

A self-hosted YouTube client I use for searching, following channels, watching videos, and downloading stuff. There is a Telegram bot too.

## What you need

- Node.js 20.19+
- A current `yt-dlp` installation with its default dependencies
- `ffmpeg`
- Docker, for the recommended PO-token service
- Deno 2.3+ when Node.js is older than 22

Make sure those commands work:

```bash
node --version
yt-dlp --version
ffmpeg -version
deno --version
```

## Setup

Install the dependencies:

```bash
npm install
```

Create your `.env` file:

```bash
cp .env.example .env
```

Open `.env` and fill everything in:

```env
PORT=3000
YTGRAB_PASSWORD=change-this
YTGRAB_URL=http://127.0.0.1:3000
TELEGRAM_BOT_TOKEN=your-bot-token
ALLOWED_USER_IDS=your-telegram-user-id
# Recommended on hosted/datacenter servers:
YT_DLP_COOKIES=cookies.txt
# Optional; use the exact value from the browser that exported the cookies:
# YT_DLP_USER_AGENT=Mozilla/5.0 ...
# Optional alternate outbound address:
# YT_DLP_PROXY=http://user:password@host:port
```

Use whatever password you want. `YTGRAB_URL` should be the address where you open YTgrab.

## YouTube authentication on a server

YouTube commonly challenges datacenter IP addresses. YTgrab uses yt-dlp's `mweb` client for media, enables its EJS challenge solver, supports authenticated cookies, and limits concurrent YouTube requests. For reliable streaming and downloads on a hosted server, configure both a PO-token provider and cookies.

### 1. Install and run the PO-token provider

Install the plugin into the same Python environment as yt-dlp:

```bash
python3 -m pip install -U bgutil-ytdlp-pot-provider
```

On Debian with an externally managed Python environment, use:

```bash
python3 -m pip install -U bgutil-ytdlp-pot-provider --break-system-packages
```

Run the provider on loopback only:

```bash
docker run --name bgutil-provider --restart unless-stopped -d --init \
  -p 127.0.0.1:4416:4416 brainicism/bgutil-ytdlp-pot-provider
```

If the container already exists, start it instead:

```bash
docker start bgutil-provider
```

Verify that `yt-dlp -v VIDEO_URL` reports `PO Token Providers: bgutil:http-...`.

### 2. Export and install YouTube cookies

Treat `cookies.txt` like a password. Prefer a throwaway YouTube account, never commit the file, and never paste its contents into chat or an issue.

1. Open a new private/incognito browser window and allow a trusted local cookie-export extension in that window.
2. Sign into YouTube.
3. In that same tab, navigate to `https://www.youtube.com/robots.txt`.
4. Export the `youtube.com` cookies in Netscape format.
5. Close the private window permanently so YouTube does not rotate that session.
6. Upload the file directly to the YTgrab project directory as `cookies.txt`.

On the server:

```bash
chmod 600 cookies.txt
```

The file must begin with `# Netscape HTTP Cookie File`. Set `YT_DLP_COOKIES=cookies.txt` in `.env`. If needed, set `YT_DLP_USER_AGENT` to the exact User-Agent from the browser session that exported the cookies.

Test the complete media configuration before starting YTgrab:

```bash
yt-dlp --cookies cookies.txt \
  --extractor-args "youtube:player_client=mweb" \
  -F "https://www.youtube.com/watch?v=VIDEO_ID"
```

Do not start YTgrab until that command lists formats successfully. Refresh the cookie file using the same process if YouTube later returns `LOGIN_REQUIRED` again.

Start it:

```bash
npm start
```

Then open `http://127.0.0.1:3000`, or whatever address and port you configured.

## Running things separately

```bash
npm run start:web
npm run start:bot
```

## Keeping it alive

If you use PM2:

```bash
npm install -g pm2
pm2 start npm --name ytgrab -- start
pm2 save
pm2 startup
```

That's pretty much it.
