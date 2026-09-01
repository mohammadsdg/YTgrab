# ytgrab

A tiny self-hosted YouTube downloader. Paste a link, pick a quality, get an mp4 (or mp3).

I made this because I was tired of sketchy download sites full of ads. Used AI to help knock out the frontend, coded the backend myself. Also threw together a Telegram bot so I can grab stuff straight from my phone without opening the site.
## What's in here

- `server.js` — the app (Node + Express). Talks to `yt-dlp` + `ffmpeg` behind the scenes.
- `index.html` / `login.html` — the UI. (I know it is good to use Reactjs and Next but who cares bruh, i just wanted to download videos and html was just easy to go)
- `telegram-bot.js` — optional Telegram bot that talks to the server's API.

## Requirements

- Node.js (16+)
- `yt-dlp` installed and on your PATH
- `ffmpeg` installed and on your PATH

## Running it

Works on literally any machine that can run Node — a VPS, a spare laptop, a Raspberry Pi, whatever.

```bash
npm install
node server.js
```

Open `http://localhost:3000` (or your server's IP/domain). change the password from env:

```bash
YTGRAB_PASSWORD="something-only-you-know" node server.js
```

Keep it running after you close the terminal / reboot with `pm2`:

```bash
npm install -g pm2
pm2 start server.js --name ytgrab --env production
pm2 save
pm2 startup
```

Just in case wanted to connect it a domain: Stick nginx (or Caddy) in front of it as a reverse proxy and grab a free HTTPS cert with certbot. Don't run this over plain HTTP on the open internet — the password goes in clear text otherwise.

## Telegram bot (optional)

```bash
cp bot-package.json package.json   # in a separate folder, or just add its deps to your existing one
npm install
cp .env.example .env
```

Fill in `.env`:

```
TELEGRAM_BOT_TOKEN=   # get one from @BotFather
YTGRAB_URL=           # e.g. http://127.0.0.1:3000 or your domain
YTGRAB_PASSWORD=      # same one your server uses
ALLOWED_USER_IDS=     # your Telegram user id(s), comma separated, so randoms can't use your bot
```

Then:

```bash
node telegram-bot.js
```

Send it a YouTube link, pick a quality from the buttons, it downloads it server-side and sends the file back in chat (or a link if it's too big for Telegram to push directly). Run it with `pm2` too if you want it always on.

## Notes

- One shared password, no real multi-user accounts — fine for personal use, not for handing out to a group.
- Downloaded files stick around on the server until you delete them from the file list (or hook up a cron job if you'd rather they auto-clean).
