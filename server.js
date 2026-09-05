const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');

// Auth: change this via an env var if you want, otherwise this is the default.
const PASSWORD = process.env.YTGRAB_PASSWORD || 'mamadsdg15';
const SESSION_COOKIE = 'ytgrab_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const sessions = new Map(); // token -> expiry timestamp

// Signed download tokens: let tools like aria2/wget/curl (which don't carry
// browser cookies) fetch a specific file without logging in, as long as
// they have a link the GUI generated for them.
const FILE_TOKEN_SECRET = crypto.randomBytes(32);
const FILE_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

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

const PUBLIC_PATHS = new Set(['/login', '/api/login']);

app.use((req, res, next) => {
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (req.path.startsWith('/files/')) return next(); // has its own cookie-or-token check below
  if (isAuthed(req)) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  res.redirect('/login');
});

// ---------- auth routes ----------

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

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

// ---------- protected app routes (everything below requires auth) ----------

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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

function isValidYoutubeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    return host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com';
  } catch {
    return false;
  }
}

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

app.listen(PORT, () => {
  console.log(`ytgrab listening on http://127.0.0.1:${PORT}`);
});
