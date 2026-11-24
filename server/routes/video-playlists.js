module.exports = function registerVideoPlaylistRoutes({ app, crypto, VIDEO_PLAYLISTS_FILE, readJsonFile, writeJsonFile, isValidVideoId }) {
// ---------- video playlists ----------

function videoPlaylists() {
  const value = readJsonFile(VIDEO_PLAYLISTS_FILE, []);
  return Array.isArray(value) ? value : [];
}

app.get('/api/video-playlists', (req, res) => {
  res.json({ playlists: videoPlaylists() });
});

app.post('/api/video-playlists', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 100) return res.status(400).json({ error: 'Playlist name must be 1–100 characters.' });
  const playlists = videoPlaylists();
  if (playlists.length >= 50) return res.status(400).json({ error: 'You can have up to 50 video playlists.' });
  const playlist = { id: crypto.randomBytes(8).toString('hex'), name, videos: [], createdAt: Date.now() };
  playlists.push(playlist);
  writeJsonFile(VIDEO_PLAYLISTS_FILE, playlists);
  res.status(201).json({ playlist, playlists });
});

app.post('/api/video-playlists/:id/videos', (req, res) => {
  const input = req.body?.video;
  if (!isValidVideoId(input?.id)) return res.status(400).json({ error: 'Invalid video.' });
  const playlists = videoPlaylists();
  const playlist = playlists.find((item) => item.id === req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });
  if (!Array.isArray(playlist.videos)) playlist.videos = [];
  if (!playlist.videos.some((item) => item.id === input.id)) {
    if (playlist.videos.length >= 250) return res.status(400).json({ error: 'This playlist is full.' });
    const channelId = /^UC[A-Za-z0-9_-]{20,30}$/.test(input.channelId || '') ? input.channelId : '';
    playlist.videos.push({
      id: input.id,
      title: String(input.title || 'Untitled video').slice(0, 200),
      channel: String(input.channel || '').slice(0, 100),
      channelId,
      duration: Number.isFinite(input.duration) ? input.duration : null,
      thumbnail: `/api/thumbnail/${input.id}`,
      channelAvatar: channelId ? `/api/channel-avatar/${channelId}` : ''
    });
    writeJsonFile(VIDEO_PLAYLISTS_FILE, playlists);
  }
  res.json({ playlists });
});

app.delete('/api/video-playlists/:id/videos/:videoId', (req, res) => {
  const playlists = videoPlaylists();
  const playlist = playlists.find((item) => item.id === req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });
  playlist.videos = (Array.isArray(playlist.videos) ? playlist.videos : []).filter((item) => item.id !== req.params.videoId);
  writeJsonFile(VIDEO_PLAYLISTS_FILE, playlists);
  res.json({ playlists });
});

app.delete('/api/video-playlists/:id', (req, res) => {
  const playlists = videoPlaylists();
  const remaining = playlists.filter((item) => item.id !== req.params.id);
  if (remaining.length === playlists.length) return res.status(404).json({ error: 'Playlist not found.' });
  writeJsonFile(VIDEO_PLAYLISTS_FILE, remaining);
  res.json({ playlists: remaining });
});
};
