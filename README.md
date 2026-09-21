# YTgrab

A self-hosted YouTube client I use for searching, following channels, watching videos, and downloading stuff. There is a Telegram bot too.

## What you need

- Node.js 22+
- `yt-dlp`
- `ffmpeg`

Make sure those commands work:

```bash
node --version
yt-dlp --version
ffmpeg -version
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
# Optional fallback for challenged videos:
# YT_DLP_COOKIES=cookies.txt
```

Use whatever password you want. `YTGRAB_URL` should be the address where you open YTgrab.

Keep yt-dlp current. YTgrab allows yt-dlp to select its current supported YouTube client and enables the EJS challenge solver. Node.js 22 or newer can be used as its JavaScript runtime. If YouTube still challenges your server IP, export a Netscape-format `cookies.txt`, place it in this directory, uncomment `YT_DLP_COOKIES=cookies.txt`, and restart. Never commit or share that file.

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
