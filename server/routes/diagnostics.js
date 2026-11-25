module.exports = function registerDiagnosticsRoutes({ app, spawn, fs, path, DOWNLOAD_DIR, STREAM_DIR, jobs, streamJobs, MAX_STREAM_CACHE_BYTES }) {
  let commandCache = null;

  function commandAvailable(command, args) {
    return new Promise((resolve) => {
      const child = spawn(command, args, { stdio: 'ignore' });
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.on('error', () => { clearTimeout(timer); resolve(false); });
      child.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
    });
  }

  async function directoryBytes(root, recursive = false) {
    let bytes = 0;
    let count = 0;
    const pending = [root];
    while (pending.length && count < 20_000) {
      const current = pending.pop();
      let entries;
      try { entries = await fs.promises.readdir(current, { withFileTypes: true }); }
      catch { continue; }
      for (const entry of entries) {
        if (++count > 20_000) break;
        const file = path.join(current, entry.name);
        if (entry.isDirectory() && recursive) pending.push(file);
        else if (entry.isFile()) {
          try { bytes += (await fs.promises.stat(file)).size; } catch { /* deleted during scan */ }
        }
      }
    }
    return { bytes, partial: count >= 20_000 };
  }

  app.get('/api/diagnostics', async (req, res) => {
    if (!commandCache || commandCache.expires < Date.now()) {
      const [ytDlp, ffmpeg] = await Promise.all([
        commandAvailable('yt-dlp', ['--version']), commandAvailable('ffmpeg', ['-version'])
      ]);
      commandCache = { ytDlp, ffmpeg, expires: Date.now() + 5 * 60_000 };
    }
    const [saved, cache] = await Promise.all([
      directoryBytes(DOWNLOAD_DIR), directoryBytes(STREAM_DIR, true)
    ]);
    res.json({
      tools: { ytDlp: commandCache.ytDlp, ffmpeg: commandCache.ffmpeg },
      jobs: {
        downloads: Object.values(jobs).filter((job) => job.status === 'processing').length,
        streams: Object.values(streamJobs).filter((job) => ['downloading', 'converting'].includes(job.status)).length,
        failedDownloads: Object.values(jobs).filter((job) => job.status === 'error').length
      },
      storage: { saved, cache, cacheLimitBytes: MAX_STREAM_CACHE_BYTES }
    });
  });
};
