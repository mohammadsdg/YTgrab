const { parseLrc, parseVtt } = require('../music-lyrics');
const { readMusicLibrary, putMusicLibrary } = require('../music-library-store');

module.exports = function registerMusicRoutes({ app, expensiveLimiter, runYtDlp, isValidVideoId, proxiedImageUrl, pickChannelImage, readJsonFile, writeJsonFile, MUSIC_LIBRARY_FILE, axios }) {
// ---------- music ----------

const musicSearchCache = new Map();
const musicSearchRequests = new Map();
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
    album: String(entry.album || '').slice(0, 160),
    year: Number.isInteger(Number(entry.year || entry.release_year)) && Number(entry.year || entry.release_year) >= 1900
      ? Number(entry.year || entry.release_year) : null,
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
    thumbnail: typeof entry.thumbnail === 'string' && entry.thumbnail.startsWith('/api/')
      ? entry.thumbnail : musicArtwork(entry.thumbnails),
    year: Number(entry.release_year || entry.year) || null
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
    if (musicSearchRequests.has(key)) return res.json(await musicSearchRequests.get(key));
    const request = (async () => {
    const url = `https://music.youtube.com/search?q=${encodeURIComponent(query)}#${type}`;
    let entries;
    let unavailable = false;
    try {
      const raw = await runYtDlp(['--flat-playlist', '--playlist-end', '24', '--dump-single-json', '--no-warnings', url], 35000);
      entries = JSON.parse(raw).entries || [];
    } catch {
      entries = [];
      unavailable = true;
    }
    if (!entries.length && type === 'songs') {
      // Music search is not available on every YouTube session. Keep search usable.
      const raw = await runYtDlp(['--flat-playlist', '--dump-single-json', '--no-warnings', `ytsearch24:${query} music`], 35000);
      entries = JSON.parse(raw).entries || [];
      unavailable = false;
    }
    const mapper = type === 'artists' ? musicArtist : type === 'albums' ? musicAlbum : musicSong;
    const items = entries.map(mapper).filter(Boolean);
    if (type === 'songs') {
      const wantsVariant = /\b(live|cover|remix|karaoke|slowed|sped up)\b/i.test(query);
      if (!wantsVariant) items.sort((a, b) =>
        Number(/\b(live|cover|remix|karaoke|slowed|sped up)\b/i.test(a.title))
        - Number(/\b(live|cover|remix|karaoke|slowed|sped up)\b/i.test(b.title)));
    }
    const value = { items: [...new Map(items.map((item) => [item.id, item])).values()], unavailable };
    musicSearchCache.set(key, { value, expires: Date.now() + 5 * 60_000 });
    if (musicSearchCache.size > 120) musicSearchCache.delete(musicSearchCache.keys().next().value);
    return value;
    })();
    musicSearchRequests.set(key, request);
    try { res.json(await request); }
    finally { musicSearchRequests.delete(key); }
  } catch { res.status(502).json({ error: 'Music search is unavailable right now. Try again.' }); }
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
      thumbnail: musicArtwork(data.thumbnails, songs[0]?.thumbnail || ''),
      year: Number(data.release_year || data.year) || null
    }, songs });
  } catch { res.status(502).json({ error: 'Could not load this album. Try again.' }); }
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
    if (artistCache.size > 100) artistCache.delete(artistCache.keys().next().value);
    res.json(value);
  } catch { res.status(502).json({ error: 'Could not load this artist. Try again.' }); }
});

app.get('/api/music/artists/:id/releases', expensiveLimiter, async (req, res) => {
  const id = req.params.id;
  if (!/^UC[A-Za-z0-9_-]{20,30}$/.test(id)) return res.status(400).json({ error: 'Invalid artist ID.' });
  const key = `${id}:releases`;
  const cached = artistCache.get(key);
  if (cached?.expires > Date.now()) return res.json(cached.value);
  const paths = ['albums', 'singles'];
  const attempts = await Promise.allSettled(paths.map(async (section) => {
    const raw = await runYtDlp(['--flat-playlist', '--playlist-end', '30', '--dump-single-json', '--no-warnings',
      `https://music.youtube.com/channel/${id}/${section}`], 35000);
    return (JSON.parse(raw).entries || []).map(musicAlbum).filter(Boolean);
  }));
  const value = { albums: attempts[0].status === 'fulfilled' ? attempts[0].value : [],
    singles: attempts[1].status === 'fulfilled' ? attempts[1].value : [],
    available: attempts.some((item) => item.status === 'fulfilled') };
  if (value.available) artistCache.set(key, { value, expires: Date.now() + 30 * 60_000 });
  res.json(value);
});

app.get('/api/music/library', (req, res) => {
  res.json(readMusicLibrary(readJsonFile, MUSIC_LIBRARY_FILE));
});

app.put('/api/music/library', (req, res) => {
  const input = req.body?.library;
  if (!input || !['liked', 'artists', 'playlists', 'recent'].every((field) => Array.isArray(input[field])) || (input.albums != null && !Array.isArray(input.albums))) {
    return res.status(400).json({ error: 'Invalid music library.' });
  }
  const liked = input.liked.slice(0, 500).map(musicSong).filter(Boolean);
  const recent = input.recent.slice(0, 100).map(musicSong).filter(Boolean);
  const artists = input.artists.slice(0, 200).map(musicArtist).filter(Boolean);
  const albums = (input.albums || []).slice(0, 200).map(musicAlbum).filter(Boolean);
  const playlists = input.playlists.slice(0, 100).filter((item) => typeof item?.id === 'string' && typeof item?.name === 'string').map((item) => ({
    id: item.id.slice(0, 50), name: item.name.trim().slice(0, 100),
    tracks: (Array.isArray(item.tracks) ? item.tracks : []).slice(0, 500).map(musicSong).filter(Boolean)
  }));
  const result = putMusicLibrary({ readJsonFile, writeJsonFile, file: MUSIC_LIBRARY_FILE,
    revision: req.body.revision, library: { liked, artists, albums, playlists, recent } });
  if (result.conflict) return res.status(409).json({ error: 'Music library changed in another session.', ...result });
  res.json(result);
});

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
        const lines = parseLrc(match.syncedLyrics);
        const text = String(match.plainLyrics || lines.map((line) => line.text).join('\n')).slice(0, 20_000);
        const value = { text, lines, available: true, source: 'LRCLIB' };
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
      const value = { text: '', lines: [], available: false };
      lyricsCache.set(cacheKey, { value, expires: Date.now() + 60 * 60_000 });
      return res.json(value);
    }
    const url = new URL(selected.track.url);
    if (url.protocol !== 'https:' || !['www.youtube.com', 'youtube.com'].includes(url.hostname)) {
      return res.json({ text: '', lines: [], available: false });
    }
    const upstream = await axios.get(url.toString(), { responseType: 'text', timeout: 10000, maxRedirects: 0, maxContentLength: 256 * 1024 });
    const lines = parseVtt(upstream.data);
    const text = lines.map((line) => line.text).join('\n').slice(0, 20_000);
    const value = { text, lines, available: Boolean(text), language: selected.language, source: 'YouTube captions' };
    lyricsCache.set(cacheKey, { value, expires: Date.now() + 24 * 60 * 60_000 });
    res.json(value);
  } catch (error) { res.status(502).json({ error: error.message }); }
});
return [musicSearchCache, artistCache, lyricsCache];
};
