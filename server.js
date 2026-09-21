require('dotenv').config();
const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const app = express();
const PORT = Number(process.env.PORT);
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
const DATA_DIR = path.join(__dirname, 'data');
const STREAM_DIR = path.join(DATA_DIR, 'streams');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const DOWNLOAD_METADATA_FILE = path.join(DATA_DIR, 'downloads.json');
const PREFERENCES_FILE = path.join(DATA_DIR, 'preferences.json');
const CUSTOM_BACKGROUND_FILE = path.join(DATA_DIR, 'background.webp');
const DEFAULT_BACKGROUND_FILE = path.join(__dirname, 'client', 'public', 'mountains.webp');
const CLIENT_DIST = path.join(__dirname, 'client', 'dist');

const PASSWORD = process.env.YTGRAB_PASSWORD;
const COOKIES_FILE = process.env.YT_DLP_COOKIES ? path.resolve(__dirname, process.env.YT_DLP_COOKIES) : null;
const NODE_MAJOR = Number.parseInt(process.versions.node.split('.')[0], 10);
const YT_DLP_USER_AGENT = process.env.YT_DLP_USER_AGENT?.trim();
const YT_DLP_PROXY = process.env.YT_DLP_PROXY?.trim();

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('PORT must be set to a valid port number in .env');
  process.exit(1);
}
if (!PASSWORD) {
  console.error('YTGRAB_PASSWORD must be set in .env');
  process.exit(1);
}
if (COOKIES_FILE && !fs.existsSync(COOKIES_FILE)) {
  console.error(`YT_DLP_COOKIES does not exist: ${COOKIES_FILE}`);
  process.exit(1);
}
app.disable('x-powered-by');
const SESSION_COOKIE = 'ytgrab_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const sessions = new Map(); // token -> expiry timestamp
const searchCache = new Map();
const SEARCH_CACHE_TTL_MS = 1000 * 60 * 5;
const feedCache = new Map();
const FEED_CACHE_TTL_MS = 1000 * 60 * 10;
const SEARCH_LIMIT = 20;
const channelAvatarCache = new Map();
const ytDlpMetadataQueue = [];
let activeYtDlpMetadata = 0;
const MAX_YT_DLP_METADATA = 2;
const STREAM_CACHE_VERSION = 'hls-v5';
const STREAM_QUALITIES = new Set(['audio', '480', '720', '1080']);
const MAX_ACTIVE_DOWNLOADS = 3;
const MAX_ACTIVE_STREAMS = 2;
const DOWNLOAD_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_TOKEN_SECRET = crypto.createHash('sha256').update(`ytgrab-download:${PASSWORD}`).digest();

function getPerformanceMode() {
  return readJsonFile(PREFERENCES_FILE, { performanceMode: 'chill' }).performanceMode === 'heavy' ? 'heavy' : 'chill';
}

if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(STREAM_DIR)) fs.mkdirSync(STREAM_DIR);

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(file, value) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

app.use(helmet({
  contentSecurityPolicy: false,
  strictTransportSecurity: false
}));
app.use(express.json({ limit: '64kb', strict: true }));

// ---------- auth helpers ----------

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function isAuthed(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return false;
  const expiry = sessions.get(token);
  if (!expiry || expiry < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function makeFileToken(filename) {
  const expires = Date.now() + DOWNLOAD_TOKEN_TTL_MS;
  const signature = crypto.createHmac('sha256', DOWNLOAD_TOKEN_SECRET).update(`${filename}:${expires}`).digest('hex');
  return `${expires}.${signature}`;
}

function verifyFileToken(filename, token) {
  if (typeof token !== 'string' || token.length > 100) return false;
  const separator = token.indexOf('.');
  if (separator < 1) return false;
  const expiresText = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^\d{13}$/.test(expiresText) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires) || expires <= Date.now()) return false;
  const expected = crypto.createHmac('sha256', DOWNLOAD_TOKEN_SECRET).update(`${filename}:${expires}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

// periodically sweep expired sessions so the Map doesn't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of sessions) {
    if (expiry < now) sessions.delete(token);
  }
}, 1000 * 60 * 30);

const PUBLIC_PATHS = new Set(['/api/login']);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Try again later.' }
});
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1200,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/hls/')
});
const expensiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 80,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many media requests. Give the server a moment.' }
});

app.use((req, res, next) => {
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (req.method === 'GET' && req.path === '/api/background') return next();
  if (req.path.startsWith('/files/')) return next();
  if (!req.path.startsWith('/api/') && !req.path.startsWith('/files/')) return next();
  if (isAuthed(req)) return next();
  return res.status(401).json({ error: 'Not authenticated.' });
});
app.use('/api', apiLimiter);

// ---------- auth routes ----------

app.post('/api/login', loginLimiter, (req, res) => {
  const { password } = req.body || {};
  if (password !== PASSWORD) {
    return res.status(401).json({ error: 'Wrong password.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; SameSite=Lax`
  );
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  res.json({ authenticated: true });
});

app.get('/api/background', (req, res) => {
  const file = fs.existsSync(CUSTOM_BACKGROUND_FILE) ? CUSTOM_BACKGROUND_FILE : DEFAULT_BACKGROUND_FILE;
  if (!fs.existsSync(file)) return res.status(404).send('Background not found.');
  res.setHeader('Cache-Control', 'no-cache');
  res.type('image/webp').sendFile(file);
});

app.put('/api/background', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '15mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length < 100) {
    return res.status(400).json({ error: 'Choose a JPEG, PNG, or WebP image.' });
  }
  const temporary = path.join(DATA_DIR, `background-${crypto.randomBytes(8).toString('hex')}.upload`);
  const converted = path.join(DATA_DIR, `background-${crypto.randomBytes(8).toString('hex')}.webp`);
  fs.writeFileSync(temporary, req.body);
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', temporary,
    '-vf', 'scale=min(1920\\,iw):-2', '-frames:v', '1',
    '-c:v', 'libwebp', '-quality', '82', converted
  ];
  const proc = spawn('ffmpeg', args);
  let stderr = '';
  let settled = false;
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  proc.on('error', (error) => {
    if (settled) return;
    settled = true;
    fs.unlink(temporary, () => {});
    fs.unlink(converted, () => {});
    res.status(500).json({ error: `Could not start ffmpeg: ${error.message}` });
  });
  proc.on('close', (code) => {
    if (settled) return;
    settled = true;
    fs.unlink(temporary, () => {});
    if (code !== 0 || !fs.existsSync(converted)) {
      fs.unlink(converted, () => {});
      return res.status(400).json({ error: stderr.slice(-500) || 'Could not convert that image.' });
    }
    fs.renameSync(converted, CUSTOM_BACKGROUND_FILE);
    res.json({ ok: true, url: `/api/background?v=${Date.now()}` });
  });
});

app.delete('/api/background', (req, res) => {
  if (!fs.existsSync(CUSTOM_BACKGROUND_FILE)) return res.json({ ok: true });
  fs.unlink(CUSTOM_BACKGROUND_FILE, (error) => {
    if (error) return res.status(500).json({ error: 'Could not reset the background.' });
    res.json({ ok: true, url: `/api/background?v=${Date.now()}` });
  });
});

// ---------- protected app routes (everything below requires auth) ----------

app.get('/files/:name', (req, res) => {
  const name = path.basename(req.params.name); // block path traversal
  const fp = path.join(DOWNLOAD_DIR, name);

  if (path.dirname(fp) !== DOWNLOAD_DIR || !fs.existsSync(fp)) {
    return res.status(404).send('Not found.');
  }

  if (!isAuthed(req) && !verifyFileToken(name, req.query.token)) {
    return res.status(401).send('This download link is invalid or has expired.');
  }

  res.download(fp, name);
});

// in-memory job tracking: { [id]: { status, filename, error, progress } }
const jobs = {};
const streamJobs = {};

function isValidYoutubeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    return host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com';
  } catch {
    return false;
  }
}

function isValidVideoId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
}

function proxiedImageUrl(url) {
  return url ? `/api/image?url=${encodeURIComponent(url)}` : '';
}

function pickChannelImage(thumbnails, kind) {
  if (!Array.isArray(thumbnails)) return '';
  const named = thumbnails.filter((item) => String(item.id || '').toLowerCase().includes(kind));
  const candidates = named.length ? named : thumbnails;
  return candidates
    .filter((item) => item && typeof item.url === 'string')
    .sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)))[0]?.url || '';
}

function ytDlpArgs(args) {
  const common = ['--remote-components', 'ejs:github'];
  if (NODE_MAJOR >= 22) common.push('--js-runtimes', 'node');
  if (COOKIES_FILE) common.push('--cookies', COOKIES_FILE);
  if (YT_DLP_USER_AGENT) common.push('--user-agent', YT_DLP_USER_AGENT);
  if (YT_DLP_PROXY) common.push('--proxy', YT_DLP_PROXY);
  return [...common, ...args];
}

function ytDlpMediaArgs(args) {
  return ytDlpArgs([
    // Current yt-dlp guidance recommends mweb with an installed PO-token
    // provider. The provider supplies a fresh video-bound token automatically.
    '--extractor-args', 'youtube:player_client=mweb',
    ...args
  ]);
}

function acquireYtDlpMetadataSlot() {
  return new Promise((resolve) => {
    const enter = () => {
      activeYtDlpMetadata += 1;
      resolve(() => {
        activeYtDlpMetadata -= 1;
        ytDlpMetadataQueue.shift()?.();
      });
    };
    if (activeYtDlpMetadata < MAX_YT_DLP_METADATA) enter();
    else ytDlpMetadataQueue.push(enter);
  });
}

async function runYtDlp(args, timeoutMs = 30000) {
  const release = await acquireYtDlpMetadataSlot();
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', ytDlpArgs(args));
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.stdout.on('data', (chunk) => {
      if (stdout.length < 8 * 1024 * 1024) stdout += chunk.toString();
      else proc.kill('SIGKILL');
    });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      release();
      reject(error);
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      release();
      if (code !== 0) return reject(new Error(stderr.slice(-800) || 'yt-dlp failed'));
      resolve(stdout);
    });
  });
}

// Search runs on this server, so the browser never has to reach YouTube.
app.get('/api/search', expensiveLimiter, (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query || query.length > 200) {
    return res.status(400).json({ error: 'Search must be between 1 and 200 characters.' });
  }

  const page = Math.max(1, Math.min(25, Number.parseInt(req.query.page, 10) || 1));
  const requestedCount = page * SEARCH_LIMIT;
  const cacheKey = `${query.toLocaleLowerCase()}:${page}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return res.json({ results: cached.results });

  const args = [
    '--flat-playlist',
    '--dump-single-json',
    '--no-warnings',
    `ytsearch${requestedCount}:${query}`
  ];
  const proc = spawn('yt-dlp', ytDlpArgs(args));
  let stdout = '';
  let stderr = '';
  let settled = false;

  const timer = setTimeout(() => proc.kill('SIGKILL'), 30000);
  proc.stdout.on('data', (chunk) => {
    // Search JSON should be small; stop a broken process from consuming memory.
    if (stdout.length < 5 * 1024 * 1024) stdout += chunk.toString();
    else proc.kill('SIGKILL');
  });
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  proc.on('error', (err) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    res.status(500).json({ error: `Could not start yt-dlp: ${err.message}` });
  });
  proc.on('close', (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (code !== 0) {
      return res.status(502).json({ error: stderr.slice(-800) || 'YouTube search failed.' });
    }
    try {
      const data = JSON.parse(stdout);
      const allResults = (Array.isArray(data.entries) ? data.entries : [])
        .filter((entry) => entry && isValidVideoId(entry.id))
        .map((entry) => ({
          id: entry.id,
          title: entry.title || 'Untitled video',
          channel: entry.channel || entry.uploader || '',
          channelId: entry.channel_id || entry.uploader_id || '',
          duration: Number.isFinite(entry.duration) ? entry.duration : null,
          url: `https://www.youtube.com/watch?v=${entry.id}`,
          thumbnail: `/api/thumbnail/${entry.id}`,
          channelAvatar: entry.channel_id ? `/api/channel-avatar/${entry.channel_id}` : ''
        }));
      const results = allResults.slice((page - 1) * SEARCH_LIMIT, page * SEARCH_LIMIT);
      searchCache.set(cacheKey, { results, expires: Date.now() + SEARCH_CACHE_TTL_MS });
      res.json({ results, page, hasMore: results.length === SEARCH_LIMIT });
    } catch {
      res.status(502).json({ error: 'YouTube returned an unreadable search response.' });
    }
  });
});

// ---------- personal client ----------

app.get('/api/subscriptions', (req, res) => {
  res.json({ subscriptions: readJsonFile(SUBSCRIPTIONS_FILE, []) });
});

app.post('/api/subscriptions', (req, res) => {
  const { id, name } = req.body || {};
  if (typeof id !== 'string' || !/^UC[A-Za-z0-9_-]{20,30}$/.test(id) || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Invalid channel.' });
  }
  const subscriptions = readJsonFile(SUBSCRIPTIONS_FILE, []);
  if (!subscriptions.some((channel) => channel.id === id)) {
    subscriptions.push({ id, name: name.trim().slice(0, 100), avatar: `/api/channel-avatar/${id}`, followedAt: Date.now() });
    writeJsonFile(SUBSCRIPTIONS_FILE, subscriptions);
    feedCache.clear();
  }
  res.json({ subscriptions });
});

app.delete('/api/subscriptions/:id', (req, res) => {
  const subscriptions = readJsonFile(SUBSCRIPTIONS_FILE, [])
    .filter((channel) => channel.id !== req.params.id);
  writeJsonFile(SUBSCRIPTIONS_FILE, subscriptions);
  feedCache.clear();
  res.json({ subscriptions });
});

async function buildFeedPage(subscriptions, page) {
    const subscriptionKey = subscriptions.map((channel) => channel.id).sort().join(',');
    const performanceMode = getPerformanceMode();
    const cacheKey = `${performanceMode}:${subscriptionKey}:${page}`;
    const cached = feedCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.value;
    const perChannel = performanceMode === 'heavy' ? 8 : 3;
    const start = ((page - 1) * perChannel) + 1;
    const end = page * perChannel;
    const attempts = await Promise.allSettled(subscriptions.map(async (channel) => {
      const raw = await runYtDlp([
        '--flat-playlist', '--playlist-start', String(start), '--playlist-end', String(end), '--dump-single-json', '--no-warnings',
        `https://www.youtube.com/channel/${channel.id}/videos`
      ], 45000);
      const data = JSON.parse(raw);
      return (data.entries || []).map((entry) => ({
        ...entry,
        fallbackChannel: channel.name,
        fallbackChannelId: channel.id,
        fallbackAvatar: channel.avatar || `/api/channel-avatar/${channel.id}`
      }));
    }));
    const videos = attempts
      .filter((attempt) => attempt.status === 'fulfilled')
      .flatMap((attempt) => attempt.value)
      .filter((entry) => entry && isValidVideoId(entry.id))
      .map((entry) => ({
        id: entry.id,
        title: entry.title || 'Untitled video',
        channel: entry.channel || entry.uploader || entry.fallbackChannel,
        channelId: entry.channel_id || entry.uploader_id || entry.fallbackChannelId || '',
        duration: Number.isFinite(entry.duration) ? entry.duration : null,
        timestamp: entry.timestamp || null,
        thumbnail: `/api/thumbnail/${entry.id}`,
        channelAvatar: entry.channel_id ? `/api/channel-avatar/${entry.channel_id}` : entry.fallbackAvatar
      }))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (!videos.length && attempts.every((attempt) => attempt.status === 'rejected')) {
      const firstError = attempts.find((attempt) => attempt.status === 'rejected')?.reason;
      throw firstError || new Error('Could not load subscriptions.');
    }
    const value = { videos, page, hasMore: videos.length > 0 };
    const ttl = performanceMode === 'heavy' ? 1000 * 60 * 60 : FEED_CACHE_TTL_MS;
    feedCache.set(cacheKey, { value, expires: Date.now() + ttl });
    return value;
}

app.get('/api/feed', expensiveLimiter, async (req, res) => {
  const subscriptions = readJsonFile(SUBSCRIPTIONS_FILE, []).slice(0, 40);
  if (subscriptions.length === 0) return res.json({ videos: [], empty: true });
  try {
    const page = Math.max(1, Math.min(50, Number.parseInt(req.query.page, 10) || 1));
    res.json(await buildFeedPage(subscriptions, page));
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get('/api/preferences', (req, res) => {
  res.json({ performanceMode: getPerformanceMode() });
});

app.put('/api/preferences', (req, res) => {
  const performanceMode = req.body?.performanceMode;
  if (!['chill', 'heavy'].includes(performanceMode)) return res.status(400).json({ error: 'Invalid performance mode.' });
  writeJsonFile(PREFERENCES_FILE, { performanceMode });
  feedCache.clear();
  if (performanceMode === 'heavy') warmFeedCache([2]);
  res.json({ performanceMode });
});

app.get('/api/channels/:id', expensiveLimiter, async (req, res) => {
  const channelId = req.params.id;
  if (!/^UC[A-Za-z0-9_-]{20,30}$/.test(channelId)) {
    return res.status(400).json({ error: 'Invalid channel ID.' });
  }
  try {
    const page = Math.max(1, Math.min(50, Number.parseInt(req.query.page, 10) || 1));
    const pageSize = 24;
    const start = ((page - 1) * pageSize) + 1;
    const end = page * pageSize;
    const raw = await runYtDlp([
      '--flat-playlist', '--playlist-start', String(start), '--playlist-end', String(end), '--dump-single-json', '--no-warnings',
      `https://www.youtube.com/channel/${channelId}/videos`
    ], 45000);
    const data = JSON.parse(raw);
    const avatarUrl = pickChannelImage(data.thumbnails, 'avatar');
    const bannerUrl = pickChannelImage(data.thumbnails, 'banner');
    const videos = (data.entries || [])
      .filter((entry) => entry && isValidVideoId(entry.id))
      .map((entry) => ({
        id: entry.id,
        title: entry.title || 'Untitled video',
        channel: entry.channel || entry.uploader || data.channel || data.uploader || '',
        channelId,
        duration: Number.isFinite(entry.duration) ? entry.duration : null,
        timestamp: entry.timestamp || null,
        viewCount: Number.isFinite(entry.view_count) ? entry.view_count : null,
        channelAvatar: proxiedImageUrl(avatarUrl),
        thumbnail: `/api/thumbnail/${entry.id}`
      }));
    res.json({
      channel: {
        id: channelId,
        name: data.channel || data.uploader || videos[0]?.channel || 'Channel',
        handle: data.uploader_id || '',
        description: data.description || '',
        followers: Number.isFinite(data.channel_follower_count) ? data.channel_follower_count : null,
        videoCount: Number.isFinite(data.playlist_count) ? data.playlist_count : videos.length,
        avatar: proxiedImageUrl(avatarUrl),
        banner: proxiedImageUrl(bannerUrl)
      },
      videos,
      page,
      hasMore: videos.length === pageSize
    });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get('/api/history', (req, res) => {
  res.json({ history: readJsonFile(HISTORY_FILE, []) });
});

app.post('/api/history', (req, res) => {
  const { id, title, channel, channelId, channelAvatar } = req.body || {};
  if (!isValidVideoId(id)) return res.status(400).json({ error: 'Invalid video.' });
  const history = readJsonFile(HISTORY_FILE, []).filter((item) => item.id !== id);
  history.unshift({
    id,
    title: String(title || 'Untitled video').slice(0, 200),
    channel: String(channel || '').slice(0, 100),
    channelId: typeof channelId === 'string' ? channelId : '',
    channelAvatar: typeof channelAvatar === 'string' ? channelAvatar : (channelId ? `/api/channel-avatar/${channelId}` : ''),
    watchedAt: Date.now(),
    thumbnail: `/api/thumbnail/${id}`
  });
  writeJsonFile(HISTORY_FILE, history.slice(0, 100));
  res.json({ ok: true });
});

app.post('/api/stream/:id/prepare', expensiveLimiter, (req, res) => {
  const videoId = req.params.id;
  if (!isValidVideoId(videoId)) return res.status(400).json({ error: 'Invalid video ID.' });
  const quality = STREAM_QUALITIES.has(String(req.query.quality)) ? String(req.query.quality) : '720';
  const jobKey = `${videoId}:${quality}`;
  const finalDir = path.join(STREAM_DIR, `${videoId}-${quality}-${STREAM_CACHE_VERSION}`);
  const playlistFile = path.join(finalDir, 'index.m3u8');
  const buildingDir = path.join(STREAM_DIR, `${videoId}-${quality}-${STREAM_CACHE_VERSION}-building`);
  if (fs.existsSync(playlistFile)) {
    console.log(`[stream:${videoId}:${quality}] cache hit`);
    return res.json({ status: 'done', quality, url: `/api/hls/${videoId}/${quality}/index.m3u8` });
  }
  if (streamJobs[jobKey]?.status !== 'error') {
    if (streamJobs[jobKey]) return res.json(streamJobs[jobKey]);
  } else {
    delete streamJobs[jobKey];
  }
  const activeStreams = Object.values(streamJobs).filter((job) => ['downloading', 'converting'].includes(job.status)).length;
  if (activeStreams >= MAX_ACTIVE_STREAMS) return res.status(429).json({ error: 'The stream server is busy. Try again in a moment.' });

  console.log(`[stream:${videoId}:${quality}] preparing HLS stream`);
  streamJobs[jobKey] = { status: 'downloading', progress: 0, quality };
  const sourceTemplate = path.join(STREAM_DIR, `${videoId}-${quality}-source.%(ext)s`);
  const format = quality === 'audio'
    ? 'ba/bestaudio/b'
    : `bv*[height<=${quality}]+ba/b[height<=${quality}]/b`;
  const downloader = spawn('yt-dlp', ytDlpMediaArgs([
    '--no-playlist', '--newline',
    '-f', format,
    '--merge-output-format', 'mkv',
    '-o', sourceTemplate,
    `https://www.youtube.com/watch?v=${videoId}`
  ]));
  let downloadError = '';
  downloader.stdout.on('data', (chunk) => {
    const match = chunk.toString().match(/(\d+(?:\.\d+)?)%/);
    if (match) streamJobs[jobKey] = { status: 'downloading', progress: Number(match[1]), quality };
  });
  downloader.stderr.on('data', (chunk) => { downloadError += chunk.toString(); });
  downloader.on('error', (error) => {
    console.error(`[stream:${videoId}:${quality}] yt-dlp could not start: ${error.message}`);
    streamJobs[jobKey] = { status: 'error', error: `Could not start yt-dlp: ${error.message}`, quality };
  });
  downloader.on('close', (code) => {
    if (code !== 0) {
      console.error(`[stream:${videoId}:${quality}] yt-dlp failed (${code}): ${downloadError.slice(-1200)}`);
      streamJobs[jobKey] = { status: 'error', error: downloadError.slice(-800) || 'Could not prepare the video.', quality };
      return;
    }
    const source = fs.readdirSync(STREAM_DIR).find((name) => name.startsWith(`${videoId}-${quality}-source.`) && !name.endsWith('.part'));
    if (!source) {
      streamJobs[jobKey] = { status: 'error', error: 'Downloaded media file was not found.', quality };
      return;
    }
    const sourceFile = path.join(STREAM_DIR, source);
    console.log(`[stream:${videoId}:${quality}] download complete; creating HLS stream`);
    streamJobs[jobKey] = { status: 'converting', progress: 100, quality };
    if (fs.existsSync(buildingDir)) fs.rmSync(buildingDir, { recursive: true });
    fs.mkdirSync(buildingDir);
    const buildingPlaylist = path.join(buildingDir, 'index.m3u8');
    const segmentTemplate = path.join(buildingDir, 'segment-%05d.m4s');
    const mediaArgs = quality === 'audio'
      ? ['-vn', '-c:a', 'aac', '-b:a', '256k']
      : [
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
          '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-level:v', '4.1', '-tag:v', 'avc1',
          '-force_key_frames', 'expr:gte(t,n_forced*6)',
          '-c:a', 'aac', '-b:a', '192k'
        ];
    const converter = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', sourceFile,
      ...mediaArgs,
      '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod',
      // Completed VOD playlists always begin at segment zero.
      '-start_number', '0',
      '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
      '-hls_flags', 'independent_segments', '-hls_segment_filename', segmentTemplate,
      buildingPlaylist
    ]);
    let convertError = '';
    converter.stderr.on('data', (chunk) => { convertError += chunk.toString(); });
    converter.on('error', (error) => {
      console.error(`[stream:${videoId}:${quality}] ffmpeg could not start: ${error.message}`);
      streamJobs[jobKey] = { status: 'error', error: `Could not start ffmpeg: ${error.message}`, quality };
    });
    converter.on('close', (convertCode) => {
      fs.unlink(sourceFile, () => {});
      if (convertCode !== 0 || !fs.existsSync(buildingPlaylist)) {
        fs.rm(buildingDir, { recursive: true, force: true }, () => {});
        console.error(`[stream:${videoId}:${quality}] ffmpeg failed (${convertCode}): ${convertError.slice(-1200)}`);
        streamJobs[jobKey] = { status: 'error', error: convertError.slice(-800) || 'Could not create the HLS stream.', quality };
        return;
      }
      if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true });
      fs.renameSync(buildingDir, finalDir);
      const segmentCount = fs.readdirSync(finalDir).filter((name) => name.endsWith('.m4s')).length;
      console.log(`[stream:${videoId}:${quality}] HLS ready: ${segmentCount} segments`);
      streamJobs[jobKey] = { status: 'done', quality, url: `/api/hls/${videoId}/${quality}/index.m3u8` };
    });
  });
  res.status(202).json(streamJobs[jobKey]);
});

app.get('/api/stream/:id/status', (req, res) => {
  if (!isValidVideoId(req.params.id)) return res.status(400).json({ error: 'Invalid video ID.' });
  const quality = STREAM_QUALITIES.has(String(req.query.quality)) ? String(req.query.quality) : '720';
  const jobKey = `${req.params.id}:${quality}`;
  const finalPlaylist = path.join(STREAM_DIR, `${req.params.id}-${quality}-${STREAM_CACHE_VERSION}`, 'index.m3u8');
  if (fs.existsSync(finalPlaylist)) return res.json({ status: 'done', quality, url: `/api/hls/${req.params.id}/${quality}/index.m3u8` });
  if (streamJobs[jobKey] && streamJobs[jobKey].status !== 'done') {
    return res.json(streamJobs[jobKey]);
  }
  res.json(streamJobs[jobKey] || { status: 'idle', quality });
});

app.get('/api/hls/:id/:quality/:file', (req, res) => {
  if (!isValidVideoId(req.params.id)) return res.status(400).send('Invalid video ID.');
  if (!STREAM_QUALITIES.has(req.params.quality)) return res.status(400).send('Invalid quality.');
  if (!/^(index\.m3u8|init\.mp4|segment-\d{5}\.m4s)$/.test(req.params.file)) return res.status(400).send('Invalid stream file.');
  const finalDir = path.join(STREAM_DIR, `${req.params.id}-${req.params.quality}-${STREAM_CACHE_VERSION}`);
  const buildingDir = path.join(STREAM_DIR, `${req.params.id}-${req.params.quality}-${STREAM_CACHE_VERSION}-building`);
  const activeDir = fs.existsSync(path.join(finalDir, req.params.file)) ? finalDir : buildingDir;
  const file = path.join(activeDir, req.params.file);
  if (!fs.existsSync(file)) return res.status(404).send('Stream file not found.');
  if (req.params.file.endsWith('.m3u8')) {
    // An EVENT playlist is playable while ffmpeg is still appending segments,
    // but many clients otherwise join at its live edge. EXT-X-START makes the
    // intended VOD-like behavior explicit, including on native-HLS browsers.
    const playlist = fs.readFileSync(file, 'utf8');
    const withStart = playlist.includes('#EXT-X-START:')
      ? playlist
      : playlist.replace('#EXTM3U', '#EXTM3U\n#EXT-X-START:TIME-OFFSET=0,PRECISE=YES');
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/vnd.apple.mpegurl').send(withStart);
    return;
  }
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.type('video/mp4');
  res.sendFile(file);
});

app.get('/api/image', async (req, res) => {
  try {
    const url = new URL(String(req.query.url || ''));
    const host = url.hostname.toLowerCase();
    const allowed = host === 'yt3.ggpht.com' || host === 'yt3.googleusercontent.com' || host.endsWith('.ytimg.com');
    if (url.protocol !== 'https:' || !allowed) return res.status(400).send('Invalid image URL.');
    const upstream = await axios.get(url.toString(), { responseType: 'arraybuffer', timeout: 10000, maxRedirects: 0, maxContentLength: 10 * 1024 * 1024 });
    if (!String(upstream.headers['content-type'] || '').startsWith('image/')) return res.status(502).send('Invalid image response.');
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(upstream.data));
  } catch {
    if (!res.headersSent) res.status(502).send('Image unavailable.');
  }
});

// Fixed upstream host + validated video ID avoids turning this into an open proxy.
app.get('/api/thumbnail/:id', async (req, res) => {
  if (!isValidVideoId(req.params.id)) return res.status(400).send('Invalid video ID.');
  try {
    const upstream = await axios.get(
      `https://i.ytimg.com/vi/${req.params.id}/hqdefault.jpg`,
      { responseType: 'arraybuffer', timeout: 10000, maxRedirects: 0, maxContentLength: 10 * 1024 * 1024 }
    );
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(upstream.data));
  } catch {
    if (!res.headersSent) res.status(502).send('Thumbnail unavailable.');
  }
});

app.get('/api/channel-avatar/:id', async (req, res) => {
  const channelId = req.params.id;
  if (!/^UC[A-Za-z0-9_-]{20,30}$/.test(channelId)) return res.status(400).send('Invalid channel ID.');
  try {
    let imageUrl = channelAvatarCache.get(channelId);
    if (!imageUrl) {
      const raw = await runYtDlp([
        '--flat-playlist', '--playlist-end', '1', '--dump-single-json', '--no-warnings',
        `https://www.youtube.com/channel/${channelId}/videos`
      ], 30000);
      imageUrl = pickChannelImage(JSON.parse(raw).thumbnails, 'avatar');
      if (!imageUrl) return res.status(404).send('Avatar unavailable.');
      channelAvatarCache.set(channelId, imageUrl);
    }
    const upstream = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 10000, maxRedirects: 0, maxContentLength: 10 * 1024 * 1024 });
    if (!String(upstream.headers['content-type'] || '').startsWith('image/')) return res.status(502).send('Invalid image response.');
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=604800');
    res.send(Buffer.from(upstream.data));
  } catch {
    if (!res.headersSent) res.status(502).send('Avatar unavailable.');
  }
});

// Maps a quality choice from the GUI to a yt-dlp format selector.
// Using height<=N with a fallback chain so it still works if that exact
// resolution isn't available for a given video.
const QUALITY_FORMATS = {
  best: 'bestvideo+bestaudio/best',
  '2160': 'bestvideo[height<=2160]+bestaudio/best[height<=2160]',
  '1440': 'bestvideo[height<=1440]+bestaudio/best[height<=1440]',
  '1080': 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
  '720': 'bestvideo[height<=720]+bestaudio/best[height<=720]',
  '480': 'bestvideo[height<=480]+bestaudio/best[height<=480]',
  '360': 'bestvideo[height<=360]+bestaudio/best[height<=360]',
  audio: 'bestaudio'
};

app.post('/api/download', expensiveLimiter, (req, res) => {
  const { url, quality, video } = req.body || {};
  if (!url || !isValidYoutubeUrl(url)) {
    return res.status(400).json({ error: 'That does not look like a valid YouTube URL.' });
  }
  if (!Object.prototype.hasOwnProperty.call(QUALITY_FORMATS, quality)) {
    return res.status(400).json({ error: 'Invalid download quality.' });
  }
  const activeDownloads = Object.values(jobs).filter((job) => job.status === 'processing').length;
  if (activeDownloads >= MAX_ACTIVE_DOWNLOADS) {
    return res.status(429).json({ error: 'Six downloads are already active. Let one finish first.' });
  }

  const format = QUALITY_FORMATS[quality] || QUALITY_FORMATS.best;
  const audioOnly = quality === 'audio';

  const id = crypto.randomBytes(8).toString('hex');
  jobs[id] = { status: 'processing', progress: 0, video };

  const outputTemplate = path.join(DOWNLOAD_DIR, `${id}.%(ext)s`);

  const args = audioOnly
    ? [
        '-f', format,
        '-x', '--audio-format', 'best',
        '--no-playlist',
        '--newline',
        '-o', outputTemplate,
        url
      ]
    : [
        '-f', format,
        '--merge-output-format', 'mp4',
        '--no-playlist',
        '--newline',
        '-o', outputTemplate,
        url
      ];

  const proc = spawn('yt-dlp', ytDlpMediaArgs(args));
  let stderr = '';

  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    const match = text.match(/(\d+(?:\.\d+)?)%/);
    if (match) jobs[id].progress = parseFloat(match[1]);
  });

  proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  proc.on('error', (err) => {
    jobs[id] = { status: 'error', error: `Could not start yt-dlp: ${err.message}` };
  });

  proc.on('close', (code) => {
    if (code !== 0) {
      jobs[id] = { status: 'error', error: stderr.slice(-800) || 'yt-dlp failed.' };
      return;
    }
    const files = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.startsWith(id + '.'));
    if (files.length === 0) {
      jobs[id] = { status: 'error', error: 'yt-dlp finished but produced no file.' };
      return;
    }
    jobs[id] = { status: 'done', filename: files[0], video };
    const metadata = readJsonFile(DOWNLOAD_METADATA_FILE, {});
    metadata[files[0]] = {
      id: isValidVideoId(video?.id) ? video.id : '',
      title: String(video?.title || files[0]).slice(0, 200),
      channel: String(video?.channel || '').slice(0, 100),
      channelId: typeof video?.channelId === 'string' ? video.channelId : '',
      downloadedAt: Date.now()
    };
    writeJsonFile(DOWNLOAD_METADATA_FILE, metadata);
    // Files now stick around until you delete them from the "on server"
    // list in the GUI, rather than auto-expiring.
  });

  res.json({ id });
});

app.get('/api/status/:id', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: 'Unknown job id (it may have expired).' });
  if (job.status === 'done') {
    const token = makeFileToken(job.filename);
    return res.json({
      status: 'done',
      url: `/files/${encodeURIComponent(job.filename)}?token=${token}`,
      filename: job.filename
    });
  }
  res.json(job);
});

// ---------- file manager ----------

app.get('/api/files', (req, res) => {
  const metadata = readJsonFile(DOWNLOAD_METADATA_FILE, {});
  const files = fs.readdirSync(DOWNLOAD_DIR)
    .filter((f) => !f.startsWith('.'))
    .map((f) => {
      const stat = fs.statSync(path.join(DOWNLOAD_DIR, f));
      const token = makeFileToken(f);
      return {
        name: f,
        size: stat.size,
        mtime: stat.mtimeMs,
        url: `/files/${encodeURIComponent(f)}?token=${token}`,
        ...(metadata[f] || {}),
        thumbnail: metadata[f]?.id ? `/api/thumbnail/${metadata[f].id}` : ''
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json({ files });
});

app.delete('/api/files/:name', (req, res) => {
  const name = path.basename(req.params.name); // block path traversal
  const fp = path.join(DOWNLOAD_DIR, name);
  if (path.dirname(fp) !== DOWNLOAD_DIR) {
    return res.status(400).json({ error: 'Invalid filename.' });
  }
  fs.unlink(fp, (err) => {
    if (err) return res.status(404).json({ error: 'File not found.' });
    const metadata = readJsonFile(DOWNLOAD_METADATA_FILE, {});
    delete metadata[name];
    writeJsonFile(DOWNLOAD_METADATA_FILE, metadata);
    res.json({ ok: true });
  });
});

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
} else {
  app.get('*', (req, res) => res.status(503).send('Client is not built. Run npm run build.'));
}

app.listen(PORT, () => {
  console.log(`ytgrab listening on port ${PORT}`);
  if (getPerformanceMode() === 'heavy') setTimeout(warmFeedCache, 1000);
});

async function warmFeedCache(pages = [1, 2]) {
  const subscriptions = readJsonFile(SUBSCRIPTIONS_FILE, []).slice(0, 40);
  if (!subscriptions.length) return;
  console.log('[feed] warming heavy-mode cache');
  try {
    await Promise.all(pages.map((page) => buildFeedPage(subscriptions, page)));
    console.log('[feed] heavy-mode cache ready');
  } catch (error) {
    console.error(`[feed] cache warm failed: ${error.message}`);
  }
}
