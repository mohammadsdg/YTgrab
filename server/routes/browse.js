module.exports = function registerBrowseRoutes({ app, expensiveLimiter, searchCache, SEARCH_CACHE_TTL_MS, SEARCH_LIMIT, isValidVideoId, runYtDlp, readJsonFile, writeJsonFile, SUBSCRIPTIONS_FILE, feedCache, feedRequests, feedSnapshots, FEED_SNAPSHOTS_FILE, FEED_CACHE_TTL_MS, getPerformanceMode, PREFERENCES_FILE, proxiedImageUrl, pickChannelImage, HISTORY_FILE }) {
// Search runs on this server, so the browser never has to reach YouTube.
app.get('/api/search', expensiveLimiter, async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query || query.length > 200) {
    return res.status(400).json({ error: 'Search must be between 1 and 200 characters.' });
  }

  const page = Math.max(1, Math.min(25, Number.parseInt(req.query.page, 10) || 1));
  const requestedCount = page * SEARCH_LIMIT;
  const cacheKey = `${query.toLocaleLowerCase()}:${page}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return res.json(cached.value);

  try {
      const stdout = await runYtDlp([
        '--flat-playlist', '--dump-single-json', '--no-warnings',
        `ytsearch${requestedCount}:${query}`
      ], Math.min(70_000, 30_000 + page * 1500));
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
      const value = { results, page, hasMore: results.length === SEARCH_LIMIT };
      searchCache.set(cacheKey, { value, expires: Date.now() + SEARCH_CACHE_TTL_MS });
      if (searchCache.size > 120) searchCache.delete(searchCache.keys().next().value);
      res.json(value);
  } catch (error) {
    res.status(502).json({ error: error.message || 'YouTube search failed.' });
  }
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

async function buildFeedPage(subscriptions, page, refresh = false) {
    const subscriptionKey = subscriptions.map((channel) => channel.id).sort().join(',');
    const performanceMode = getPerformanceMode();
    const cacheKey = `${performanceMode}:${subscriptionKey}:${page}`;
    const cached = feedCache.get(cacheKey);
    if (!refresh && cached && cached.expires > Date.now()) return cached.value;
    const snapshot = feedSnapshots[cacheKey];
    if (!refresh && performanceMode === 'heavy' && snapshot?.value?.videos?.length) {
      // Keep login fast even after a restart or a temporary YouTube failure.
      if (!cached || cached.expires <= Date.now()) {
        feedCache.set(cacheKey, { value: snapshot.value, expires: Date.now() + 60_000 });
        buildFeedPage(subscriptions, page, true).catch((error) => console.error(`[feed] refresh failed: ${error.message}`));
      }
      return snapshot.value;
    }
    if (feedRequests.has(cacheKey)) return feedRequests.get(cacheKey);
    const request = (async () => {
    const perChannel = performanceMode === 'heavy' ? 8 : 3;
    const start = ((page - 1) * perChannel) + 1;
    const end = page * perChannel;
    const attempts = await Promise.allSettled(subscriptions.map(async (channel) => {
      const raw = await runYtDlp([
        '--flat-playlist', '--playlist-start', String(start), '--playlist-end', String(end), '--dump-single-json', '--no-warnings',
        `https://www.youtube.com/channel/${channel.id}/videos`
      ], 45000, refresh ? 'background' : 'normal');
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
    if (feedCache.size > 150) feedCache.delete(feedCache.keys().next().value);
    if (performanceMode === 'heavy' && page <= 2 && videos.length) {
      feedSnapshots[cacheKey] = { value, savedAt: Date.now() };
      const oldest = Object.keys(feedSnapshots).sort((a, b) => feedSnapshots[a].savedAt - feedSnapshots[b].savedAt);
      while (oldest.length > 8) delete feedSnapshots[oldest.shift()];
      writeJsonFile(FEED_SNAPSHOTS_FILE, feedSnapshots);
    }
    return value;
    })();
    feedRequests.set(cacheKey, request);
    try { return await request; }
    finally { feedRequests.delete(cacheKey); }
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

async function warmFeedCache(pages = [1, 2]) {
  const subscriptions = readJsonFile(SUBSCRIPTIONS_FILE, []).slice(0, 40);
  if (!subscriptions.length) return;
  console.log('[feed] warming heavy-mode cache');
  try {
    for (const page of pages) await buildFeedPage(subscriptions, page, true);
    console.log('[feed] heavy-mode cache ready');
  } catch (error) {
    console.error(`[feed] cache warm failed: ${error.message}`);
  }
}
return { warmFeedCache };
};
