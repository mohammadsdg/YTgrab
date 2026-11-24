module.exports = function registerStreamRoutes({ app, expensiveLimiter, isValidVideoId, STREAM_QUALITIES, STREAM_CACHE_VERSION, STREAM_DIR, fs, path, spawn, ytDlpMediaArgs, streamJobs, MAX_ACTIVE_STREAMS, streamAccess, axios, runYtDlp, channelAvatarCache, pickChannelImage, proxiedImageUrl }) {
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
  if (streamJobs[jobKey]?.status === 'done') delete streamJobs[jobKey];
  if (streamJobs[jobKey]?.status !== 'error') {
    if (streamJobs[jobKey]) return res.json(streamJobs[jobKey]);
  } else {
    delete streamJobs[jobKey];
  }
  const activeStreams = Object.values(streamJobs).filter((job) => ['downloading', 'converting'].includes(job.status)).length;
  if (activeStreams >= MAX_ACTIVE_STREAMS) return res.status(429).json({ error: 'The stream server is busy. Try again in a moment.' });

  console.log(`[stream:${videoId}:${quality}] preparing HLS stream`);
  streamJobs[jobKey] = { status: 'converting', progress: 0, quality };
  const format = quality === 'audio'
    ? 'ba/bestaudio/b'
    : `bv*[height<=${quality}]+ba/b[height<=${quality}]/b`;
  if (fs.existsSync(buildingDir)) fs.rmSync(buildingDir, { recursive: true });
  fs.mkdirSync(buildingDir);
  const buildingPlaylist = path.join(buildingDir, 'index.m3u8');
  const segmentTemplate = path.join(buildingDir, 'segment-%05d.m4s');
  const mediaArgs = quality === 'audio'
    ? ['-vn', '-c:a', 'aac', '-b:a', '256k']
    : [
        '-c:v', 'libx264', '-preset', 'superfast', '-tune', 'zerolatency', '-crf', '24',
        '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-level:v', '4.1', '-tag:v', 'avc1',
        '-force_key_frames', 'expr:gte(t,n_forced*2)',
        '-c:a', 'aac', '-b:a', '192k'
      ];

  // yt-dlp writes the authenticated YouTube media to stdout while it arrives.
  // ffmpeg consumes that pipe immediately and publishes four-second HLS
  // segments, so playback does not wait for the whole source video to download.
  const downloader = spawn('yt-dlp', ytDlpMediaArgs([
    '--no-playlist', '--quiet', '--no-warnings',
    '--downloader', 'ffmpeg',
    '-f', format,
    '-o', '-',
    `https://www.youtube.com/watch?v=${videoId}`
  ]));
  const converter = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-fflags', '+genpts', '-i', 'pipe:0',
    ...mediaArgs,
    '-avoid_negative_ts', 'make_zero',
    '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'event',
    '-start_number', '0',
    '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_flags', 'independent_segments', '-hls_segment_filename', segmentTemplate,
    buildingPlaylist
  ]);
  downloader.stdout.pipe(converter.stdin);

  let downloadError = '';
  let convertError = '';
  let failed = false;
  const failStream = (message) => {
    if (failed) return;
    failed = true;
    downloader.kill('SIGKILL');
    converter.kill('SIGKILL');
    fs.rm(buildingDir, { recursive: true, force: true }, () => {});
    streamJobs[jobKey] = { status: 'error', error: message, quality, finishedAt: Date.now() };
  };

  downloader.stderr.on('data', (chunk) => { downloadError += chunk.toString(); });
  converter.stderr.on('data', (chunk) => { convertError += chunk.toString(); });
  converter.stdin.on('error', (error) => {
    if (error.code !== 'EPIPE') failStream(`Media pipeline failed: ${error.message}`);
  });
  downloader.on('error', (error) => failStream(`Could not start yt-dlp: ${error.message}`));
  converter.on('error', (error) => failStream(`Could not start ffmpeg: ${error.message}`));
  downloader.on('close', (code) => {
    if (code !== 0 && !failed) {
      console.error(`[stream:${videoId}:${quality}] yt-dlp failed (${code}): ${downloadError.slice(-1200)}`);
      failStream(downloadError.slice(-800) || 'Could not read the YouTube media stream.');
    }
  });
  converter.on('close', (code) => {
    if (failed) return;
    if (code !== 0 || !fs.existsSync(buildingPlaylist)) {
      console.error(`[stream:${videoId}:${quality}] ffmpeg failed (${code}): ${convertError.slice(-1200)}`);
      failStream(convertError.slice(-800) || 'Could not create the HLS stream.');
      return;
    }
    if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true });
    fs.renameSync(buildingDir, finalDir);
    const segmentCount = fs.readdirSync(finalDir).filter((name) => name.endsWith('.m4s')).length;
    console.log(`[stream:${videoId}:${quality}] HLS complete: ${segmentCount} segments`);
    streamJobs[jobKey] = { status: 'done', quality, url: `/api/hls/${videoId}/${quality}/index.m3u8`, finishedAt: Date.now() };
  });
  res.status(202).json(streamJobs[jobKey]);
});

app.get('/api/stream/:id/status', (req, res) => {
  if (!isValidVideoId(req.params.id)) return res.status(400).json({ error: 'Invalid video ID.' });
  const quality = STREAM_QUALITIES.has(String(req.query.quality)) ? String(req.query.quality) : '720';
  const jobKey = `${req.params.id}:${quality}`;
  const finalPlaylist = path.join(STREAM_DIR, `${req.params.id}-${quality}-${STREAM_CACHE_VERSION}`, 'index.m3u8');
  const buildingDir = path.join(STREAM_DIR, `${req.params.id}-${quality}-${STREAM_CACHE_VERSION}-building`);
  const buildingPlaylist = path.join(buildingDir, 'index.m3u8');
  if (fs.existsSync(finalPlaylist)) return res.json({ status: 'done', quality, url: `/api/hls/${req.params.id}/${quality}/index.m3u8` });
  if (streamJobs[jobKey]?.status === 'done') delete streamJobs[jobKey];
  if (fs.existsSync(buildingPlaylist) && fs.readdirSync(buildingDir).some((name) => name.endsWith('.m4s'))) {
    return res.json({ status: 'done', streaming: true, quality, url: `/api/hls/${req.params.id}/${quality}/index.m3u8` });
  }
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
  streamAccess.set(path.basename(finalDir), Date.now());
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
    const allowed = host === 'yt3.ggpht.com' || host === 'yt3.googleusercontent.com' || host === 'lh3.googleusercontent.com' || host.endsWith('.ytimg.com');
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
};
