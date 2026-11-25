import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AddRounded, ArrowBackRounded, ArrowDownwardRounded, ArrowUpwardRounded, DownloadRounded,
  EditRounded, FavoriteBorderRounded, FavoriteRounded, HeadphonesRounded, LibraryMusicRounded,
  MoreHorizRounded, PlayArrowRounded, PlaylistPlayRounded, SearchRounded, ShuffleRounded
} from '@mui/icons-material';
import {
  Avatar, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, Menu, MenuItem, Paper, TextField, Typography
} from '@mui/material';
import MusicPlayer from './music/MusicPlayer';
import useMusicPlayback from './music/useMusicPlayback';

const emptyLibrary = { liked: [], artists: [], playlists: [], recent: [] };
const moods = [
  ['Late night', 'late night R&B'], ['Focus', 'instrumental focus'],
  ['Persian', 'Persian music'], ['Electronic', 'electronic music'],
  ['Acoustic', 'acoustic songs']
];

function time(value) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}

function SongRow({ song, index, current, playing, liked, onPlay, onArtist, onLike, onDownload, onMenu, onMove, count }) {
  return <Box className={`music-song ${current?.id === song.id ? 'selected' : ''} ${onMove ? 'reorderable' : ''}`}>
    <button className="music-song-main" onClick={() => onPlay(song)} aria-label={`Play ${song.title}`}>
      <span className="music-song-number">{current?.id === song.id && playing ? '♫' : index + 1}</span>
      <img src={song.thumbnail} alt="" loading="lazy" />
      <span className="music-song-title" dir="auto">{song.title}</span>
    </button>
    <button className="music-song-artist" dir="auto" disabled={!song.artistId} onClick={() => onArtist(song.artistId, song.artist)}>{song.artist}</button>
    <span className="music-song-time">{time(song.duration)}</span>
    <IconButton size="small" color={liked ? 'primary' : 'default'} onClick={() => onLike(song)} aria-label={liked ? 'Unlike song' : 'Like song'}>{liked ? <FavoriteRounded /> : <FavoriteBorderRounded />}</IconButton>
    <IconButton size="small" onClick={() => onDownload(song)} aria-label="Download best audio" title="Download best audio"><DownloadRounded /></IconButton>
    <IconButton size="small" onClick={(event) => onMenu(song, event.currentTarget)} aria-label="Add to playlist"><MoreHorizRounded /></IconButton>
    {onMove && <Box className="music-song-order"><IconButton size="small" disabled={index === 0} onClick={() => onMove(index, index - 1)} aria-label={`Move ${song.title} up`}><ArrowUpwardRounded /></IconButton><IconButton size="small" disabled={index === count - 1} onClick={() => onMove(index, index + 1)} aria-label={`Move ${song.title} down`}><ArrowDownwardRounded /></IconButton></Box>}
  </Box>;
}

export default function MusicSection({ api, active, onDownload, onNotice }) {
  const [view, setView] = useState('home');
  const [library, setLibrary] = useState(emptyLibrary);
  const libraryRef = useRef(emptyLibrary);
  const saveChainRef = useRef(Promise.resolve());
  const [loaded, setLoaded] = useState(false);
  const [homeLoaded, setHomeLoaded] = useState(false);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeSongs, setHomeSongs] = useState([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ songs: [], artists: [], albums: [] });
  const [searching, setSearching] = useState(false);
  const [artistPage, setArtistPage] = useState(null);
  const [artistLoading, setArtistLoading] = useState(false);
  const [albumPage, setAlbumPage] = useState(null);
  const [albumLoading, setAlbumLoading] = useState(false);
  const [selectedList, setSelectedList] = useState(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [pendingPlaylistSong, setPendingPlaylistSong] = useState(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [menu, setMenu] = useState(null);
  useEffect(() => {
    if (!active || loaded) return;
    api('/api/music/library').then(({ library: saved }) => {
      const next = { ...emptyLibrary, ...saved };
      libraryRef.current = next;
      setLibrary(next);
      setLoaded(true);
    }).catch((error) => { onNotice(error.message); setLoaded(true); });
  }, [active, loaded]);

  useEffect(() => {
    if (!active || !loaded || homeLoaded) return;
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
    saveChainRef.current = saveChainRef.current.catch(() => {}).then(() =>
      api('/api/music/library', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ library: next }) })
    ).catch((error) => onNotice(`Could not save music library: ${error.message}`));
  };

  const search = async (term = query) => {
    const value = term.trim();
    if (!value) return;
    setQuery(value);
    setView('search');
    setSearching(true);
    setResults({ songs: [], artists: [], albums: [] });
    const attempts = await Promise.allSettled(['songs', 'artists', 'albums'].map((type) =>
      api(`/api/music/search?q=${encodeURIComponent(value)}&type=${type}`).then((data) => {
        setResults((old) => ({ ...old, [type]: data.items || [] }));
        return data;
      })
    ));
    if (attempts.every((item) => item.status === 'rejected')) onNotice(attempts[0].reason.message);
    setSearching(false);
  };

  const openArtist = async (id, fallbackName = '') => {
    if (!id) return;
    setView('artist');
    setArtistPage({ artist: { id, name: fallbackName || 'Artist', image: `/api/channel-avatar/${id}` }, songs: [] });
    setArtistLoading(true);
    try { setArtistPage(await api(`/api/music/artists/${encodeURIComponent(id)}`)); }
    catch (error) { onNotice(error.message); }
    finally { setArtistLoading(false); }
  };

  const openAlbum = async (album) => {
    setView('album');
    setAlbumPage({ album, songs: [] });
    setAlbumLoading(true);
    try {
      const data = await api(`/api/music/albums/${encodeURIComponent(album.id)}`);
      setAlbumPage({ ...data, songs: data.songs.map((song) => ({ ...song, album: song.album || data.album.title })) });
    }
    catch (error) { onNotice(error.message); }
    finally { setAlbumLoading(false); }
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

  const {
    queue, current, streamState, playing, setPlaying, elapsed, setElapsed,
    duration, setDuration, shuffle, repeat, rate, setRate,
    volume, setVolume, muted, setMuted, sleep, lyrics, lyricsLoading, lyricsOffsets,
    setLyricsOffsets, audioRef, prepare, playSong, playCollection, toggleShuffle, cycleRepeat,
    playQueue, step, moveQueue, removeQueue, showLyrics, seek, closePlayer,
    setSleepTimer
  } = useMusicPlayback({ api, active, onNotice, onPlayed: (song) => updateLibrary((old) => ({
    ...old, recent: [song, ...old.recent.filter((item) => item.id !== song.id)].slice(0, 30)
  })) });

  const createPlaylist = () => {
    const name = playlistName.trim();
    if (!name) return;
    updateLibrary((old) => ({ ...old, playlists: [...old.playlists, { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, name, tracks: pendingPlaylistSong ? [pendingPlaylistSong] : [] }] }));
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
    updateLibrary((old) => ({ ...old, playlists: old.playlists.map((list) => {
      if (list.id !== selectedList || to < 0 || to >= list.tracks.length) return list;
      const tracks = [...list.tracks];
      tracks.splice(to, 0, tracks.splice(from, 1)[0]);
      return { ...list, tracks };
    }) }));
  };


  const currentList = selectedList === 'liked' ? library.liked : library.playlists.find((list) => list.id === selectedList)?.tracks || [];
  const row = (song, index, source, reorder = false) => <SongRow key={song.id} {...{ song, index, current, playing }}
    liked={library.liked.some((item) => item.id === song.id)} onPlay={(item) => playSong(item, source)}
    onArtist={openArtist} onLike={toggleLike} onDownload={onDownload}
    onMenu={(item, anchor) => setMenu({ song: item, anchor })}
    onMove={reorder ? movePlaylistTrack : undefined} count={source.length} />;

  return <Box className="music-section">
    <Box className="music-heading"><Box><Typography variant="overline" color="primary">YTGRAB MUSIC</Typography><Typography variant="h4" fontWeight={800}>Your music, your space.</Typography></Box><HeadphonesRounded className="music-heading-icon" /></Box>
    <Box className="music-subnav">
      {[['home', 'Discover'], ['search', 'Search'], ['library', 'Library']].map(([id, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => { setView(id); setSelectedList(null); }}>{label}</button>)}
    </Box>

    {view === 'home' && <>
      <Box className="music-feature"><Box><Typography variant="overline">LISTEN YOUR WAY</Typography><Typography variant="h3" fontWeight={800}>Find your next favorite.</Typography><Typography color="text.secondary">Songs, artists, and sounds for every mood.</Typography><Button variant="contained" startIcon={<SearchRounded />} onClick={() => setView('search')}>Explore music</Button></Box><HeadphonesRounded /></Box>
      {!!library.recent.length && <Box className="music-block"><Typography variant="h5" fontWeight={700}>Listen again</Typography><Box className="music-art-grid">{library.recent.slice(0, 6).map((song) => <button key={song.id} className="music-art-card" onClick={() => playSong(song, library.recent)}><img src={song.thumbnail} alt="" /><strong dir="auto">{song.title}</strong><span dir="auto">{song.artist}</span></button>)}</Box></Box>}
      {!!library.artists.length && <Box className="music-block"><Typography variant="h5" fontWeight={700}>Artists you follow</Typography><Box className="music-artists">{library.artists.map((artist) => <button key={artist.id} onClick={() => openArtist(artist.id, artist.name)}><Avatar src={artist.image} /><span dir="auto">{artist.name}</span></button>)}</Box></Box>}
      <Box className="music-block"><Typography variant="h5" fontWeight={700}>Set the mood</Typography><Box className="music-moods">{moods.map(([name, term]) => <button key={name} onClick={() => search(term)}>{name}<PlayArrowRounded fontSize="small" /></button>)}</Box></Box>
      <Box className="music-block"><Typography variant="h5" fontWeight={700}>Start listening</Typography>{homeSongs.length ? <Box className="music-song-list">{homeSongs.slice(0, 12).map((song, index) => row(song, index, homeSongs))}</Box> : <Box className="music-loading">{homeLoading ? <CircularProgress size={24} /> : 'Search for music to fill this space.'}</Box>}</Box>
    </>}

    {view === 'search' && <Box className="music-block music-search-view">
      <Typography variant="h5" fontWeight={700}>Search music</Typography>
      <TextField fullWidth value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && search()} placeholder="Song or artist" inputProps={{ dir: 'auto' }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded /></InputAdornment>, endAdornment: <Button onClick={() => search()} disabled={searching}>Search</Button> }} />
      {searching && <Box className="music-loading"><CircularProgress size={24} /></Box>}
      <>
        {!!results.artists.length && <><Typography variant="h6" fontWeight={700}>Artists</Typography><Box className="music-artists">{results.artists.map((artist) => <button key={artist.id} onClick={() => openArtist(artist.id, artist.name)}><Avatar src={artist.image} /><span dir="auto">{artist.name}</span></button>)}</Box></>}
        {!!results.albums.length && <><Typography variant="h6" fontWeight={700}>Albums</Typography><Box className="music-art-grid">{results.albums.map((album) => <button key={album.id} className="music-art-card" onClick={() => openAlbum(album)}>{album.thumbnail ? <img src={album.thumbnail} alt="" /> : <Box className="music-album-placeholder"><LibraryMusicRounded /></Box>}<strong dir="auto">{album.title}</strong><span dir="auto">{album.artist}</span></button>)}</Box></>}
        {!!results.songs.length && <><Typography variant="h6" fontWeight={700}>Songs</Typography><Box className="music-song-list">{results.songs.map((song, index) => row(song, index, results.songs))}</Box></>}
        {!searching && !results.artists.length && !results.albums.length && !results.songs.length && <Box className="music-empty"><SearchRounded /><Typography>Search for a song or artist to get started.</Typography></Box>}
      </>
    </Box>}

    {view === 'artist' && artistPage && <>
      <Button startIcon={<ArrowBackRounded />} onClick={() => setView('search')}>Back to search</Button>
      <Paper className="music-artist-hero" elevation={0} style={artistPage.artist.banner ? { '--artist-background': `linear-gradient(90deg, rgba(16,12,22,.94), rgba(16,12,22,.7)), url("${artistPage.artist.banner}")` } : undefined}><Avatar src={artistPage.artist.image}>{artistPage.artist.name[0]}</Avatar><Box><Typography variant="overline" color="primary">ARTIST</Typography><Typography variant="h3" fontWeight={800} dir="auto">{artistPage.artist.name}</Typography>{artistPage.artist.followers != null && <Typography color="text.secondary">{artistPage.artist.followers.toLocaleString()} followers</Typography>}<Button variant={library.artists.some((item) => item.id === artistPage.artist.id) ? 'outlined' : 'contained'} onClick={() => toggleFollow(artistPage.artist)}>{library.artists.some((item) => item.id === artistPage.artist.id) ? 'Following' : 'Follow artist'}</Button></Box></Paper>
      {artistPage.artist.description && <Typography className="music-artist-description" dir="auto">{artistPage.artist.description}</Typography>}
      <Box className="music-block"><Typography variant="h5" fontWeight={700}>Songs</Typography>{artistLoading ? <Box className="music-loading"><CircularProgress /></Box> : artistPage.songs.length ? <Box className="music-song-list">{artistPage.songs.map((song, index) => row(song, index, artistPage.songs))}</Box> : <Box className="music-empty">No songs were available for this artist.</Box>}</Box>
    </>}

    {view === 'album' && albumPage && <>
      <Button startIcon={<ArrowBackRounded />} onClick={() => setView('search')}>Back to search</Button>
      <Paper className="music-artist-hero music-album-hero" elevation={0}>{albumPage.album.thumbnail ? <img src={albumPage.album.thumbnail} alt="" /> : <Box className="music-album-placeholder"><LibraryMusicRounded /></Box>}<Box><Typography variant="overline" color="primary">ALBUM</Typography><Typography variant="h3" fontWeight={800} dir="auto">{albumPage.album.title}</Typography><Typography color="text.secondary" dir="auto">{albumPage.album.artist} · {albumPage.songs.length} songs</Typography>{!!albumPage.songs.length && <Box className="music-collection-actions"><Button variant="contained" startIcon={<PlayArrowRounded />} onClick={() => playCollection(albumPage.songs)}>Play album</Button><Button variant="outlined" startIcon={<ShuffleRounded />} onClick={() => playCollection(albumPage.songs, true)}>Shuffle</Button></Box>}</Box></Paper>
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
          {library.playlists.map((list) => <button key={list.id} onClick={() => setSelectedList(list.id)}>
            {list.tracks[0]?.thumbnail ? <img src={list.tracks[0].thumbnail} alt="" /> : <LibraryMusicRounded />}
            <strong dir="auto">{list.name}</strong><small>{list.tracks.length} songs</small>
          </button>)}
        </Box>
        {!!library.artists.length && <><Typography variant="h6" fontWeight={700}>Following</Typography><Box className="music-artists">{library.artists.map((artist) => <button key={artist.id} onClick={() => openArtist(artist.id, artist.name)}><Avatar src={artist.image} /><span dir="auto">{artist.name}</span></button>)}</Box></>}
      </>}
      {selectedList && <>
        <Button startIcon={<ArrowBackRounded />} onClick={() => setSelectedList(null)}>All music</Button>
        <Box className="music-library-heading music-playlist-title">
          <Box><Typography variant="h5" fontWeight={800} dir="auto">{selectedList === 'liked' ? 'Liked songs' : library.playlists.find((list) => list.id === selectedList)?.name}</Typography><Typography color="text.secondary">{currentList.length} songs · your order</Typography></Box>
          <Box className="music-playlist-actions">
            <Button variant="contained" startIcon={<PlayArrowRounded />} disabled={!currentList.length} onClick={() => playCollection(currentList)}>Play</Button>
            <Button variant="outlined" startIcon={<ShuffleRounded />} disabled={!currentList.length} onClick={() => playCollection(currentList, true)}>Shuffle</Button>
            {selectedList !== 'liked' && <><IconButton aria-label="Rename playlist" title="Rename playlist" onClick={() => { setRenameName(library.playlists.find((list) => list.id === selectedList)?.name || ''); setRenameOpen(true); }}><EditRounded /></IconButton><Button color="error" onClick={() => deletePlaylist(selectedList)}>Delete</Button></>}
          </Box>
        </Box>
        {currentList.length ? <Box className="music-song-list">{currentList.map((song, index) => row(song, index, currentList, selectedList !== 'liked'))}</Box> : <Box className="music-empty">No songs here yet. Find one and add it.</Box>}
      </>}
    </Box>}

    {createPortal(<MusicPlayer
      current={current} queue={queue} audioRef={audioRef} streamState={streamState} playing={playing}
      elapsed={elapsed} duration={duration} shuffle={shuffle} repeat={repeat} rate={rate} volume={volume} muted={muted} sleep={sleep}
      lyrics={lyrics} lyricsLoading={lyricsLoading} lyricsOffset={lyricsOffsets[current?.id] || 0}
      liked={Boolean(current && library.liked.some((item) => item.id === current.id))}
      onTimeUpdate={(event) => { setElapsed(event.currentTarget.currentTime); if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration); }}
      onEnded={() => step(1, true)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onToggle={() => streamState === 'error' && current ? prepare(current) : setPlaying((value) => !value)} onNext={() => step(1)} onPrevious={() => step(-1)} onSeek={seek}
      onShuffle={toggleShuffle} onRepeat={cycleRepeat}
      onRate={setRate} onVolume={(value) => { setVolume(value); setMuted(false); }} onMute={() => setMuted((value) => !value)} onSleep={setSleepTimer}
      onLyrics={showLyrics} onLyricsOffset={(value) => current && setLyricsOffsets((old) => ({ ...old, [current.id]: Math.max(-60, Math.min(60, value)) }))}
      onLike={() => current && toggleLike(current)} onDownload={onDownload} onArtist={openArtist}
      onPlayQueue={playQueue} onMoveQueue={moveQueue} onRemoveQueue={removeQueue} onClose={closePlayer}
    />, document.body)}

    <Menu anchorEl={menu?.anchor || null} open={Boolean(menu)} onClose={() => setMenu(null)}>
      {view === 'library' && selectedList && selectedList !== 'liked' && <MenuItem onClick={() => removeFromPlaylist(selectedList, menu.song)}>Remove from this playlist</MenuItem>}
      {library.playlists.map((list) => <MenuItem key={list.id} onClick={() => addToPlaylist(list.id, menu.song)}>Add to {list.name}</MenuItem>)}
      <MenuItem onClick={() => { setPendingPlaylistSong(menu.song); setMenu(null); setPlaylistOpen(true); }}>New playlist with this song</MenuItem>
    </Menu>
    <Dialog open={playlistOpen} onClose={() => { setPlaylistOpen(false); setPendingPlaylistSong(null); }} fullWidth maxWidth="xs"><DialogTitle>New playlist</DialogTitle><DialogContent><TextField autoFocus fullWidth label="Playlist name" value={playlistName} onChange={(event) => setPlaylistName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && createPlaylist()} inputProps={{ maxLength: 100 }} /></DialogContent><DialogActions><Button onClick={() => { setPlaylistOpen(false); setPendingPlaylistSong(null); }}>Cancel</Button><Button variant="contained" onClick={createPlaylist}>Create</Button></DialogActions></Dialog>
    <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} fullWidth maxWidth="xs"><DialogTitle>Rename playlist</DialogTitle><DialogContent><TextField autoFocus fullWidth label="Playlist name" value={renameName} onChange={(event) => setRenameName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && renamePlaylist()} inputProps={{ maxLength: 100 }} /></DialogContent><DialogActions><Button onClick={() => setRenameOpen(false)}>Cancel</Button><Button variant="contained" onClick={renamePlaylist}>Save</Button></DialogActions></Dialog>

  </Box>;
}
