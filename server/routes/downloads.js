const { mediaSelectionArgs, mediaError } = require('../media-formats');
const DOWNLOAD_QUALITIES = new Set(['best', '2160', '1440', '1080', '720', '480', '360', 'audio']);

module.exports = function registerDownloadRoutes({ app, expensiveLimiter, jobs, MAX_ACTIVE_DOWNLOADS, crypto, path, DOWNLOAD_DIR, spawn, ytDlpMediaArgs, isValidYoutubeUrl, isValidVideoId, readJsonFile, writeJsonFile, DOWNLOAD_METADATA_FILE, makeFileToken, fs }) {

app.post('/api/download', expensiveLimiter, (req, res) => {
  const { url, quality, video } = req.body || {};
  if (!url || !isValidYoutubeUrl(url)) {
    return res.status(400).json({ error: 'That does not look like a valid YouTube URL.' });
  }
  if (!DOWNLOAD_QUALITIES.has(quality)) {
    return res.status(400).json({ error: 'Invalid download quality.' });
  }
  const activeDownloads = Object.values(jobs).filter((job) => job.status === 'processing').length;
  if (activeDownloads >= MAX_ACTIVE_DOWNLOADS) {
    return res.status(429).json({ error: `${MAX_ACTIVE_DOWNLOADS} downloads are already active. Let one finish first.` });
  }

  const audioOnly = quality === 'audio';

  const id = crypto.randomBytes(8).toString('hex');
  jobs[id] = { status: 'processing', progress: 0, video };

  const outputTemplate = path.join(DOWNLOAD_DIR, `${id}.%(ext)s`);

  const args = audioOnly
    ? [
        ...mediaSelectionArgs(quality),
        '-x', '--audio-format', 'best',
        '--no-playlist',
        '--newline',
        '-o', outputTemplate,
        url
      ]
    : [
        ...mediaSelectionArgs(quality),
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
    jobs[id] = { status: 'error', error: `Could not start yt-dlp: ${err.message}`, finishedAt: Date.now() };
  });

  proc.on('close', (code) => {
    if (code !== 0) {
      jobs[id] = { status: 'error', error: mediaError(stderr), finishedAt: Date.now() };
      return;
    }
    const files = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.startsWith(id + '.'));
    if (files.length === 0) {
      jobs[id] = { status: 'error', error: 'yt-dlp finished but produced no file.', finishedAt: Date.now() };
      return;
    }
    jobs[id] = { status: 'done', filename: files[0], video, finishedAt: Date.now() };
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
};
