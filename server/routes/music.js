module.exports = function registerMusicRoutes({ app, expensiveLimiter, runYtDlp, isValidVideoId, proxiedImageUrl, pickChannelImage, readJsonFile, writeJsonFile, MUSIC_LIBRARY_FILE, axios }) {
// ---------- music ----------

const EMPTY_MUSIC_LIBRARY = { liked: [], artists: [], playlists: [], recent: [] };
const musicSearchCache = new Map();
const artistCache = new Map();
const lyricsCache = new Map();

function musicArtwork(thumbnails, fallback = '') {
  const image = Array.isArray(thumbnails)
    ? thumbnails.filter((item) => typeof item?.url === 'string').sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url
    : '';
  return image ? proxiedImageUrl(image) : fallback;
}

function musicSong(entry) {
  if (!isValidVideoId(entry?.id)) return null;
  const candidateArtistId = entry.artistId || entry.channel_id || '';
  const artistId = /^UC[A-Za-z0-9_-]{20,30}$/.test(candidateArtistId) ? candidateArtistId : '';
  return {
    id: entry.id,
    title: String(entry.title || 'Untitled song').slice(0, 200),
    artist: String(entry.artist || entry.channel || entry.uploader || 'Unknown artist').slice(0, 120),
    artistId,
    duration: Number.isFinite(entry.duration) ? entry.duration : null,
    thumbnail: typeof entry.thumbnail === 'string' && entry.thumbnail.startsWith('/api/')
      ? entry.thumbnail : musicArtwork(entry.thumbnails, `/api/thumbnail/${entry.id}`)
  };
}

function musicArtist(entry) {
  const id = entry?.channel_id || entry?.id;
  if (!/^UC[A-Za-z0-9_-]{20,30}$/.test(id || '')) return null;
  return {
    id,
    name: String(entry.name || entry.channel || entry.title || entry.uploader || 'Artist').slice(0, 120),
    image: typeof entry.image === 'string' && entry.image.startsWith('/api/')
      ? entry.image : musicArtwork(entry.thumbnails, `/api/channel-avatar/${id}`)
  };
}

function musicAlbum(entry) {
  let id = entry?.id;
  if (!/^[A-Za-z0-9_-]{15,100}$/.test(id || '')) {
    try { id = new URL(entry?.url).searchParams.get('list'); } catch { id = ''; }
  }
  if (!/^[A-Za-z0-9_-]{15,100}$/.test(id || '')) return null;
  return {
    id,
    title: String(entry.title || 'Untitled album').slice(0, 200),
    artist: String(entry.artist || entry.channel || entry.uploader || '').slice(0, 120),
    thumbnail: musicArtwork(entry.thumbnails)
  };
}

app.get('/api/music/search', expensiveLimiter, async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const type = ['artists', 'albums'].includes(req.query.type) ? req.query.type : 'songs';
  if (!query || query.length > 120) return res.status(400).json({ error: 'Enter a search up to 120 characters.' });
  const key = `${type}:${query.toLowerCase()}`;
  const cached = musicSearchCache.get(key);
  if (cached?.expires > Date.now()) return res.json(cached.value);
  try {
    const url = `https://music.youtube.com/search?q=${encodeURIComponent(query)}#${type}`;
    let entries;
    try {
      const raw = await runYtDlp(['--flat-playlist', '--playlist-end', '24', '--dump-single-json', '--no-warnings', url], 35000);
      entries = JSON.parse(raw).entries || [];
    } catch {
      entries = [];
    }
    if (!entries.length && type !== 'albums') {
      // Music search is not available on every YouTube session. Keep search usable.
      const raw = await runYtDlp(['--flat-playlist', '--dump-single-json', '--no-warnings', `ytsearch24:${query} music`], 35000);
      entries = JSON.parse(raw).entries || [];
    }
    const mapper = type === 'artists' ? musicArtist : type === 'albums' ? musicAlbum : musicSong;
    const items = entries.map(mapper).filter(Boolean);
    const value = { items: [...new Map(items.map((item) => [item.id, item])).values()] };
    musicSearchCache.set(key, { value, expires: Date.now() + 5 * 60_000 });
    res.json(value);
  } catch (error) { res.status(502).json({ error: error.message }); }
});

app.get('/api/music/albums/:id', expensiveLimiter, async (req, res) => {
  const id = req.params.id;
  if (!/^[A-Za-z0-9_-]{15,100}$/.test(id)) return res.status(400).json({ error: 'Invalid album ID.' });
  try {
    const raw = await runYtDlp([
      '--flat-playlist', '--playlist-end', '100', '--dump-single-json', '--no-warnings',
      `https://music.youtube.com/playlist?list=${encodeURIComponent(id)}`
    ], 45000);
    const data = JSON.parse(raw);
    const songs = (data.entries || []).map(musicSong).filter(Boolean);
    res.json({ album: {
      id, title: String(data.title || 'Album').slice(0, 200),
      artist: String(data.artist || data.channel || data.uploader || songs[0]?.artist || '').slice(0, 120),
      thumbnail: musicArtwork(data.thumbnails, songs[0]?.thumbnail || '')
    }, songs });
  } catch (error) { res.status(502).json({ error: error.message }); }
});

app.get('/api/music/artists/:id', expensiveLimiter, async (req, res) => {
  const id = req.params.id;
  if (!/^UC[A-Za-z0-9_-]{20,30}$/.test(id)) return res.status(400).json({ error: 'Invalid artist ID.' });
  const cached = artistCache.get(id);
  if (cached?.expires > Date.now()) return res.json(cached.value);
  try {
    let data;
    let songs = [];
    for (const url of [`https://music.youtube.com/channel/${id}/songs`, `https://music.youtube.com/channel/${id}`, `https://www.youtube.com/channel/${id}/videos`]) {
      try {
        data = JSON.parse(await runYtDlp(['--flat-playlist', '--playlist-end', '30', '--dump-single-json', '--no-warnings', url], 45000));
        songs = (data.entries || []).map(musicSong).filter(Boolean);
        if (songs.length) break;
      } catch { /* try the next supported channel view */ }
    }
    if (!data) throw new Error('Could not load this artist.');
    const value = {
      artist: {
        id,
        name: String(data.channel || data.uploader || data.title || 'Artist').slice(0, 120),
        description: String(data.description || '').slice(0, 3000),
        image: proxiedImageUrl(pickChannelImage(data.thumbnails, 'avatar')) || musicArtwork(data.thumbnails, `/api/channel-avatar/${id}`),
        banner: proxiedImageUrl(pickChannelImage(data.thumbnails, 'banner')),
        followers: Number.isFinite(data.channel_follower_count) ? data.channel_follower_count : null
      },
      songs: [...new Map(songs.map((song) => [song.id, song])).values()]
    };
    artistCache.set(id, { value, expires: Date.now() + 10 * 60_000 });
    res.json(value);
  } catch (error) { res.status(502).json({ error: error.message }); }
});

app.get('/api/music/library', (req, res) => {
  res.json({ library: { ...EMPTY_MUSIC_LIBRARY, ...readJsonFile(MUSIC_LIBRARY_FILE, {}) } });
});

app.put('/api/music/library', (req, res) => {
  const input = req.body?.library;
  if (!input || !['liked', 'artists', 'playlists', 'recent'].every((field) => Array.isArray(input[field]))) {
    return res.status(400).json({ error: 'Invalid music library.' });
  }
  const liked = input.liked.slice(0, 500).map(musicSong).filter(Boolean);
  const recent = input.recent.slice(0, 30).map(musicSong).filter(Boolean);
  const artists = input.artists.slice(0, 200).map(musicArtist).filter(Boolean);
  const playlists = input.playlists.slice(0, 100).filter((item) => typeof item?.id === 'string' && typeof item?.name === 'string').map((item) => ({
    id: item.id.slice(0, 50), name: item.name.trim().slice(0, 100),
    tracks: (Array.isArray(item.tracks) ? item.tracks : []).slice(0, 500).map(musicSong).filter(Boolean)
  }));
  const library = { liked, artists, playlists, recent };
  writeJsonFile(MUSIC_LIBRARY_FILE, library);
  res.json({ library });
});

function captionText(vtt) {
  const lines = String(vtt).split(/\r?\n/);
  const output = [];
  for (const line of lines) {
    const value = line.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    if (!value || value === 'WEBVTT' || value.includes('-->') || /^\d+$/.test(value) || /^NOTE\b/.test(value)) continue;
    if (output[output.length - 1] !== value) output.push(value);
  }
  return output.join('\n').slice(0, 20_000);
}

app.get('/api/music/lyrics/:id', expensiveLimiter, async (req, res) => {
  if (!isValidVideoId(req.params.id)) return res.status(400).json({ error: 'Invalid song ID.' });
  const title = typeof req.query.title === 'string' ? req.query.title.trim().slice(0, 150) : '';
  const artist = typeof req.query.artist === 'string' ? req.query.artist.trim().slice(0, 120) : '';
  const duration = Number(req.query.duration);
  const cacheKey = `${req.params.id}:${title}:${artist}`;
  const cached = lyricsCache.get(cacheKey);
  if (cached?.expires > Date.now()) return res.json(cached.value);
  if (title && artist) {
    try {
      const response = await axios.get('https://lrclib.net/api/search', {
        params: { track_name: title, artist_name: artist },
        headers: { 'User-Agent': 'YTgrab/1.0 (https://github.com/mohammadsdg/Ytgrab)' },
        timeout: 7000, maxRedirects: 0, maxContentLength: 256 * 1024
      });
      const normalized = (value) => String(value || '').toLocaleLowerCase()
        .replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const requestedTitle = normalized(title);
      const requestedArtist = normalized(artist);
      const match = (Array.isArray(response.data) ? response.data : []).find((item) => {
        const foundTitle = normalized(item.trackName);
        const foundArtist = normalized(item.artistName);
        return foundTitle && (foundTitle === requestedTitle || requestedTitle.startsWith(`${foundTitle} `))
          && (!requestedArtist || foundArtist.includes(requestedArtist) || requestedArtist.includes(foundArtist))
          && (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(item.duration) || Math.abs(item.duration - duration) <= 12)
          && (item.plainLyrics || item.syncedLyrics);
      });
      if (match) {
        const text = String(match.plainLyrics || match.syncedLyrics).replace(/^\[\d{2}:\d{2}(?:\.\d+)?\]\s*/gm, '').slice(0, 20_000);
        const value = { text, available: true, source: 'LRCLIB' };
        lyricsCache.set(cacheKey, { value, expires: Date.now() + 24 * 60 * 60_000 });
        return res.json(value);
      }
    } catch { /* captions can still be available */ }
  }
  try {
    const raw = await runYtDlp(['--no-playlist', '--skip-download', '--dump-single-json', '--no-warnings', `https://music.youtube.com/watch?v=${req.params.id}`], 45000);
    const data = JSON.parse(raw);
    const captions = data.subtitles || {};
    const automatic = data.automatic_captions || {};
    const pick = (group) => Object.keys(group).sort((a, b) => (a.startsWith('en') ? -1 : 0) - (b.startsWith('en') ? -1 : 0))
      .map((language) => ({ language, track: group[language]?.find((item) => item.ext === 'vtt') }))
      .find((item) => item.track?.url);
    const selected = pick(captions) || pick(automatic);
    if (!selected) {
      const value = { text: '', available: false };
      lyricsCache.set(cacheKey, { value, expires: Date.now() + 60 * 60_000 });
      return res.json(value);
    }
    const url = new URL(selected.track.url);
    if (url.protocol !== 'https:' || !['www.youtube.com', 'youtube.com'].includes(url.hostname)) {
      return res.json({ text: '', available: false });
    }
    const upstream = await axios.get(url.toString(), { responseType: 'text', timeout: 10000, maxRedirects: 0, maxContentLength: 256 * 1024 });
    const text = captionText(upstream.data);
    const value = { text, available: Boolean(text), language: selected.language, source: 'YouTube captions' };
    lyricsCache.set(cacheKey, { value, expires: Date.now() + 24 * 60 * 60_000 });
    res.json(value);
  } catch (error) { res.status(502).json({ error: error.message }); }
});
return [musicSearchCache, artistCache, lyricsCache];
};
