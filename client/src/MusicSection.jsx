import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AddRounded, ArrowBackRounded, EditRounded, FavoriteRounded, HeadphonesRounded,
  LibraryMusicRounded, PlayArrowRounded, SearchRounded, ShuffleRounded
} from '@mui/icons-material';
import {
  Avatar, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, Menu, MenuItem, Paper, TextField, Typography
} from '@mui/material';
import MusicPlayer from './music/MusicPlayer';
import SongRow, { time } from './music/MusicSongRow';
import useMusicPlayback from './music/useMusicPlayback';

const emptyLibrary = { liked: [], artists: [], albums: [], playlists: [], recent: [] };
const moods = [
  ['Late night', 'late night R&B'], ['Focus', 'instrumental focus'],
  ['Persian', 'Persian music'], ['Electronic', 'electronic music'],
  ['Acoustic', 'acoustic songs']
];

export default function MusicSection({ api, active, onDownload, onNotice }) {
  const [view, setView] = useState('home');
  const [library, setLibrary] = useState(emptyLibrary);
  const libraryRef = useRef(emptyLibrary);
  const serverLibraryRef = useRef(emptyLibrary);
  const libraryRevisionRef = useRef(0);
  const pendingSavesRef = useRef(0);
  const saveChainRef = useRef(Promise.resolve());
  const [loaded, setLoaded] = useState(false);
  const [homeLoaded, setHomeLoaded] = useState(false);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeSongs, setHomeSongs] = useState([]);
  const [query, setQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ytgrab_music_searches') || '[]').slice(0, 8); }
    catch { return []; }
  });
  const [results, setResults] = useState({ songs: [], artists: [], albums: [] });
  const [searching, setSearching] = useState(false);
  const [searchUnavailable, setSearchUnavailable] = useState(false);
  const searchRequestRef = useRef(0);
  const searchAbortRef = useRef(null);
  const searchCacheRef = useRef(new Map());
  const lastSearchedRef = useRef('');
  const backViewRef = useRef('search');
  const [artistPage, setArtistPage] = useState(null);
  const [artistReleases, setArtistReleases] = useState(null);
  const [artistLoading, setArtistLoading] = useState(false);
  const artistRequestRef = useRef(0);
  const [albumPage, setAlbumPage] = useState(null);
  const [albumLoading, setAlbumLoading] = useState(false);
  const albumRequestRef = useRef(0);
  const [selectedList, setSelectedList] = useState(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [pendingPlaylistSong, setPendingPlaylistSong] = useState(null);
  const [playlistPickerSong, setPlaylistPickerSong] = useState(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [menu, setMenu] = useState(null);
  useEffect(() => {
    if (!active || loaded) return;
    api('/api/music/library').then(({ library: saved, revision }) => {
      const next = { ...emptyLibrary, ...saved };
      libraryRef.current = next;
      serverLibraryRef.current = next;
      libraryRevisionRef.current = revision || 0;
      setLibrary(next);
      setLoaded(true);
    }).catch((error) => { onNotice(error.message); setLoaded(true); });
  }, [active, loaded]);

  useEffect(() => {
    if (!active || !loaded || homeLoaded || library.recent.length || library.liked.length) return;
    setHomeLoaded(true);
    setHomeLoading(true);
    api('/api/music/search?q=music&type=songs')
      .then((data) => setHomeSongs(data.items || []))
      .catch((error) => onNotice(error.message))
      .finally(() => setHomeLoading(false));
  }, [active, loaded, homeLoaded]);

  const updateLibrary = (change) => {
    const next = change(libraryRef.current);
    libraryRef.current = next;
    setLibrary(next);
    pendingSavesRef.current += 1;
    saveChainRef.current = saveChainRef.current.catch(() => {}).then(async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = change(serverLibraryRef.current);
        const response = await fetch('/api/music/library', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ library: candidate, revision: libraryRevisionRef.current })
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) window.dispatchEvent(new Event('ytgrab:unauthorized'));
        if (response.status === 409) {
          serverLibraryRef.current = { ...emptyLibrary, ...data.library };
          libraryRevisionRef.current = data.revision;
          continue;
        }
        if (!response.ok) throw new Error(data.error || 'Could not save music library.');
        serverLibraryRef.current = { ...emptyLibrary, ...data.library };
        libraryRevisionRef.current = data.revision;
        return;
      }
      throw new Error('Library changed repeatedly. Please try again.');
    }).catch((error) => onNotice(`Could not save music library: ${error.message}`))
      .finally(() => {
        pendingSavesRef.current -= 1;
        if (pendingSavesRef.current === 0) {
          libraryRef.current = serverLibraryRef.current;
          setLibrary(serverLibraryRef.current);
        }
      });
  };

  const search = async (term = query) => {
    const value = term.trim();
    if (!value) { searchAbortRef.current?.abort(); setSearching(false); return; }
    lastSearchedRef.current = value.toLowerCase();
    setQuery(value);
    setView('search');
    const request = ++searchRequestRef.current;
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const cached = searchCacheRef.current.get(value.toLowerCase());
    if (cached) setResults(cached);
    setSearching(true);
    const next = { songs: [], artists: [], albums: [] };
    const attempts = await Promise.allSettled(['songs', 'artists', 'albums'].map((type) =>
      api(`/api/music/search?q=${encodeURIComponent(value)}&type=${type}`, { signal: controller.signal }).then((data) => {
        next[type] = data.items || [];
        return data;
      })
    ));
    if (request !== searchRequestRef.current) return;
    if (attempts.every((item) => item.status === 'rejected')) onNotice('Music search is unavailable. Try again.');
    else {
      setResults(next);
      setSearchUnavailable(attempts.some((item) => item.status === 'fulfilled' && item.value.unavailable));
      searchCacheRef.current.set(value.toLowerCase(), next);
      if (searchCacheRef.current.size > 12) searchCacheRef.current.delete(searchCacheRef.current.keys().next().value);
      setRecentSearches((old) => {
        const updated = [value, ...old.filter((item) => item.toLowerCase() !== value.toLowerCase())].slice(0, 8);
        localStorage.setItem('ytgrab_music_searches', JSON.stringify(updated));
        return updated;
      });
    }
    setSearching(false);
  };

  useEffect(() => {
    if (view !== 'search' || !query.trim() || query.trim().toLowerCase() === lastSearchedRef.current) return undefined;
    const timer = setTimeout(() => search(query), 420);
    return () => clearTimeout(timer);
  }, [query]);

  const openArtist = async (id, fallbackName = '') => {
    if (!id) return;
    const request = ++artistRequestRef.current;
    if (view !== 'artist') backViewRef.current = view;
    setView('artist');
    setArtistPage({ artist: { id, name: fallbackName || 'Artist', image: `/api/channel-avatar/${id}` }, songs: [] });
    setArtistReleases(null);
    setArtistLoading(true);
    try { const data = await api(`/api/music/artists/${encodeURIComponent(id)}`); if (request === artistRequestRef.current) setArtistPage(data); }
    catch (error) { if (request === artistRequestRef.current) onNotice(error.message); }
    finally { if (request === artistRequestRef.current) setArtistLoading(false); }
    api(`/api/music/artists/${encodeURIComponent(id)}/releases`)
      .then((data) => { if (request === artistRequestRef.current) setArtistReleases(data); }).catch(() => {});
  };

  const openAlbum = async (album) => {
    const request = ++albumRequestRef.current;
    if (view !== 'album') backViewRef.current = view;
    setView('album');
    setAlbumPage({ album, songs: [] });
    setAlbumLoading(true);
    try {
      const data = await api(`/api/music/albums/${encodeURIComponent(album.id)}`);
      if (request === albumRequestRef.current) setAlbumPage({ ...data, songs: data.songs.map((song) => ({ ...song, album: song.album || data.album.title })) });
    }
    catch (error) { if (request === albumRequestRef.current) onNotice(error.message); }
    finally { if (request === albumRequestRef.current) setAlbumLoading(false); }
  };

  const toggleFollow = (artist) => updateLibrary((old) => ({ ...old,
    artists: old.artists.some((item) => item.id === artist.id)
      ? old.artists.filter((item) => item.id !== artist.id)
      : [artist, ...old.artists]
  }));

  const toggleLike = (song) => updateLibrary((old) => ({ ...old,
    liked: old.liked.some((item) => item.id === song.id)
      ? old.liked.filter((item) => item.id !== song.id)
      : [song, ...old.liked]
  }));

  const toggleSaveAlbum = (album) => updateLibrary((old) => ({ ...old,
    albums: old.albums.some((item) => item.id === album.id)
      ? old.albums.filter((item) => item.id !== album.id)
      : [album, ...old.albums]
  }));

  const {
    queue, current, streamState, playing, setPlaying, onAudioTimeUpdate, onAudioPlay, onAudioPause, onAudioWaiting, onAudioError, elapsed, setElapsed,
    duration, setDuration, shuffle, repeat, rate, setRate,
    volume, setVolume, muted, setMuted, sleep, lyrics, lyricsLoading, lyricsOffsets,
    setLyricsOffsets, audioRef, prepare, playSong, playCollection, toggleShuffle, cycleRepeat,
    playQueue, step, moveQueue, removeQueue, addToQueue, clearUpcoming, showLyrics, seek, closePlayer,
    setSleepTimer
  } = useMusicPlayback({ api, active, onNotice, onPlayed: (song) => updateLibrary((old) => ({
    ...old, recent: [song, ...old.recent.filter((item) => item.id !== song.id)].slice(0, 100)
  })) });

  const createPlaylist = () => {
    const name = playlistName.trim();
    if (!name) return;
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const song = pendingPlaylistSong;
    updateLibrary((old) => ({ ...old, playlists: [...old.playlists, { id, name, tracks: song ? [song] : [] }] }));
    setPlaylistName(''); setPlaylistOpen(false); setPendingPlaylistSong(null);
  };

  const addToPlaylist = (id, song) => {
    if (libraryRef.current.playlists.find((list) => list.id === id)?.tracks.some((item) => item.id === song.id)) {
      setMenu(null); onNotice('Already in this playlist.'); return;
    }
    updateLibrary((old) => ({ ...old, playlists: old.playlists.map((list) => list.id === id && !list.tracks.some((item) => item.id === song.id)
      ? { ...list, tracks: [...list.tracks, song] } : list) }));
    setMenu(null);
    onNotice('Added to playlist.');
  };

  const removeFromPlaylist = (id, song) => {
    updateLibrary((old) => ({ ...old, playlists: old.playlists.map((list) => list.id === id
      ? { ...list, tracks: list.tracks.filter((item) => item.id !== song.id) } : list) }));
    setMenu(null);
  };

  const deletePlaylist = (id) => {
    if (!window.confirm('Delete this playlist?')) return;
    updateLibrary((old) => ({ ...old, playlists: old.playlists.filter((list) => list.id !== id) }));
    setSelectedList(null);
  };

  const renamePlaylist = () => {
    const name = renameName.trim();
    if (!name || !selectedList || selectedList === 'liked') return;
    updateLibrary((old) => ({ ...old, playlists: old.playlists.map((list) => list.id === selectedList ? { ...list, name } : list) }));
    setRenameOpen(false);
  };

  const movePlaylistTrack = (from, to) => {
    const movingId = libraryRef.current.playlists.find((list) => list.id === selectedList)?.tracks[from]?.id;
    const afterId = libraryRef.current.playlists.find((list) => list.id === selectedList)?.tracks[to]?.id;
    if (!movingId || !afterId) return;
    updateLibrary((old) => ({ ...old, playlists: old.playlists.map((list) => {
      if (list.id !== selectedList) return list;
      const tracks = [...list.tracks];
      const fromIndex = tracks.findIndex((item) => item.id === movingId);
      const targetIndex = tracks.findIndex((item) => item.id === afterId);
      if (fromIndex < 0 || targetIndex < 0) return list;
      const [moving] = tracks.splice(fromIndex, 1);
      tracks.splice(targetIndex, 0, moving);
      return { ...list, tracks };
    }) }));
  };


  const currentList = selectedList === 'liked' ? library.liked : selectedList === 'recent' ? library.recent : library.playlists.find((list) => list.id === selectedList)?.tracks || [];
  const personalMix = [...new Map([...library.liked, ...library.recent].map((song) => [song.id, song])).values()];
  const row = (song, index, source, reorder = false) => <SongRow key={song.id} {...{ song, index, current, playing }}
    liked={library.liked.some((item) => item.id === song.id)} onPlay={(item) => playSong(item, source)}
    onArtist={openArtist} onLike={toggleLike} onDownload={onDownload}
    onMenu={(item, anchor) => setMenu({ song: item, anchor })}
    onMove={reorder ? movePlaylistTrack : undefined} count={source.length} />;

  return <Box className="music-section">
    <Box className="music-heading"><Box><Typography variant="overline" color="primary">YTGRAB</Typography><Typography variant="h4" fontWeight={800}>Music</Typography></Box><HeadphonesRounded className="music-heading-icon" /></Box>
    <Box className="music-subnav">
      {[['home', 'Discover'], ['search', 'Search'], ['library', 'Library']].map(([id, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => { setView(id); setSelectedList(null); }}>{label}</button>)}
    </Box>

    {view === 'home' && <>
      <Box className="music-feature music-feature-personal">
        {library.recent[0]?.thumbnail && <img className="music-feature-cover" src={library.recent[0].thumbnail} alt="" />}
        <Box><Typography variant="overline">{library.recent.length ? 'PICK UP WHERE YOU LEFT OFF' : 'YOUR LISTENING SPACE'}</Typography>
          <Typography variant="h3" fontWeight={800} dir="auto">{library.recent[0]?.title || 'Start with a song.'}</Typography>
          <Typography color="text.secondary" dir="auto">{library.recent[0]?.artist || 'Search the catalog and make this space yours.'}</Typography>
          <Button variant="contained" startIcon={library.recent.length ? <PlayArrowRounded /> : <SearchRounded />} onClick={() => library.recent.length ? playSong(library.recent[0], library.recent) : setView('search')}>{library.recent.length ? 'Listen again' : 'Search music'}</Button>
        </Box>
      </Box>
      {!!library.recent.length && <Box className="music-block"><Typography variant="h5" fontWeight={700}>Recently played</Typography><Box className="music-song-list">{library.recent.slice(0, 6).map((song, index) => row(song, index, library.recent))}</Box></Box>}
      {personalMix.length >= 6 && <Box className="music-mix"><Box className="music-mix-art">{personalMix.slice(0, 3).map((song) => <img key={song.id} src={song.thumbnail} alt="" />)}</Box><Box><Typography variant="overline" color="primary">FROM YOUR LIBRARY</Typography><Typography variant="h6" fontWeight={700}>Your mix</Typography><Typography color="text.secondary" variant="body2">Liked songs and recent listens, shuffled together.</Typography></Box><Button variant="outlined" startIcon={<ShuffleRounded />} onClick={() => playCollection(personalMix, true)}>Play mix</Button></Box>}
      {!!library.liked.length && <Box className="music-block"><Box className="music-section-line"><Typography variant="h5" fontWeight={700}>Liked songs</Typography><Button onClick={() => { setView('library'); setSelectedList('liked'); }}>See all</Button></Box><Box className="music-art-grid">{library.liked.slice(0, 6).map((song) => <button key={song.id} className="music-art-card" onClick={() => playSong(song, library.liked)}><img src={song.thumbnail} alt="" /><strong dir="auto">{song.title}</strong><span dir="auto">{song.artist}</span></button>)}</Box></Box>}
      {!!library.playlists.length && <Box className="music-block"><Box className="music-section-line"><Typography variant="h5" fontWeight={700}>Your playlists</Typography><Button onClick={() => setView('library')}>See all</Button></Box><Box className="music-home-playlists">{library.playlists.slice(0, 6).map((list) => <button key={list.id} onClick={() => { setView('library'); setSelectedList(list.id); }}>{list.tracks[0]?.thumbnail ? <img src={list.tracks[0].thumbnail} alt="" /> : <LibraryMusicRounded />}<span><strong dir="auto">{list.name}</strong><small>{list.tracks.length} songs</small></span></button>)}</Box></Box>}
      {!!library.albums.length && <Box className="music-block"><Typography variant="h5" fontWeight={700}>Saved albums</Typography><Box className="music-art-grid">{library.albums.slice(0, 6).map((album) => <button key={album.id} className="music-art-card" onClick={() => openAlbum(album)}>{album.thumbnail ? <img src={album.thumbnail} alt="" /> : <Box className="music-album-placeholder"><LibraryMusicRounded /></Box>}<strong dir="auto">{album.title}</strong><span dir="auto">{album.artist}</span></button>)}</Box></Box>}
      {!!library.artists.length && <Box className="music-block"><Typography variant="h5" fontWeight={700}>Artists you follow</Typography><Box className="music-artists">{library.artists.map((artist) => <button key={artist.id} onClick={() => openArtist(artist.id, artist.name)}><Avatar src={artist.image} /><span dir="auto">{artist.name}</span></button>)}</Box></Box>}
      <Box className="music-block"><Typography variant="h5" fontWeight={700}>Explore a sound</Typography><Box className="music-moods">{moods.map(([name, term]) => <button key={name} onClick={() => search(term)}>{name}<SearchRounded fontSize="small" /></button>)}</Box></Box>
      {!library.recent.length && !library.liked.length && <Box className="music-block"><Typography variant="h5" fontWeight={700}>From the catalog</Typography>{homeSongs.length ? <Box className="music-song-list">{homeSongs.slice(0, 12).map((song, index) => row(song, index, homeSongs))}</Box> : <Box className="music-loading">{homeLoading ? <CircularProgress size={24} /> : 'Search for music to fill this space.'}</Box>}</Box>}
    </>}

    {view === 'search' && <Box className="music-block music-search-view">
      <Typography variant="h5" fontWeight={700}>Search music</Typography>
      <TextField fullWidth value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && search()} placeholder="Songs, artists, albums" inputProps={{ dir: 'auto', 'aria-label': 'Search music' }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded /></InputAdornment>, endAdornment: <Button onClick={() => search()}>Search</Button> }} />
      {!query && !!recentSearches.length && <Box className="music-recent-searches"><Typography variant="subtitle2">Recent searches</Typography>{recentSearches.map((term) => <button key={term} onClick={() => search(term)}>{term}</button>)}<button className="clear" onClick={() => { setRecentSearches([]); localStorage.removeItem('ytgrab_music_searches'); }}>Clear</button></Box>}
      {searching && <Box className="music-loading"><CircularProgress size={24} /></Box>}
      {!searching && searchUnavailable && <Typography color="text.secondary" variant="body2">Some catalog results are unavailable from YouTube Music right now.</Typography>}
      <>
        {!!results.artists.length && <><Typography variant="h6" fontWeight={700}>Artists</Typography><Box className="music-artists">{results.artists.map((artist) => <button key={artist.id} onClick={() => openArtist(artist.id, artist.name)}><Avatar src={artist.image} /><span dir="auto">{artist.name}</span></button>)}</Box></>}
        {!!results.albums.length && <><Typography variant="h6" fontWeight={700}>Albums</Typography><Box className="music-art-grid">{results.albums.map((album) => <button key={album.id} className="music-art-card" onClick={() => openAlbum(album)}>{album.thumbnail ? <img src={album.thumbnail} alt="" /> : <Box className="music-album-placeholder"><LibraryMusicRounded /></Box>}<strong dir="auto">{album.title}</strong><span dir="auto">{album.artist}</span></button>)}</Box></>}
        {!!results.songs.length && <><Typography variant="h6" fontWeight={700}>Songs</Typography><Box className="music-song-list">{results.songs.map((song, index) => row(song, index, results.songs))}</Box></>}
        {!searching && !results.artists.length && !results.albums.length && !results.songs.length && <Box className="music-empty"><SearchRounded /><Typography>Search for a song or artist to get started.</Typography></Box>}
      </>
    </Box>}

    {view === 'artist' && artistPage && <>
      <Button startIcon={<ArrowBackRounded />} onClick={() => setView(backViewRef.current)}>Back</Button>
      <Paper className="music-artist-hero" elevation={0} style={artistPage.artist.banner ? { '--artist-background': `linear-gradient(90deg, rgba(16,12,22,.94), rgba(16,12,22,.7)), url("${artistPage.artist.banner}")` } : undefined}><Avatar src={artistPage.artist.image}>{artistPage.artist.name[0]}</Avatar><Box><Typography variant="overline" color="primary">ARTIST</Typography><Typography variant="h3" fontWeight={800} dir="auto">{artistPage.artist.name}</Typography>{artistPage.artist.followers != null && <Typography color="text.secondary">{artistPage.artist.followers.toLocaleString()} followers</Typography>}</Box><Box className="music-collection-actions"><Button variant={library.artists.some((item) => item.id === artistPage.artist.id) ? 'outlined' : 'contained'} onClick={() => toggleFollow(artistPage.artist)}>{library.artists.some((item) => item.id === artistPage.artist.id) ? 'Following' : 'Follow artist'}</Button><Button disabled={!artistPage.songs.length} startIcon={<PlayArrowRounded />} onClick={() => playCollection(artistPage.songs)}>Play</Button><Button className="music-artist-shuffle" aria-label="Shuffle artist songs" disabled={!artistPage.songs.length} startIcon={<ShuffleRounded />} onClick={() => playCollection(artistPage.songs, true)}>Shuffle</Button></Box></Paper>
      {artistPage.artist.description && <Typography className="music-artist-description" dir="auto">{artistPage.artist.description}</Typography>}
      {!!artistReleases?.albums?.length && <Box className="music-block"><Typography variant="h5" fontWeight={700}>Albums</Typography><Box className="music-art-grid">{artistReleases.albums.map((album) => <button key={album.id} className="music-art-card" onClick={() => openAlbum(album)}>{album.thumbnail ? <img src={album.thumbnail} alt="" /> : <Box className="music-album-placeholder"><LibraryMusicRounded /></Box>}<strong dir="auto">{album.title}</strong><span>{album.year || ''}</span></button>)}</Box></Box>}
      {!!artistReleases?.singles?.length && <Box className="music-block"><Typography variant="h5" fontWeight={700}>Singles & EPs</Typography><Box className="music-art-grid">{artistReleases.singles.map((album) => <button key={album.id} className="music-art-card" onClick={() => openAlbum(album)}>{album.thumbnail ? <img src={album.thumbnail} alt="" /> : <Box className="music-album-placeholder"><LibraryMusicRounded /></Box>}<strong dir="auto">{album.title}</strong><span>{album.year || ''}</span></button>)}</Box></Box>}
      <Box className="music-block"><Typography variant="h5" fontWeight={700}>Songs</Typography>{artistLoading ? <Box className="music-loading"><CircularProgress /></Box> : artistPage.songs.length ? <Box className="music-song-list">{artistPage.songs.map((song, index) => row(song, index, artistPage.songs))}</Box> : <Box className="music-empty">No songs were available for this artist.</Box>}</Box>
    </>}

    {view === 'album' && albumPage && <>
      <Button startIcon={<ArrowBackRounded />} onClick={() => setView(backViewRef.current)}>Back</Button>
      <Paper className="music-artist-hero music-album-hero" elevation={0}>{albumPage.album.thumbnail ? <img src={albumPage.album.thumbnail} alt="" /> : <Box className="music-album-placeholder"><LibraryMusicRounded /></Box>}<Box><Typography variant="overline" color="primary">ALBUM</Typography><Typography variant="h3" fontWeight={800} dir="auto">{albumPage.album.title}</Typography><Typography color="text.secondary" dir="auto">{albumPage.album.artist} {albumPage.album.year ? `· ${albumPage.album.year}` : ''} · {albumPage.songs.length} songs {albumPage.songs.some((song) => song.duration) ? `· ${time(albumPage.songs.reduce((sum, song) => sum + (song.duration || 0), 0))}` : ''}</Typography><Box className="music-collection-actions"><Button variant="contained" disabled={!albumPage.songs.length} startIcon={<PlayArrowRounded />} onClick={() => playCollection(albumPage.songs)}>Play album</Button><Button variant="outlined" disabled={!albumPage.songs.length} startIcon={<ShuffleRounded />} onClick={() => playCollection(albumPage.songs, true)}>Shuffle</Button><Button onClick={() => toggleSaveAlbum(albumPage.album)}>{library.albums.some((item) => item.id === albumPage.album.id) ? 'Saved' : 'Save album'}</Button></Box></Box></Paper>
      <Box className="music-block"><Typography variant="h5" fontWeight={700}>Tracks</Typography>{albumLoading ? <Box className="music-loading"><CircularProgress /></Box> : albumPage.songs.length ? <Box className="music-song-list">{albumPage.songs.map((song, index) => row(song, index, albumPage.songs))}</Box> : <Box className="music-empty">No tracks were available for this album.</Box>}</Box>
    </>}

    {view === 'library' && <Box className="music-block">
      <Box className="music-library-heading">
        <Box><Typography variant="h5" fontWeight={700}>Your library</Typography><Typography color="text.secondary">Liked songs, followed artists, and playlists.</Typography></Box>
        <Button variant="contained" startIcon={<AddRounded />} onClick={() => { setPendingPlaylistSong(null); setPlaylistOpen(true); }}>New playlist</Button>
      </Box>
      {!selectedList && <>
        <Box className="music-library-grid">
          <button onClick={() => setSelectedList('liked')}><FavoriteRounded /><strong>Liked songs</strong><small>{library.liked.length} songs</small></button>
          <button onClick={() => setSelectedList('recent')}><HeadphonesRounded /><strong>Recently played</strong><small>{library.recent.length} songs</small></button>
          {library.playlists.map((list) => <button key={list.id} onClick={() => setSelectedList(list.id)}>
            {list.tracks[0]?.thumbnail ? <img src={list.tracks[0].thumbnail} alt="" /> : <LibraryMusicRounded />}
            <strong dir="auto">{list.name}</strong><small>{list.tracks.length} songs</small>
          </button>)}
        </Box>
        {!!library.artists.length && <><Typography variant="h6" fontWeight={700}>Following</Typography><Box className="music-artists">{library.artists.map((artist) => <button key={artist.id} onClick={() => openArtist(artist.id, artist.name)}><Avatar src={artist.image} /><span dir="auto">{artist.name}</span></button>)}</Box></>}
        {!!library.albums.length && <><Typography variant="h6" fontWeight={700}>Saved albums</Typography><Box className="music-art-grid">{library.albums.map((album) => <button key={album.id} className="music-art-card" onClick={() => openAlbum(album)}>{album.thumbnail ? <img src={album.thumbnail} alt="" /> : <Box className="music-album-placeholder"><LibraryMusicRounded /></Box>}<strong dir="auto">{album.title}</strong><span dir="auto">{album.artist}</span></button>)}</Box></>}
      </>}
      {selectedList && <>
        <Button startIcon={<ArrowBackRounded />} onClick={() => setSelectedList(null)}>All music</Button>
        <Box className="music-library-heading music-playlist-title">
          <Box><Typography variant="h5" fontWeight={800} dir="auto">{selectedList === 'liked' ? 'Liked songs' : selectedList === 'recent' ? 'Recently played' : library.playlists.find((list) => list.id === selectedList)?.name}</Typography><Typography color="text.secondary">{currentList.length} songs{selectedList === 'recent' ? ' · latest first' : ' · your order'}</Typography></Box>
          <Box className="music-playlist-actions">
            <Button variant="contained" startIcon={<PlayArrowRounded />} disabled={!currentList.length} onClick={() => playCollection(currentList)}>Play</Button>
            <Button variant="outlined" startIcon={<ShuffleRounded />} disabled={!currentList.length} onClick={() => playCollection(currentList, true)}>Shuffle</Button>
            {selectedList === 'recent' && <Button color="error" disabled={!library.recent.length} onClick={() => { if (window.confirm('Clear your listening history?')) updateLibrary((old) => ({ ...old, recent: [] })); }}>Clear history</Button>}
            {selectedList !== 'liked' && selectedList !== 'recent' && <><IconButton aria-label="Rename playlist" title="Rename playlist" onClick={() => { setRenameName(library.playlists.find((list) => list.id === selectedList)?.name || ''); setRenameOpen(true); }}><EditRounded /></IconButton><Button color="error" onClick={() => deletePlaylist(selectedList)}>Delete</Button></>}
          </Box>
        </Box>
        {currentList.length ? <Box className="music-song-list">{currentList.map((song, index) => row(song, index, currentList, selectedList !== 'liked' && selectedList !== 'recent'))}</Box> : <Box className="music-empty">No songs here yet. Find one and add it.</Box>}
      </>}
    </Box>}

    {createPortal(<MusicPlayer
      current={current} queue={queue} audioRef={audioRef} streamState={streamState} playing={playing}
      elapsed={elapsed} duration={duration} shuffle={shuffle} repeat={repeat} rate={rate} volume={volume} muted={muted} sleep={sleep}
      lyrics={lyrics} lyricsLoading={lyricsLoading} lyricsOffset={lyricsOffsets[current?.id] || 0}
      liked={Boolean(current && library.liked.some((item) => item.id === current.id))}
      onTimeUpdate={onAudioTimeUpdate}
      onEnded={() => step(1, true)} onPlay={onAudioPlay} onPause={onAudioPause} onWaiting={onAudioWaiting} onError={onAudioError}
      onToggle={() => streamState === 'error' && current ? prepare(current) : setPlaying((value) => !value)} onNext={() => step(1)} onPrevious={() => step(-1)} onSeek={seek}
      onShuffle={toggleShuffle} onRepeat={cycleRepeat}
      onRate={setRate} onVolume={(value) => { setVolume(value); setMuted(false); }} onMute={() => setMuted((value) => !value)} onSleep={setSleepTimer}
      onLyrics={showLyrics} onLyricsOffset={(value) => current && setLyricsOffsets((old) => ({ ...old, [current.id]: Math.max(-60, Math.min(60, value)) }))}
      onLike={() => current && toggleLike(current)} onDownload={onDownload} onArtist={openArtist} onAddPlaylist={() => setPlaylistPickerSong(current)}
      onPlayQueue={playQueue} onMoveQueue={moveQueue} onRemoveQueue={removeQueue} onClearUpcoming={clearUpcoming} onClose={closePlayer}
    />, document.body)}

    <Menu anchorEl={menu?.anchor || null} open={Boolean(menu)} onClose={() => setMenu(null)}>
      <MenuItem onClick={() => { addToQueue(menu.song, true); setMenu(null); onNotice('Playing next.'); }}>Play next</MenuItem>
      <MenuItem onClick={() => { addToQueue(menu.song); setMenu(null); onNotice('Added to queue.'); }}>Add to queue</MenuItem>
      <MenuItem onClick={() => { onDownload(menu.song); setMenu(null); }}>Download best audio</MenuItem>
      {view === 'library' && selectedList && !['liked', 'recent'].includes(selectedList) && <MenuItem onClick={() => removeFromPlaylist(selectedList, menu.song)}>Remove from this playlist</MenuItem>}
      {library.playlists.map((list) => <MenuItem key={list.id} onClick={() => addToPlaylist(list.id, menu.song)}>Add to {list.name}</MenuItem>)}
      <MenuItem onClick={() => { setPendingPlaylistSong(menu.song); setMenu(null); setPlaylistOpen(true); }}>New playlist with this song</MenuItem>
    </Menu>
    <Dialog open={playlistOpen} onClose={() => { setPlaylistOpen(false); setPendingPlaylistSong(null); }} fullWidth maxWidth="xs"><DialogTitle>New playlist</DialogTitle><DialogContent><TextField autoFocus fullWidth label="Playlist name" value={playlistName} onChange={(event) => setPlaylistName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && createPlaylist()} inputProps={{ maxLength: 100 }} /></DialogContent><DialogActions><Button onClick={() => { setPlaylistOpen(false); setPendingPlaylistSong(null); }}>Cancel</Button><Button variant="contained" onClick={createPlaylist}>Create</Button></DialogActions></Dialog>
    <Dialog open={Boolean(playlistPickerSong)} onClose={() => setPlaylistPickerSong(null)} fullWidth maxWidth="xs"><DialogTitle>Add to playlist</DialogTitle><DialogContent className="music-playlist-picker">{library.playlists.map((list) => <Button key={list.id} onClick={() => { addToPlaylist(list.id, playlistPickerSong); setPlaylistPickerSong(null); }}>{list.name}</Button>)}<Button startIcon={<AddRounded />} onClick={() => { setPendingPlaylistSong(playlistPickerSong); setPlaylistPickerSong(null); setPlaylistOpen(true); }}>New playlist</Button></DialogContent></Dialog>
    <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} fullWidth maxWidth="xs"><DialogTitle>Rename playlist</DialogTitle><DialogContent><TextField autoFocus fullWidth label="Playlist name" value={renameName} onChange={(event) => setRenameName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && renamePlaylist()} inputProps={{ maxLength: 100 }} /></DialogContent><DialogActions><Button onClick={() => setRenameOpen(false)}>Cancel</Button><Button variant="contained" onClick={renamePlaylist}>Save</Button></DialogActions></Dialog>

  </Box>;
}
