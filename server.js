require('dotenv').config();
const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
const PORT = Number(process.env.PORT);
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
const DATA_DIR = path.join(__dirname, 'data');
const STREAM_DIR = path.join(DATA_DIR, 'streams');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const CUSTOM_BACKGROUND_FILE = path.join(DATA_DIR, 'background.webp');
const DEFAULT_BACKGROUND_FILE = path.join(__dirname, 'client', 'public', 'mountains.webp');
const CLIENT_DIST = path.join(__dirname, 'client', 'dist');

const PASSWORD = process.env.YTGRAB_PASSWORD;

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('PORT must be set to a valid port number in .env');
  process.exit(1);
}
if (!PASSWORD) {
  console.error('YTGRAB_PASSWORD must be set in .env');
  process.exit(1);
}
const SESSION_COOKIE = 'ytgrab_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const sessions = new Map(); // token -> expiry timestamp
const searchCache = new Map();
const SEARCH_CACHE_TTL_MS = 1000 * 60 * 5;
const SEARCH_LIMIT = 20;

// Signed download tokens: let tools like aria2/wget/curl (which don't carry
// browser cookies) fetch a specific file without logging in, as long as
// they have a link the GUI generated for them.
const FILE_TOKEN_SECRET = crypto.randomBytes(32);
const FILE_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

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

app.use(express.json());

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

function signFileToken(filename, expiry) {
  return crypto.createHmac('sha256', FILE_TOKEN_SECRET).update(`${filename}:${expiry}`).digest('hex');
}

function makeFileToken(filename) {
  const expiry = Date.now() + FILE_TOKEN_TTL_MS;
  return `${expiry}.${signFileToken(filename, expiry)}`;
}

function verifyFileToken(filename, token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot === -1) return false;
  const expiry = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!expiry || expiry < Date.now()) return false;
  const expected = signFileToken(filename, expiry);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// periodically sweep expired sessions so the Map doesn't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of sessions) {
    if (expiry < now) sessions.delete(token);
  }
}, 1000 * 60 * 30);

const PUBLIC_PATHS = new Set(['/api/login']);

app.use((req, res, next) => {
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (req.method === 'GET' && req.path === '/api/background') return next();
  if (req.path.startsWith('/files/')) return next(); // has its own cookie-or-token check below
  if (!req.path.startsWith('/api/')) return next();
  if (isAuthed(req)) return next();
  return res.status(401).json({ error: 'Not authenticated.' });
});

// ---------- auth routes ----------

app.post('/api/login', (req, res) => {
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
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
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

  const authed = isAuthed(req) || verifyFileToken(name, req.query.token);
  if (!authed) {
    return res.status(401).send('Not authenticated. Use the download link from the ytgrab page — it carries a valid token.');
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

function runYtDlp(args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.stdout.on('data', (chunk) => {
      if (stdout.length < 8 * 1024 * 1024) stdout += chunk.toString();
      else proc.kill('SIGKILL');
    });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr.slice(-800) || 'yt-dlp failed'));
      resolve(stdout);
    });
  });
}

// Search runs on this server, so the browser never has to reach YouTube.
app.get('/api/search', (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query || query.length > 200) {
    return res.status(400).json({ error: 'Search must be between 1 and 200 characters.' });
  }

  const cacheKey = query.toLocaleLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return res.json({ results: cached.results });

  const args = [
    '--flat-playlist',
    '--dump-single-json',
    '--no-warnings',
    '--extractor-args', 'youtube:player_client=default,tv_simply',
    `ytsearch${SEARCH_LIMIT}:${query}`
  ];
  const proc = spawn('yt-dlp', args);
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
      const results = (Array.isArray(data.entries) ? data.entries : [])
        .filter((entry) => entry && isValidVideoId(entry.id))
        .map((entry) => ({
          id: entry.id,
          title: entry.title || 'Untitled video',
          channel: entry.channel || entry.uploader || '',
          channelId: entry.channel_id || entry.uploader_id || '',
          duration: Number.isFinite(entry.duration) ? entry.duration : null,
          url: `https://www.youtube.com/watch?v=${entry.id}`,
          thumbnail: `/api/thumbnail/${entry.id}`
        }));
      searchCache.set(cacheKey, { results, expires: Date.now() + SEARCH_CACHE_TTL_MS });
      res.json({ results });
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
    subscriptions.push({ id, name: name.trim().slice(0, 100), followedAt: Date.now() });
    writeJsonFile(SUBSCRIPTIONS_FILE, subscriptions);
  }
  res.json({ subscriptions });
});

app.delete('/api/subscriptions/:id', (req, res) => {
  const subscriptions = readJsonFile(SUBSCRIPTIONS_FILE, [])
    .filter((channel) => channel.id !== req.params.id);
  writeJsonFile(SUBSCRIPTIONS_FILE, subscriptions);
  res.json({ subscriptions });
});

app.get('/api/feed', async (req, res) => {
  const subscriptions = readJsonFile(SUBSCRIPTIONS_FILE, []).slice(0, 8);
  if (subscriptions.length === 0) return res.json({ videos: [], empty: true });
  try {
    const feeds = await Promise.all(subscriptions.map(async (channel) => {
      const raw = await runYtDlp([
        '--flat-playlist', '--playlist-end', '5', '--dump-single-json', '--no-warnings',
        `https://www.youtube.com/channel/${channel.id}/videos`
      ], 45000);
      const data = JSON.parse(raw);
      return (data.entries || []).map((entry) => ({ ...entry, fallbackChannel: channel.name }));
    }));
    const videos = feeds.flat()
      .filter((entry) => entry && isValidVideoId(entry.id))
      .map((entry) => ({
        id: entry.id,
        title: entry.title || 'Untitled video',
        channel: entry.channel || entry.uploader || entry.fallbackChannel,
        channelId: entry.channel_id || entry.uploader_id || '',
        duration: Number.isFinite(entry.duration) ? entry.duration : null,
        timestamp: entry.timestamp || null,
        thumbnail: `/api/thumbnail/${entry.id}`
      }))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    res.json({ videos });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get('/api/channels/:id', async (req, res) => {
  const channelId = req.params.id;
  if (!/^UC[A-Za-z0-9_-]{20,30}$/.test(channelId)) {
    return res.status(400).json({ error: 'Invalid channel ID.' });
  }
  try {
    const raw = await runYtDlp([
      '--flat-playlist', '--playlist-end', '30', '--dump-single-json', '--no-warnings',
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
      videos
    });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get('/api/history', (req, res) => {
  res.json({ history: readJsonFile(HISTORY_FILE, []) });
});

app.post('/api/history', (req, res) => {
  const { id, title, channel, channelId } = req.body || {};
  if (!isValidVideoId(id)) return res.status(400).json({ error: 'Invalid video.' });
  const history = readJsonFile(HISTORY_FILE, []).filter((item) => item.id !== id);
  history.unshift({
    id,
    title: String(title || 'Untitled video').slice(0, 200),
    channel: String(channel || '').slice(0, 100),
    channelId: typeof channelId === 'string' ? channelId : '',
    watchedAt: Date.now(),
    thumbnail: `/api/thumbnail/${id}`
  });
  writeJsonFile(HISTORY_FILE, history.slice(0, 100));
  res.json({ ok: true });
});

app.post('/api/stream/:id/prepare', (req, res) => {
  const videoId = req.params.id;
  if (!isValidVideoId(videoId)) return res.status(400).json({ error: 'Invalid video ID.' });
  const finalFile = path.join(STREAM_DIR, `${videoId}.mp4`);
  if (fs.existsSync(finalFile)) return res.json({ status: 'done', url: `/api/stream/${videoId}` });
  if (streamJobs[videoId]) return res.json(streamJobs[videoId]);

  streamJobs[videoId] = { status: 'downloading', progress: 0 };
  const sourceTemplate = path.join(STREAM_DIR, `${videoId}-source.%(ext)s`);
  const downloader = spawn('yt-dlp', [
    '--no-playlist', '--newline',
    '-f', 'bv*[height<=720]+ba/b[height<=720]/b',
    '--merge-output-format', 'mkv',
    '--extractor-args', 'youtube:player_client=default,tv_simply',
    '-o', sourceTemplate,
    `https://www.youtube.com/watch?v=${videoId}`
  ]);
  let downloadError = '';
  downloader.stdout.on('data', (chunk) => {
    const match = chunk.toString().match(/(\d+(?:\.\d+)?)%/);
    if (match) streamJobs[videoId] = { status: 'downloading', progress: Number(match[1]) };
  });
  downloader.stderr.on('data', (chunk) => { downloadError += chunk.toString(); });
  downloader.on('error', (error) => {
    streamJobs[videoId] = { status: 'error', error: `Could not start yt-dlp: ${error.message}` };
  });
  downloader.on('close', (code) => {
    if (code !== 0) {
      streamJobs[videoId] = { status: 'error', error: downloadError.slice(-800) || 'Could not prepare the video.' };
      return;
    }
    const source = fs.readdirSync(STREAM_DIR).find((name) => name.startsWith(`${videoId}-source.`) && !name.endsWith('.part'));
    if (!source) {
      streamJobs[videoId] = { status: 'error', error: 'Downloaded media file was not found.' };
      return;
    }
    const sourceFile = path.join(STREAM_DIR, source);
    streamJobs[videoId] = { status: 'converting', progress: 100 };
    const converter = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', sourceFile,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart', finalFile
    ]);
    let convertError = '';
    converter.stderr.on('data', (chunk) => { convertError += chunk.toString(); });
    converter.on('error', (error) => {
      streamJobs[videoId] = { status: 'error', error: `Could not start ffmpeg: ${error.message}` };
    });
    converter.on('close', (convertCode) => {
      fs.unlink(sourceFile, () => {});
      if (convertCode !== 0 || !fs.existsSync(finalFile)) {
        streamJobs[videoId] = { status: 'error', error: convertError.slice(-800) || 'Could not create a browser-compatible video.' };
        return;
      }
      streamJobs[videoId] = { status: 'done', url: `/api/stream/${videoId}` };
    });
  });
  res.status(202).json(streamJobs[videoId]);
});

app.get('/api/stream/:id/status', (req, res) => {
  if (!isValidVideoId(req.params.id)) return res.status(400).json({ error: 'Invalid video ID.' });
  const finalFile = path.join(STREAM_DIR, `${req.params.id}.mp4`);
  if (fs.existsSync(finalFile)) return res.json({ status: 'done', url: `/api/stream/${req.params.id}` });
  res.json(streamJobs[req.params.id] || { status: 'idle' });
});

app.get('/api/stream/:id', (req, res) => {
  if (!isValidVideoId(req.params.id)) return res.status(400).send('Invalid video ID.');
  const file = path.join(STREAM_DIR, `${req.params.id}.mp4`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Video is not prepared yet.' });
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.type('video/mp4').sendFile(file);
});

app.get('/api/image', async (req, res) => {
  try {
    const url = new URL(String(req.query.url || ''));
    const host = url.hostname.toLowerCase();
    const allowed = host === 'yt3.ggpht.com' || host === 'yt3.googleusercontent.com' || host.endsWith('.ytimg.com');
    if (url.protocol !== 'https:' || !allowed) return res.status(400).send('Invalid image URL.');
    const upstream = await axios.get(url.toString(), { responseType: 'stream', timeout: 10000, maxRedirects: 2 });
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    upstream.data.on('error', () => res.destroy());
    upstream.data.pipe(res);
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
      { responseType: 'stream', timeout: 10000, maxRedirects: 2 }
    );
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    upstream.data.on('error', () => res.destroy());
    upstream.data.pipe(res);
  } catch {
    if (!res.headersSent) res.status(502).send('Thumbnail unavailable.');
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

app.post('/api/download', (req, res) => {
  const { url, quality } = req.body || {};
  if (!url || !isValidYoutubeUrl(url)) {
    return res.status(400).json({ error: 'That does not look like a valid YouTube URL.' });
  }

  const format = QUALITY_FORMATS[quality] || QUALITY_FORMATS.best;
  const audioOnly = quality === 'audio';

  const id = crypto.randomBytes(8).toString('hex');
  jobs[id] = { status: 'processing', progress: 0 };

  const outputTemplate = path.join(DOWNLOAD_DIR, `${id}.%(ext)s`);

  const args = audioOnly
    ? [
        '-f', format,
        '-x', '--audio-format', 'mp3',
        '--no-playlist',
        '--newline',
        '--extractor-args', 'youtube:player_client=default,tv_simply',
        '-o', outputTemplate,
        url
      ]
    : [
        '-f', format,
        '--merge-output-format', 'mp4',
        '--no-playlist',
        '--newline',
        '--extractor-args', 'youtube:player_client=default,tv_simply',
        '-o', outputTemplate,
        url
      ];

  const proc = spawn('yt-dlp', args);
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
    jobs[id] = { status: 'done', filename: files[0] };
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
  const files = fs.readdirSync(DOWNLOAD_DIR)
    .filter((f) => !f.startsWith('.'))
    .map((f) => {
      const stat = fs.statSync(path.join(DOWNLOAD_DIR, f));
      const token = makeFileToken(f);
      return {
        name: f,
        size: stat.size,
        mtime: stat.mtimeMs,
        url: `/files/${encodeURIComponent(f)}?token=${token}`
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
  console.log(`ytgrab listening on http://127.0.0.1:${PORT}`);
});
