import { useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  AddRounded, ArrowBackRounded, CheckRounded, CloseRounded, DownloadRounded,
  FavoriteBorderRounded, FavoriteRounded, HeadphonesRounded, HomeRounded,
  LibraryMusicRounded, MoreHorizRounded, PauseRounded, PlayArrowRounded,
  PlaylistAddRounded, QueueMusicRounded, SearchRounded, SkipNextRounded,
  SkipPreviousRounded
} from '@mui/icons-material';
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, InputAdornment, Menu, MenuItem, Slider, TextField,
  Typography
} from '@mui/material';

const MUSIC_KEY = 'ytgrab_music_library_v1';
const starterMoods = [
  ['Late night', 'late night r&b mix'],
  ['Focus', 'instrumental focus music'],
  ['Feel good', 'feel good indie music'],
  ['Electronic', 'electronic music mix'],
  ['Persian', 'persian music'],
  ['Acoustic', 'acoustic sessions music']
];

function readLibrary() {
  try {
    const value = JSON.parse(localStorage.getItem(MUSIC_KEY));
    if (value && Array.isArray(value.liked) && Array.isArray(value.playlists)) return value;
  } catch { /* start fresh */ }
  return { liked: [], playlists: [], recent: [] };
}

function duration(value) {
  if (!Number.isFinite(value)) return '—';
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}

function MusicArtwork({ track, className = '' }) {
  return <Box className={`music-artwork ${className}`}>
    {track?.thumbnail ? <img src={track.thumbnail} alt="" /> : <HeadphonesRounded />}
  </Box>;
}

function MusicEngine({ source, playing, volume, onPlayingChange, onTime, onEnded, onError }) {
  const audioRef = useRef(null);
  const hlsRef = useRef(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !source) return undefined;
    audio.volume = volume;
    if (audio.canPlayType('application/vnd.apple.mpegurl')) audio.src = source;
    else if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hlsRef.current = hls;
      hls.loadSource(source);
      hls.attachMedia(audio);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) onError(data.details || 'Audio playback failed.');
      });
    } else onError('Audio playback is not supported by this browser.');
    return () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [source]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !source) return;
    audio.volume = volume;
    if (playing) audio.play().catch(() => onPlayingChange(false));
    else audio.pause();
  }, [playing, source, volume]);

  return <audio
    ref={audioRef}
    onPlay={() => onPlayingChange(true)}
    onPause={() => onPlayingChange(false)}
    onTimeUpdate={(event) => onTime(event.currentTarget.currentTime, event.currentTarget.duration)}
    onDurationChange={(event) => onTime(event.currentTarget.currentTime, event.currentTarget.duration)}
    onEnded={onEnded}
  />;
}

function TrackMenu({ anchor, track, liked, playlists, onClose, onLike, onPlaylist, onDownload }) {
  const [choosingList, setChoosingList] = useState(false);
  useEffect(() => setChoosingList(false), [track?.id]);
  return <Menu
    anchorEl={anchor}
    open={Boolean(anchor && track)}
    onClose={onClose}
    PaperProps={{ className: 'music-menu' }}
  >
    {!choosingList ? [
      <MenuItem key="like" onClick={() => { onLike(track); onClose(); }}>
        {liked ? <FavoriteRounded /> : <FavoriteBorderRounded />}{liked ? 'Remove from liked songs' : 'Like this song'}
      </MenuItem>,
      <MenuItem key="playlist" onClick={() => setChoosingList(true)}><PlaylistAddRounded />Add to playlist</MenuItem>,
      <MenuItem key="download" onClick={(event) => { onDownload(track, event.currentTarget); onClose(); }}><DownloadRounded />Download audio</MenuItem>
    ] : [
      <MenuItem key="back" onClick={() => setChoosingList(false)}><ArrowBackRounded />Choose a playlist</MenuItem>,
      ...playlists.map((playlist) => <MenuItem key={playlist.id} onClick={() => { onPlaylist(playlist.id, track); onClose(); }}><QueueMusicRounded />{playlist.name}</MenuItem>),
      !playlists.length && <MenuItem key="empty" disabled>Create a playlist in Library first</MenuItem>
    ]}
  </Menu>;
}

function TrackRow({ track, index, current, playing, liked, onPlay, onLike, onMenu }) {
  const active = current?.id === track.id;
  return <Box className={`music-track ${active ? 'active' : ''}`}>
    <button className="music-track-play" onClick={() => onPlay(track)} aria-label={`Play ${track.title}`}>
      <span className="track-number">{active && playing ? <span className="equalizer"><i /><i /><i /></span> : index + 1}</span>
      <MusicArtwork track={track} />
      <span className="track-overlay">{active && playing ? <PauseRounded /> : <PlayArrowRounded />}</span>
    </button>
    <Box className="music-track-copy">
      <Typography className="music-track-title" title={track.title} dir="auto">{track.title}</Typography>
      <Typography className="music-track-artist" dir="auto">{track.channel || 'Unknown artist'}</Typography>
    </Box>
    <span className="music-track-duration">{duration(track.duration)}</span>
    <IconButton className={`music-like ${liked ? 'liked' : ''}`} onClick={() => onLike(track)} aria-label="Like song">
      {liked ? <FavoriteRounded /> : <FavoriteBorderRounded />}
    </IconButton>
    <IconButton className="music-more" onClick={(event) => onMenu(track, event.currentTarget)} aria-label="More options"><MoreHorizRounded /></IconButton>
  </Box>;
}

export default function MusicSection({ api, onDownload, onNotice }) {
  const [view, setView] = useState('discover');
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [library, setLibrary] = useState(readLibrary);
  const [activePlaylist, setActivePlaylist] = useState(null);
  const [newPlaylistOpen, setNewPlaylistOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [menu, setMenu] = useState(null);
  const [queue, setQueue] = useState([]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [current, setCurrent] = useState(null);
  const [stream, setStream] = useState('');
  const [streamState, setStreamState] = useState('idle');
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [total, setTotal] = useState(0);
  const [volume] = useState(0.85);
  const requestRef = useRef(0);

  const persist = (next) => {
    setLibrary(next);
    localStorage.setItem(MUSIC_KEY, JSON.stringify(next));
  };

  const fetchTracks = async (term, target = 'results') => {
    setLoading(true);
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(term)}&page=1`);
      if (target === 'discover') setTracks(data.results || []);
      else setResults(data.results || []);
    } catch (error) { onNotice(error.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (!tracks.length) fetchTracks('music mix 2026', 'discover'); }, []);

  const startSearch = (term = query) => {
    const value = term.trim();
    if (!value) return;
    setQuery(value); setView('search'); fetchTracks(`${value} music`, 'results');
  };

  const prepare = async (track) => {
    const request = ++requestRef.current;
    setStream(''); setStreamState('preparing'); setPlaying(false);
    try {
      let state = await api(`/api/stream/${track.id}/prepare?quality=audio`, { method: 'POST' });
      while (!['done', 'error'].includes(state.status)) {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        if (requestRef.current !== request) return;
        state = await api(`/api/stream/${track.id}/status?quality=audio`);
      }
      if (requestRef.current !== request) return;
      if (state.status === 'error') throw new Error(state.error || 'Could not prepare this song.');
      setStream(`${state.url}?music=1`); setStreamState('ready'); setPlaying(true);
    } catch (error) { setStreamState('error'); onNotice(error.message); }
  };

  const playTrack = (track, source = null) => {
    if (current?.id === track.id && stream) { setPlaying((value) => !value); return; }
    const sourceList = source || (view === 'search' ? results : tracks);
    setQueue(sourceList.length ? sourceList : [track]);
    setCurrent(track); setElapsed(0); setTotal(track.duration || 0); prepare(track);
    const recent = [track, ...library.recent.filter((item) => item.id !== track.id)].slice(0, 12);
    persist({ ...library, recent });
  };

  const stepTrack = (direction) => {
    if (!current || !queue.length) return;
    const index = queue.findIndex((item) => item.id === current.id);
    const next = queue[(index + direction + queue.length) % queue.length];
    if (next) playTrack(next, queue);
  };

  const toggleLike = (track) => {
    const exists = library.liked.some((item) => item.id === track.id);
    persist({ ...library, liked: exists ? library.liked.filter((item) => item.id !== track.id) : [track, ...library.liked] });
  };

  const addToPlaylist = (id, track) => {
    persist({ ...library, playlists: library.playlists.map((playlist) => playlist.id === id && !playlist.tracks.some((item) => item.id === track.id)
      ? { ...playlist, tracks: [...playlist.tracks, track] }
      : playlist) });
    onNotice('Added to playlist.');
  };

  const createPlaylist = () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    persist({ ...library, playlists: [...library.playlists, { id: Date.now().toString(36), name, tracks: [] }] });
    setNewPlaylistName(''); setNewPlaylistOpen(false);
  };

  const visibleList = activePlaylist === 'liked'
    ? library.liked
    : activePlaylist
      ? library.playlists.find((item) => item.id === activePlaylist)?.tracks || []
      : [];
  const hero = tracks[0];
  const likedIds = useMemo(() => new Set(library.liked.map((item) => item.id)), [library.liked]);

  return <Box className="music-space">
    <Box className="music-ambient" />
    <header className="music-header">
      <Box className="music-wordmark"><span><HeadphonesRounded /></span><Box><small>YTGRAB</small><strong>Music</strong></Box></Box>
    </header>
    <nav className="music-tabs">
      {[['discover', 'Discover', HomeRounded], ['search', 'Search', SearchRounded], ['library', 'Library', LibraryMusicRounded]].map(([id, label, Icon]) =>
        <button key={id} className={view === id ? 'active' : ''} onClick={() => { setView(id); setActivePlaylist(null); }}><Icon /><span>{label}</span></button>)}
    </nav>

    <Box className="music-body">
      {view === 'discover' && <>
        <section className="music-welcome"><Box><Typography className="music-kicker">LISTEN YOUR WAY</Typography><Typography variant="h2">Sound for<br /><em>right now.</em></Typography><Typography>Music from everywhere, with no noise in the way.</Typography></Box>
          {hero && <button className="music-hero-card" onClick={() => playTrack(hero, tracks)}><MusicArtwork track={hero} /><span className="hero-shade" /><span className="hero-copy"><small>START HERE</small><strong dir="auto">{hero.title}</strong><span dir="auto">{hero.channel}</span></span><span className="hero-play"><PlayArrowRounded /></span></button>}
        </section>

        <section><Box className="music-section-head"><Box><small>SET THE MOOD</small><Typography variant="h5">Pick a frequency</Typography></Box></Box>
          <Box className="mood-row">{starterMoods.map(([label, term], index) => <button key={label} className={`mood-chip mood-${index + 1}`} onClick={() => startSearch(term)}><span>{label}</span><PlayArrowRounded /></button>)}</Box>
        </section>

        {library.recent.length > 0 && <section><Box className="music-section-head"><Box><small>BACK TO IT</small><Typography variant="h5">Recently played</Typography></Box></Box><Box className="album-rail">{library.recent.map((track) => <button className="album-card" key={track.id} onClick={() => playTrack(track, library.recent)}><MusicArtwork track={track} /><strong dir="auto">{track.title}</strong><span dir="auto">{track.channel}</span></button>)}</Box></section>}

        <section><Box className="music-section-head"><Box><small>CURATED FOR YOU</small><Typography variant="h5">Today’s rotation</Typography></Box><Button onClick={() => startSearch('new music releases')}>Refresh the mix</Button></Box>
          {loading && !tracks.length ? <Box className="music-loader"><CircularProgress /></Box> : <Box className="music-list">{tracks.slice(0, 12).map((track, index) => <TrackRow key={track.id} {...{ track, index, current, playing }} liked={likedIds.has(track.id)} onPlay={(item) => playTrack(item, tracks)} onLike={toggleLike} onMenu={(item, anchor) => setMenu({ track: item, anchor })} />)}</Box>}
        </section>
      </>}

      {view === 'search' && <section className="music-search-page">
        <Typography className="music-kicker">FIND YOUR NEXT FAVORITE</Typography><Typography variant="h3">Search the catalogue</Typography>
        <TextField className="music-search" fullWidth value={query} autoFocus onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && startSearch()} placeholder="Song, artist, album or mood" InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded /></InputAdornment>, endAdornment: <Button onClick={() => startSearch()}>Search</Button> }} />
        {!results.length && !loading && <Box className="music-search-empty"><SearchRounded /><Typography variant="h5">Anything you want to hear</Typography><Typography>Search by title, artist, genre—or just describe the mood.</Typography></Box>}
        {loading ? <Box className="music-loader"><CircularProgress /></Box> : results.length > 0 && <><Box className="music-section-head"><Typography variant="h5">Songs</Typography><span>{results.length} results</span></Box><Box className="music-list">{results.map((track, index) => <TrackRow key={track.id} {...{ track, index, current, playing }} liked={likedIds.has(track.id)} onPlay={(item) => playTrack(item, results)} onLike={toggleLike} onMenu={(item, anchor) => setMenu({ track: item, anchor })} />)}</Box></>}
      </section>}

      {view === 'library' && <section className="music-library-page">
        <Box className="library-hero"><Box><Typography className="music-kicker">YOUR COLLECTION</Typography><Typography variant="h3">Music worth keeping.</Typography><Typography>{library.liked.length} liked songs · {library.playlists.length} playlists</Typography></Box><Button variant="contained" startIcon={<AddRounded />} onClick={() => setNewPlaylistOpen(true)}>New playlist</Button></Box>
        {activePlaylist && <Button className="playlist-back" startIcon={<ArrowBackRounded />} onClick={() => setActivePlaylist(null)}>All playlists</Button>}
        {!activePlaylist && <Box className="playlist-grid">
          <button className="playlist-card liked-card" onClick={() => setActivePlaylist('liked')}><span className="playlist-collage">{library.liked.slice(0, 4).map((track) => <img key={track.id} src={track.thumbnail} alt="" />)}<FavoriteRounded /></span><strong>Liked songs</strong><small>{library.liked.length} songs</small></button>
          {library.playlists.map((playlist) => <button className="playlist-card" key={playlist.id} onClick={() => setActivePlaylist(playlist.id)}><span className="playlist-cover">{playlist.tracks[0] ? <img src={playlist.tracks[0].thumbnail} alt="" /> : <QueueMusicRounded />}</span><strong>{playlist.name}</strong><small>{playlist.tracks.length} songs</small></button>)}
          <button className="playlist-card new-playlist" onClick={() => setNewPlaylistOpen(true)}><span className="playlist-cover"><AddRounded /></span><strong>Make a playlist</strong><small>Start something new</small></button>
        </Box>}
        {activePlaylist && <><Box className="music-section-head"><Box><small>PLAYLIST</small><Typography variant="h4">{activePlaylist === 'liked' ? 'Liked songs' : library.playlists.find((item) => item.id === activePlaylist)?.name}</Typography></Box>{visibleList.length > 0 && <Button startIcon={<PlayArrowRounded />} variant="contained" onClick={() => playTrack(visibleList[0], visibleList)}>Play all</Button>}</Box>
          {visibleList.length ? <Box className="music-list">{visibleList.map((track, index) => <TrackRow key={track.id} {...{ track, index, current, playing }} liked={likedIds.has(track.id)} onPlay={(item) => playTrack(item, visibleList)} onLike={toggleLike} onMenu={(item, anchor) => setMenu({ track: item, anchor })} />)}</Box> : <Box className="music-search-empty"><QueueMusicRounded /><Typography variant="h5">This playlist is waiting</Typography><Typography>Find a song and use its menu to add it here.</Typography><Button onClick={() => setView('search')}>Find music</Button></Box>}
        </>}
      </section>}
    </Box>

    {current && <Box className="music-player">
      <MusicEngine source={stream} playing={playing} volume={volume} onPlayingChange={setPlaying} onTime={(value, max) => { setElapsed(value || 0); setTotal(Number.isFinite(max) ? max : current.duration || 0); }} onEnded={() => stepTrack(1)} onError={onNotice} />
      <MusicArtwork track={current} />
      <Box className="music-now"><strong dir="auto">{current.title}</strong><span dir="auto">{current.channel}</span></Box>
      <Box className="music-player-controls"><IconButton onClick={() => stepTrack(-1)}><SkipPreviousRounded /></IconButton><IconButton className="main-play" disabled={streamState === 'preparing'} onClick={() => stream && setPlaying((value) => !value)}>{streamState === 'preparing' ? <CircularProgress size={22} /> : playing ? <PauseRounded /> : <PlayArrowRounded />}</IconButton><IconButton onClick={() => stepTrack(1)}><SkipNextRounded /></IconButton></Box>
      <span className="music-time">{duration(elapsed)}</span><Slider className="music-progress" value={total ? Math.min(100, elapsed / total * 100) : 0} disabled /><span className="music-time end">{duration(total)}</span>
      <IconButton className={likedIds.has(current.id) ? 'liked' : ''} onClick={() => toggleLike(current)}>{likedIds.has(current.id) ? <FavoriteRounded /> : <FavoriteBorderRounded />}</IconButton>
      <IconButton onClick={() => setQueueOpen(true)}><QueueMusicRounded /></IconButton>
    </Box>}

    <Dialog open={queueOpen} onClose={() => setQueueOpen(false)} fullWidth maxWidth="sm" PaperProps={{ className: 'music-dialog' }}><DialogTitle>Up next</DialogTitle><IconButton className="music-dialog-close" onClick={() => setQueueOpen(false)}><CloseRounded /></IconButton><DialogContent><Box className="music-list">{queue.map((track, index) => <TrackRow key={`${track.id}-${index}`} {...{ track, index, current, playing }} liked={likedIds.has(track.id)} onPlay={(item) => playTrack(item, queue)} onLike={toggleLike} onMenu={(item, anchor) => setMenu({ track: item, anchor })} />)}</Box></DialogContent></Dialog>
    <Dialog open={newPlaylistOpen} onClose={() => setNewPlaylistOpen(false)} fullWidth maxWidth="xs" PaperProps={{ className: 'music-dialog' }}><DialogTitle>New playlist</DialogTitle><DialogContent><TextField autoFocus fullWidth label="Playlist name" value={newPlaylistName} onChange={(event) => setNewPlaylistName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && createPlaylist()} /></DialogContent><DialogActions><Button onClick={() => setNewPlaylistOpen(false)}>Cancel</Button><Button variant="contained" onClick={createPlaylist}>Create</Button></DialogActions></Dialog>
    <TrackMenu anchor={menu?.anchor} track={menu?.track} liked={likedIds.has(menu?.track?.id)} playlists={library.playlists} onClose={() => setMenu(null)} onLike={toggleLike} onPlaylist={addToPlaylist} onDownload={(track) => onDownload(track, null, 'audio')} />
  </Box>;
}
