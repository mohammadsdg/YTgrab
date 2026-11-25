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
const MUSIC_LIBRARY_FILE = path.join(DATA_DIR, 'music-library.json');
const VIDEO_PLAYLISTS_FILE = path.join(DATA_DIR, 'video-playlists.json');
const FEED_SNAPSHOTS_FILE = path.join(DATA_DIR, 'feed-snapshots.json');
const CUSTOM_BACKGROUND_FILE = path.join(DATA_DIR, 'background.webp');
const DEFAULT_BACKGROUND_FILE = path.join(__dirname, 'client', 'public', 'mountains.webp');
const CLIENT_DIST = path.join(__dirname, 'client', 'dist');

const PASSWORD = process.env.YTGRAB_PASSWORD;
const COOKIES_FILE = process.env.YT_DLP_COOKIES ? path.resolve(__dirname, process.env.YT_DLP_COOKIES) : null;
const NODE_MAJOR = Number.parseInt(process.versions.node.split('.')[0], 10);
const YT_DLP_USER_AGENT = process.env.YT_DLP_USER_AGENT?.trim();
const YT_DLP_PROXY = process.env.YT_DLP_PROXY?.trim();
const YT_DLP_PLAYER_CLIENT = process.env.YT_DLP_PLAYER_CLIENT?.trim();

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
app.set('trust proxy', 'loopback');
const SESSION_COOKIE = 'ytgrab_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const sessions = new Map(); // token -> expiry timestamp
const searchCache = new Map();
const SEARCH_CACHE_TTL_MS = 1000 * 60 * 5;
const feedCache = new Map();
const feedRequests = new Map();
const FEED_CACHE_TTL_MS = 1000 * 60 * 10;
const SEARCH_LIMIT = 20;
const channelAvatarCache = new Map();
const ytDlpMetadataQueue = [];
let activeYtDlpMetadata = 0;
const MAX_YT_DLP_METADATA = 2;
const STREAM_CACHE_VERSION = 'hls-v7-fast-start';
const STREAM_QUALITIES = new Set(['audio', '480', '720', '1080']);
const MAX_ACTIVE_DOWNLOADS = 3;
const MAX_ACTIVE_STREAMS = 2;
const MAX_STREAM_CACHE_BYTES = Math.max(1, Number(process.env.YTGRAB_STREAM_CACHE_GB) || 8) * 1024 ** 3;
const streamAccess = new Map();
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
  if (fs.existsSync(file)) {
    try { JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`); }
  }
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

const storedFeedSnapshots = readJsonFile(FEED_SNAPSHOTS_FILE, {});
const feedSnapshots = storedFeedSnapshots && typeof storedFeedSnapshots === 'object' && !Array.isArray(storedFeedSnapshots)
  ? storedFeedSnapshots : {};

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
    try { out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim()); }
    catch { /* ignore malformed cookie */ }
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
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; SameSite=Lax${req.secure ? '; Secure' : ''}`
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
  const file = isAuthed(req) && fs.existsSync(CUSTOM_BACKGROUND_FILE) ? CUSTOM_BACKGROUND_FILE : DEFAULT_BACKGROUND_FILE;
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

  if (path.dirname(fp) !== DOWNLOAD_DIR || !fs.existsSync(fp) || !fs.lstatSync(fp).isFile()) {
    return res.status(404).send('Not found.');
  }

  if (!isAuthed(req) && !verifyFileToken(name, req.query.token)) {
    return res.status(401).send('This download link is invalid or has expired.');
  }

  const title = readJsonFile(DOWNLOAD_METADATA_FILE, {})[name]?.title;
  const safeTitle = typeof title === 'string' ? title.replace(/[\\/?%*:|"<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) : '';
  res.download(fp, safeTitle ? `${safeTitle}${path.extname(name)}` : name);
});

// in-memory job tracking: { [id]: { status, filename, error, progress } }
const jobs = {};
const streamJobs = {};

async function pruneStreamCache() {
  try {
    const now = Date.now();
    const directories = await fs.promises.readdir(STREAM_DIR, { withFileTypes: true });
    const completed = [];
    for (const directory of directories) {
      if (!directory.isDirectory()) continue;
      const location = path.join(STREAM_DIR, directory.name);
      const stat = await fs.promises.stat(location);
      if (directory.name.endsWith('-building')) {
        if (now - stat.mtimeMs > 6 * 60 * 60_000) await fs.promises.rm(location, { recursive: true, force: true });
        continue;
      }
      const files = await fs.promises.readdir(location);
      let bytes = 0;
      for (const file of files) bytes += (await fs.promises.stat(path.join(location, file))).size;
      completed.push({ location, name: directory.name, bytes, lastUsed: Math.max(stat.mtimeMs, streamAccess.get(directory.name) || 0) });
    }
    let total = completed.reduce((sum, item) => sum + item.bytes, 0);
    for (const item of completed.sort((a, b) => a.lastUsed - b.lastUsed)) {
      if (now - item.lastUsed < 60 * 60_000) continue;
      if (now - item.lastUsed < 7 * 24 * 60 * 60_000 && total <= MAX_STREAM_CACHE_BYTES) continue;
      await fs.promises.rm(item.location, { recursive: true, force: true });
      total -= item.bytes;
      streamAccess.delete(item.name);
    }
  } catch (error) { console.error(`[stream] cache cleanup failed: ${error.message}`); }
}

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
  return ytDlpArgs(YT_DLP_PLAYER_CLIENT
    ? ['--extractor-args', `youtube:player_client=${YT_DLP_PLAYER_CLIENT}`, ...args]
    : args);
}

function acquireYtDlpMetadataSlot(priority = 'normal') {
  return new Promise((resolve, reject) => {
    const enter = () => {
      activeYtDlpMetadata += 1;
      resolve(() => {
        activeYtDlpMetadata -= 1;
        ytDlpMetadataQueue.shift()?.enter();
      });
    };
    if (activeYtDlpMetadata < MAX_YT_DLP_METADATA) enter();
    else {
      if (ytDlpMetadataQueue.length >= 24) return reject(new Error('The metadata server is busy. Try again shortly.'));
      const item = { enter, priority };
      const firstBackground = ytDlpMetadataQueue.findIndex((queued) => queued.priority === 'background');
      if (priority === 'background' || firstBackground < 0) ytDlpMetadataQueue.push(item);
      else ytDlpMetadataQueue.splice(firstBackground, 0, item);
    }
  });
}

async function runYtDlp(args, timeoutMs = 30000, priority = 'normal') {
  const release = await acquireYtDlpMetadataSlot(priority);
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
    proc.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
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

// Feature routes share the authenticated API and a small set of helpers.
const { warmFeedCache } = require('./server/routes/browse')({
  app, expensiveLimiter, searchCache, SEARCH_CACHE_TTL_MS, SEARCH_LIMIT,
  isValidVideoId, runYtDlp, readJsonFile, writeJsonFile, SUBSCRIPTIONS_FILE,
  feedCache, feedRequests, feedSnapshots, FEED_SNAPSHOTS_FILE, FEED_CACHE_TTL_MS, getPerformanceMode,
  PREFERENCES_FILE, proxiedImageUrl, pickChannelImage, HISTORY_FILE
});
require('./server/routes/video-playlists')({
  app, crypto, VIDEO_PLAYLISTS_FILE, readJsonFile, writeJsonFile, isValidVideoId
});
const musicCaches = require('./server/routes/music')({
  app, expensiveLimiter, runYtDlp, isValidVideoId, proxiedImageUrl,
  pickChannelImage, readJsonFile, writeJsonFile, MUSIC_LIBRARY_FILE, axios
});
require('./server/routes/stream')({
  app, expensiveLimiter, isValidVideoId, STREAM_QUALITIES, STREAM_CACHE_VERSION,
  STREAM_DIR, fs, path, spawn, ytDlpMediaArgs, streamJobs, MAX_ACTIVE_STREAMS,
  streamAccess, axios, runYtDlp, channelAvatarCache, pickChannelImage,
  proxiedImageUrl, DOWNLOAD_DIR, DOWNLOAD_METADATA_FILE, readJsonFile
});
require('./server/routes/downloads')({
  app, expensiveLimiter, jobs, MAX_ACTIVE_DOWNLOADS, crypto, path, DOWNLOAD_DIR,
  spawn, ytDlpMediaArgs, isValidYoutubeUrl, isValidVideoId, readJsonFile,
  writeJsonFile, DOWNLOAD_METADATA_FILE, makeFileToken, fs
});
require('./server/routes/diagnostics')({
  app, spawn, fs, path, DOWNLOAD_DIR, STREAM_DIR, jobs, streamJobs, MAX_STREAM_CACHE_BYTES
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
  setTimeout(pruneStreamCache, 10_000);
});

setInterval(() => {
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60_000;
  for (const [id, job] of Object.entries(jobs)) if (job.finishedAt && job.finishedAt < cutoff) delete jobs[id];
  for (const [id, job] of Object.entries(streamJobs)) if (job.finishedAt && job.finishedAt < cutoff) delete streamJobs[id];
  for (const cache of [searchCache, feedCache, ...musicCaches]) {
    for (const [key, value] of cache) if (value.expires < now) cache.delete(key);
  }
  for (const [name, used] of streamAccess) if (used < cutoff) streamAccess.delete(name);
  pruneStreamCache();
}, 60 * 60_000);
