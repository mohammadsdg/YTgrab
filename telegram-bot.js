
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const YTGRAB_URL = process.env.YTGRAB_URL?.replace(/\/$/, '');
const YTGRAB_PASSWORD = process.env.YTGRAB_PASSWORD;
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS;

const missingEnv = [
  ['TELEGRAM_BOT_TOKEN', TOKEN],
  ['YTGRAB_URL', YTGRAB_URL],
  ['YTGRAB_PASSWORD', YTGRAB_PASSWORD],
  ['ALLOWED_USER_IDS', ALLOWED_USER_IDS],
].filter(([, value]) => !value).map(([name]) => name);

if (missingEnv.length) {
  console.error(`Missing required values in .env: ${missingEnv.join(', ')}`);
  process.exit(1);
}

try {
  const url = new URL(YTGRAB_URL);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
} catch {
  console.error('YTGRAB_URL must be a valid http:// or https:// URL in .env');
  process.exit(1);
}

const ALLOWED_IDS = ALLOWED_USER_IDS
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (ALLOWED_IDS.length === 0 || ALLOWED_IDS.some((id) => !/^\d+$/.test(id))) {
  console.error('ALLOWED_USER_IDS must contain one or more numeric Telegram user IDs');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

let sessionCookie = null;

async function login() {
  const res = await axios.post(
    `${YTGRAB_URL}/api/login`,
    { password: YTGRAB_PASSWORD },
    { validateStatus: () => true }
  );
  const setCookie = res.headers['set-cookie'];
  if (res.status !== 200 || !setCookie) {
    throw new Error('Could not log in to ytgrab server (check YTGRAB_PASSWORD).');
  }
  sessionCookie = setCookie[0].split(';')[0];
  return sessionCookie;
}

async function api(method, url, data) {
  if (!sessionCookie) await login();
  let res = await axios({
    method,
    url: `${YTGRAB_URL}${url}`,
    data,
    headers: { Cookie: sessionCookie },
    validateStatus: () => true,
  });
  if (res.status === 401) {
    await login();
    res = await axios({
      method,
      url: `${YTGRAB_URL}${url}`,
      data,
      headers: { Cookie: sessionCookie },
      validateStatus: () => true,
    });
  }
  return res;
}

function isAllowed(userId) {
  return ALLOWED_IDS.includes(String(userId));
}

function extractUrl(text) {
  const m = text.match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}

function extractVideoId(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\.|^m\./g, '');
    if (host === 'youtu.be') return url.pathname.split('/')[1] || null;
    if (host === 'youtube.com') {
      if (url.pathname === '/watch') return url.searchParams.get('v');
      return url.pathname.match(/^\/(shorts|embed|live)\/([^/?]+)/)?.[2] || null;
    }
  } catch { return null; }
  return null;
}

const QUALITIES = ['best', '2160', '1440', '1080', '720', '480', '360', 'audio'];

function qualityKeyboard(videoId) {
  return {
    inline_keyboard: [
      [
        { text: '1080p', callback_data: `q:1080:${videoId}` },
        { text: '720p', callback_data: `q:720:${videoId}` },
        { text: '480p', callback_data: `q:480:${videoId}` },
      ],
      [
        { text: 'Best 🔥', callback_data: `q:best:${videoId}` },
        { text: 'Just audio 🎧', callback_data: `q:audio:${videoId}` },
      ],
    ],
  };
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "yo 👋 drop a youtube link whenever and i'll sort it out for you"
  );
});

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  if (!isAllowed(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, "nah you're not on the list for this one 👀");
  }

  const url = extractUrl(msg.text);
  const videoId = url && extractVideoId(url);
  if (videoId) {
    return bot.sendMessage(msg.chat.id, 'bet, what quality you want?', {
      reply_markup: qualityKeyboard(videoId),
    });
  }

  try {
    const response = await api('get', `/api/search?q=${encodeURIComponent(msg.text.trim())}`);
    const results = (response.data.results || []).slice(0, 6);
    if (!results.length) return bot.sendMessage(msg.chat.id, 'nothing came up for that one');
    return bot.sendMessage(msg.chat.id, 'here’s what I found', {
      reply_markup: {
        inline_keyboard: results.map((item) => [{
          text: item.title.slice(0, 55),
          callback_data: `v:${item.id}`,
        }]),
      },
    });
  } catch (err) {
    return bot.sendMessage(msg.chat.id, `search failed — ${err.message}`);
  }
});

const PROGRESS_LINES = ['still cooking', 'on it', 'grabbing it now', 'almost there', 'working on it'];
const DONE_LINES = ["done, here you go 🔥", "got it, all yours", "sorted — grab it below"]; // just wanted to feel chill man
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

bot.on('callback_query', async (query) => {
  if (!isAllowed(query.from.id)) {
    return bot.answerCallbackQuery(query.id, { text: "not for you, sorry 🙅" });
  }

  if (query.data.startsWith('v:')) {
    const videoId = query.data.slice(2);
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return;
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(query.message.chat.id, 'nice pick — choose a quality', {
      reply_markup: qualityKeyboard(videoId),
    });
  }

  const [, quality, videoId] = query.data.split(':');
  if (!QUALITIES.includes(quality)) return;
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return;
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  bot.answerCallbackQuery(query.id);
  const chatId = query.message.chat.id;
  const statusMsg = await bot.sendMessage(chatId, 'on it 🚀');

  try {
    const startRes = await api('post', '/api/download', { url, quality });
    if (startRes.status !== 200) {
      throw new Error(startRes.data?.error || "couldn't start that one");
    }
    const jobId = startRes.data.id;

    let done = false;
    let lastEdit = 0;
    while (!done) {
      await new Promise((r) => setTimeout(r, 2000));
      const statusRes = await api('get', `/api/status/${jobId}`);
      const data = statusRes.data;

      if (data.status === 'processing') {
        const p = Math.round(data.progress || 0);
        const now = Date.now();
        if (now - lastEdit > 3000) {
          lastEdit = now;
          const line = p ? `${pick(PROGRESS_LINES)} — ${p}%` : pick(PROGRESS_LINES);
          bot
            .editMessageText(line, {
              chat_id: chatId,
              message_id: statusMsg.message_id,
            })
            .catch(() => {});
        }
      } else if (data.status === 'done') {
        done = true;
        const fileUrl = `${YTGRAB_URL}${data.url}`;
        await bot.editMessageText(`${pick(DONE_LINES)}\n${fileUrl}`, {
          chat_id: chatId,
          message_id: statusMsg.message_id,
        });
      } else if (data.status === 'error') {
        done = true;
        await bot.editMessageText(`hmm, that one didn't work — ${data.error}`, {
          chat_id: chatId,
          message_id: statusMsg.message_id,
        });
      }
    }
  } catch (err) {
    bot
      .editMessageText(`something broke on my end — ${err.message}`, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
      })
      .catch(() => bot.sendMessage(chatId, `something broke — ${err.message}`));
  }
});

console.log('Telegram bot running.');
