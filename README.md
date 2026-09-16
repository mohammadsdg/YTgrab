# YTgrab

A self-hosted YouTube client I use for searching, following channels, watching videos, and downloading stuff. There is a Telegram bot too.

## What you need

- Node.js 18+
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
```

Use whatever password you want. `YTGRAB_URL` should be the address where you open YTgrab.

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
