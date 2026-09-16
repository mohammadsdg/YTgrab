import { useEffect, useRef, useState } from 'react';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import {
  Alert, Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogContent,
  IconButton, InputAdornment, Paper, Snackbar, Stack, Switch, TextField, Typography
} from '@mui/material';
import {
  AddRounded, ArrowBackRounded, CheckRounded, CloseRounded, DarkModeRounded, DeleteOutlineRounded, DownloadRounded, ExpandMoreRounded, ExploreRounded,
  GitHub,
  HomeRounded, LogoutRounded, PersonAddRounded, PlayArrowRounded, SearchRounded,
  SettingsRounded, SubscriptionsRounded, UploadRounded, VideoLibraryRounded, WallpaperRounded
} from '@mui/icons-material';

const navItems = [
  { id: 'home', label: 'Home', icon: HomeRounded },
  { id: 'search', label: 'Explore', icon: ExploreRounded },
  { id: 'library', label: 'Library', icon: VideoLibraryRounded },
  { id: 'settings', label: 'Settings', icon: SettingsRounded }
];

async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function formatDuration(value) {
  if (!Number.isFinite(value)) return '';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function textDirection(value) {
  return /[\u0590-\u08ff]/.test(String(value || '')) ? 'rtl' : 'ltr';
}

function videoIdFromInput(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\.|^m\./g, '');
    if (host === 'youtu.be') return url.pathname.split('/')[1] || null;
    if (host === 'youtube.com') {
      if (url.pathname === '/watch') return url.searchParams.get('v');
      return url.pathname.match(/^\/(shorts|embed|live)\/([^/?]+)/)?.[2] || null;
    }
  } catch { /* search text */ }
  return null;
}

function HlsPlayer({ src, onError }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return undefined;
    let hls;
    let cancelled = false;
    const player = new Plyr(video, {
      controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'fullscreen'],
      settings: ['speed'],
      seekTime: 10
    });

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.play().catch(() => {});
      return () => { player.destroy(); video.removeAttribute('src'); video.load(); };
    }

    import('hls.js').then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        onError('HLS playback is not supported by this browser.');
        return;
      }
      hls = new Hls({ enableWorker: true, lowLatencyMode: false, startPosition: 0 });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.currentTime = 0;
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          onError(`${data.type}: ${data.details}`);
          hls.destroy();
        }
      });
    }).catch((error) => onError(error.message));
    return () => {
      cancelled = true;
      if (hls) hls.destroy();
      player.destroy();
    };
  }, [src]);

  return <video ref={videoRef} className="video-player" controls playsInline onError={(event) => {
    const mediaError = event.currentTarget.error;
    if (mediaError) onError(mediaError.message || `media error code ${mediaError.code}`);
  }} />;
}

function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      onLogin();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <Box className="login-page">
    <Paper className="login-card" elevation={0} component="form" onSubmit={submit}>
      <img className="login-mark" src="/ytgrab-mark.png" alt="" />
      <Box className="login-heading"><Typography variant="h4" fontWeight={700}>YTgrab</Typography><Typography color="text.secondary">Your place.</Typography></Box>
      <TextField fullWidth type="password" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
      {error && <Alert severity="error">{error}</Alert>}
      <Button size="large" variant="contained" type="submit" disabled={busy}>{busy ? 'Opening…' : 'Come in'}</Button>
    </Paper>
  </Box>;
}

function VideoCard({ video, subscriptions, onFollow, onPlay, onDownload, onChannel }) {
  const following = subscriptions.some((item) => item.id === video.channelId);
  return <Paper className="video-card" elevation={0}>
    <Box className="thumb-wrap" onClick={() => onPlay(video)}>
      <img src={video.thumbnail || `/api/thumbnail/${video.id}`} alt="" loading="lazy" />
      <Box className="play-bubble"><PlayArrowRounded /></Box>
      {video.duration != null && <span className="duration">{formatDuration(video.duration)}</span>}
    </Box>
    <Box className="video-copy">
      <Typography className="video-title" dir={textDirection(video.title)}>{video.title}</Typography>
      <Stack direction="row" alignItems="center" spacing={1} mt={0.75}>
        <Avatar className="tiny-avatar" src={video.channelAvatar || (video.channelId ? `/api/channel-avatar/${video.channelId}` : undefined)}>{(video.channel || '?')[0]}</Avatar>
        <button dir={textDirection(video.channel)} className="channel-link" onClick={() => video.channelId && onChannel(video.channelId)}>{video.channel || 'YouTube'}</button>
      </Stack>
      <Stack direction="row" spacing={1} mt={1.4}>
        {video.channelId && <Button className="soft-button" size="small" startIcon={following ? <CheckRounded /> : <PersonAddRounded />} onClick={() => onFollow(video)}>
          {following ? 'Following' : 'Follow'}
        </Button>}
        <IconButton className="round-action" size="small" onClick={() => onDownload(video)}><DownloadRounded fontSize="small" /></IconButton>
      </Stack>
    </Box>
  </Paper>;
}

function EmptyState({ icon: Icon, title, text, action }) {
  return <Box className="empty-state">
    <Box className="empty-icon"><Icon /></Box>
    <Typography variant="h6" fontWeight={750}>{title}</Typography>
    <Typography color="text.secondary" maxWidth={360}>{text}</Typography>
    {action}
  </Box>;
}

export default function App({ mode, setMode }) {
  const [auth, setAuth] = useState(null);
  const [tab, setTab] = useState('home');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searchPage, setSearchPage] = useState(1);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feed, setFeed] = useState([]);
  const [feedPage, setFeedPage] = useState(1);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [subscriptions, setSubscriptions] = useState([]);
  const [history, setHistory] = useState([]);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [player, setPlayer] = useState(null);
  const [playerStatus, setPlayerStatus] = useState(null);
  const [playerQuality, setPlayerQuality] = useState('720');
  const playerRequestRef = useRef(0);
  const [downloadVideo, setDownloadVideo] = useState(null);
  const [downloadState, setDownloadState] = useState(null);
  const [channelPage, setChannelPage] = useState(null);
  const [channelBusy, setChannelBusy] = useState(false);
  const [channelPageNumber, setChannelPageNumber] = useState(1);
  const [channelHasMore, setChannelHasMore] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const loadMoreRef = useRef(null);

  const loadPersonalData = async () => {
    const [subs, watched, stored] = await Promise.all([
      api('/api/subscriptions'), api('/api/history'), api('/api/files')
    ]);
    setSubscriptions(subs.subscriptions); setHistory(watched.history); setFiles(stored.files);
    if (subs.subscriptions.length) {
      try {
        const data = await api('/api/feed?page=1');
        setFeed(data.videos); setFeedPage(1); setFeedHasMore(data.hasMore);
      } catch (err) { setNotice(err.message); }
    }
  };

  useEffect(() => {
    api('/api/session').then(() => { setAuth(true); loadPersonalData(); }).catch(() => setAuth(false));
  }, []);

  const search = async () => {
    const value = query.trim();
    if (!value) return;
    const directId = videoIdFromInput(value);
    if (directId) {
      const direct = { id: directId, title: 'YouTube video', channel: '', channelId: '', thumbnail: `/api/thumbnail/${directId}` };
      setResults([direct]); setSearchPage(1); setSearchHasMore(false);
      return;
    }
    setBusy(true);
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(value)}&page=1`);
      setResults(data.results); setSearchPage(1); setSearchHasMore(data.hasMore);
    }
    catch (err) { setNotice(err.message); }
    finally { setBusy(false); }
  };

  const toggleFollow = async (video) => {
    if (!video.channelId) return;
    const existing = subscriptions.some((item) => item.id === video.channelId);
    try {
      const data = existing
        ? await api(`/api/subscriptions/${encodeURIComponent(video.channelId)}`, { method: 'DELETE' })
        : await api('/api/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: video.channelId, name: video.channel, avatar: video.channelAvatar || `/api/channel-avatar/${video.channelId}` }) });
      setSubscriptions(data.subscriptions);
      setNotice(existing ? `Unfollowed ${video.channel}` : `Following ${video.channel}`);
    } catch (err) { setNotice(err.message); }
  };

  const pollStream = (videoId, quality, requestId) => {
    const check = async () => {
      try {
        const state = await api(`/api/stream/${videoId}/status?quality=${quality}`);
        if (playerRequestRef.current !== requestId) return;
        setPlayerStatus({ id: videoId, ...state });
        if (!['done', 'error'].includes(state.status)) setTimeout(check, 1500);
      } catch (error) {
        if (playerRequestRef.current !== requestId) return;
        setPlayerStatus({ id: videoId, status: 'error', error: error.message });
      }
    };
    setTimeout(check, 800);
  };

  const preparePlayback = async (video, quality) => {
    const requestId = ++playerRequestRef.current;
    setPlayerStatus({ id: video.id, status: 'starting', progress: 0 });
    try {
      const state = await api(`/api/stream/${video.id}/prepare?quality=${quality}`, { method: 'POST' });
      if (playerRequestRef.current !== requestId) return;
      setPlayerStatus({ id: video.id, ...state });
      if (!['done', 'error'].includes(state.status)) pollStream(video.id, quality, requestId);
    } catch (error) {
      if (playerRequestRef.current !== requestId) return;
      setPlayerStatus({ id: video.id, status: 'error', error: error.message });
    }
  };

  const play = async (video) => {
    setPlayer(video);
    setPlayerQuality('720');
    setHistory((current) => [{ ...video, watchedAt: Date.now() }, ...current.filter((item) => item.id !== video.id)].slice(0, 100));
    api('/api/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(video) }).catch(() => {});
    preparePlayback(video, '720');
  };

  const closePlayer = () => {
    ++playerRequestRef.current;
    setPlayer(null);
    setPlayerStatus(null);
  };

  const openChannel = async (channelId) => {
    if (!channelId) return;
    setChannelBusy(true);
    setChannelPage({ channel: null, videos: [] });
    try {
      const data = await api(`/api/channels/${encodeURIComponent(channelId)}?page=1`);
      setChannelPage(data); setChannelPageNumber(1); setChannelHasMore(data.hasMore);
    }
    catch (err) { setChannelPage(null); setNotice(err.message); }
    finally { setChannelBusy(false); }
  };

  const startDownload = async (quality) => {
    const video = downloadVideo;
    setDownloadState({ status: 'starting', progress: 0 });
    try {
      const started = await api('/api/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${video.id}`, quality, video }) });
      const timer = setInterval(async () => {
        try {
          const state = await api(`/api/status/${started.id}`);
          setDownloadState(state);
          if (state.status === 'done' || state.status === 'error') {
            clearInterval(timer);
            if (state.status === 'done') setFiles((await api('/api/files')).files);
          }
        } catch (err) { clearInterval(timer); setDownloadState({ status: 'error', error: err.message }); }
      }, 1500);
    } catch (err) { setDownloadState({ status: 'error', error: err.message }); }
  };

  const deleteFile = async (file) => {
    try {
      await api(`/api/files/${encodeURIComponent(file.name)}`, { method: 'DELETE' });
      setFiles((current) => current.filter((item) => item.name !== file.name));
      setNotice('Download deleted.');
    } catch (error) { setNotice(error.message); }
  };

  const loadMore = async () => {
    if (loadingMore) return;
    if (channelPage?.channel && channelHasMore) {
      setLoadingMore(true);
      try {
        const next = channelPageNumber + 1;
        const data = await api(`/api/channels/${encodeURIComponent(channelPage.channel.id)}?page=${next}`);
        setChannelPage((current) => ({ ...current, videos: [...current.videos, ...data.videos] }));
        setChannelPageNumber(next); setChannelHasMore(data.hasMore);
      } catch (error) { setNotice(error.message); }
      finally { setLoadingMore(false); }
      return;
    }
    if (!channelPage && tab === 'search' && searchHasMore && query.trim()) {
      setLoadingMore(true);
      try {
        const next = searchPage + 1;
        const data = await api(`/api/search?q=${encodeURIComponent(query.trim())}&page=${next}`);
        setResults((current) => [...current, ...data.results]);
        setSearchPage(next); setSearchHasMore(data.hasMore);
      } catch (error) { setNotice(error.message); }
      finally { setLoadingMore(false); }
      return;
    }
    if (!channelPage && tab === 'home' && feedHasMore) {
      setLoadingMore(true);
      try {
        const next = feedPage + 1;
        const data = await api(`/api/feed?page=${next}`);
        setFeed((current) => [...current, ...data.videos.filter((video) => !current.some((item) => item.id === video.id))]);
        setFeedPage(next); setFeedHasMore(data.hasMore);
      } catch (error) { setNotice(error.message); }
      finally { setLoadingMore(false); }
    }
  };

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) loadMore(); }, { rootMargin: '500px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [tab, channelPage?.channel?.id, channelPageNumber, channelHasMore, searchPage, searchHasMore, feedPage, feedHasMore, loadingMore, query]);

  const uploadBackground = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setNotice('Choose a JPEG, PNG, or WebP image.');
      return;
    }
    setBackgroundBusy(true);
    try {
      const response = await fetch('/api/background', {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not change the background.');
      document.documentElement.style.setProperty('--app-background', `url("${data.url}")`);
      setNotice('Background updated.');
    } catch (error) { setNotice(error.message); }
    finally { setBackgroundBusy(false); }
  };

  const resetBackground = async () => {
    setBackgroundBusy(true);
    try {
      const data = await api('/api/background', { method: 'DELETE' });
      document.documentElement.style.setProperty('--app-background', `url("${data.url}")`);
      setNotice('Default background restored.');
    } catch (error) { setNotice(error.message); }
    finally { setBackgroundBusy(false); }
  };

  if (auth === null) return <Box className="splash"><CircularProgress /></Box>;
  if (!auth) return <Login onLogin={() => { setAuth(true); loadPersonalData(); }} />;

  return <Box className="app-shell">
    <Box component="header" className="topbar">
      <img className="brand-mark small" src="/ytgrab-mark.png" alt="YTgrab" />
      <IconButton className="github-button" component="a" href="https://github.com/mohammadsdg/Ytgrab" target="_blank" rel="noreferrer" aria-label="Open YTgrab on GitHub"><GitHub /></IconButton>
    </Box>

    <Box component="main" className="main-content">
      {channelPage ? <>
        <Button className="back-button" startIcon={<ArrowBackRounded />} onClick={() => setChannelPage(null)}>Back</Button>
        {channelBusy || !channelPage.channel ? <Box className="channel-loading"><CircularProgress /></Box> : <>
          {channelPage.channel.banner && <img className="channel-banner" src={channelPage.channel.banner} alt="" />}
          <Box className="channel-header" dir={textDirection(channelPage.channel.name)}>
            <Box className="channel-identity">
              <Avatar className="channel-avatar" src={channelPage.channel.avatar || undefined}>{channelPage.channel.name[0]}</Avatar>
              <Box className="channel-heading">
                <Typography variant="h4" fontWeight={700} dir={textDirection(channelPage.channel.name)}>{channelPage.channel.name}</Typography>
                {channelPage.channel.handle && <Typography dir="ltr" color="text.secondary">{channelPage.channel.handle}</Typography>}
                <Typography color="text.secondary">{channelPage.channel.followers ? `${channelPage.channel.followers.toLocaleString()} followers · ` : ''}{channelPage.videos.length} recent videos</Typography>
              </Box>
            </Box>
            <Button variant={subscriptions.some((item) => item.id === channelPage.channel.id) ? 'outlined' : 'contained'} onClick={() => toggleFollow({ channelId: channelPage.channel.id, channel: channelPage.channel.name })}>
              {subscriptions.some((item) => item.id === channelPage.channel.id) ? 'Following' : 'Follow'}
            </Button>
            {channelPage.channel.description && <Typography dir={textDirection(channelPage.channel.description)} className="channel-description" color="text.secondary">{channelPage.channel.description}</Typography>}
          </Box>
          <Typography className="section-title">Videos</Typography>
          <Box className="video-grid">{channelPage.videos.map((video) => <VideoCard key={video.id} video={video} subscriptions={subscriptions} onFollow={toggleFollow} onPlay={play} onDownload={setDownloadVideo} onChannel={openChannel} />)}</Box>
          <Box ref={loadMoreRef} className="load-more-sentinel">{loadingMore && <CircularProgress size={26} />}</Box>
        </>}
      </> : <>
      {tab === 'home' && <>
        <Box className="page-heading"><Typography variant="h4" fontWeight={700}>Latest</Typography><Typography color="text.secondary">New videos from channels you follow.</Typography></Box>
        {feed.length ? <Box className="video-grid">{feed.map((video) => <VideoCard key={video.id} video={video} subscriptions={subscriptions} onFollow={toggleFollow} onPlay={play} onDownload={setDownloadVideo} onChannel={openChannel} />)}</Box>
          : <EmptyState icon={SubscriptionsRounded} title="Your feed starts with people" text="Follow a few channels and their newest videos will show up here." action={<Button onClick={() => setTab('search')} startIcon={<AddRounded />}>Find channels</Button>} />}
        {feed.length > 0 && <Box ref={loadMoreRef} className="load-more-sentinel">{loadingMore && <CircularProgress size={26} />}</Box>}
      </>}

      {tab === 'search' && <>
        <Box className="search-hero">
          <Typography variant="h4" fontWeight={700}>Search</Typography>
          <Typography color="text.secondary">Find a video or paste a YouTube link.</Typography>
          <TextField className="big-search" fullWidth value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="Linux, cooking, a video link…" inputProps={{ dir: 'auto' }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded /></InputAdornment>, endAdornment: <Button onClick={search} disabled={busy}>{busy ? 'Looking…' : 'Search'}</Button> }} />
        </Box>
        <Box className="video-grid">{results.map((video) => <VideoCard key={video.id} video={video} subscriptions={subscriptions} onFollow={toggleFollow} onPlay={play} onDownload={setDownloadVideo} onChannel={openChannel} />)}</Box>
        <Box ref={loadMoreRef} className="load-more-sentinel">{loadingMore && <CircularProgress size={26} />}</Box>
      </>}

      {tab === 'library' && <>
        <Typography variant="h4" fontWeight={850} mb={3}>Your space</Typography>
        <Typography className="section-title">Your channels</Typography>
        <Box className="subscription-grid">
          {subscriptions.map((channel) => <button className="subscription-card" key={channel.id} onClick={() => openChannel(channel.id)}><Avatar src={channel.avatar || `/api/channel-avatar/${channel.id}`}>{channel.name[0]}</Avatar><span dir={textDirection(channel.name)}>{channel.name}</span></button>)}
          {!subscriptions.length && <Typography color="text.secondary">No channels followed yet.</Typography>}
        </Box>
        <button className={`history-toggle ${historyOpen ? 'open' : ''}`} onClick={() => setHistoryOpen((open) => !open)}><span>Watch history</span><span>{history.length} videos</span><ExpandMoreRounded /></button>
        {historyOpen && (history.length ? <Box className="video-grid compact">{history.map((video) => <VideoCard key={video.id} video={video} subscriptions={subscriptions} onFollow={toggleFollow} onPlay={play} onDownload={setDownloadVideo} onChannel={openChannel} />)}</Box> : <Typography color="text.secondary">Nothing watched yet.</Typography>)}
        <Typography className="section-title">Downloads</Typography>
        <Box className="downloads-grid">{files.map((file) => <Paper className="file-item" key={file.name} elevation={0}>{file.thumbnail ? <img src={file.thumbnail} alt="" /> : <Box className="file-placeholder"><VideoLibraryRounded /></Box>}<Box className="file-copy"><Typography fontWeight={700} noWrap>{file.title || file.name}</Typography>{file.channel && <Typography variant="body2" color="text.secondary" noWrap>{file.channel}</Typography>}<Typography variant="caption" color="text.secondary">{(file.size / 1048576).toFixed(1)} MB</Typography></Box><Box className="file-actions"><IconButton href={file.url} aria-label="Save"><DownloadRounded /></IconButton><IconButton color="error" onClick={() => deleteFile(file)} aria-label="Delete"><DeleteOutlineRounded /></IconButton></Box></Paper>)}</Box>
      </>}

      {tab === 'settings' && <>
        <Typography variant="h4" fontWeight={700} mb={3}>Settings</Typography>
        <Paper className="settings-card" elevation={0}>
          <DarkModeRounded />
          <Box flex={1}><Typography fontWeight={700}>Dark mode</Typography><Typography color="text.secondary" variant="body2">Use the dark interface.</Typography></Box>
          <Switch checked={mode === 'dark'} onChange={(event) => setMode(event.target.checked ? 'dark' : 'light')} />
        </Paper>
        <Paper className="settings-card background-setting" elevation={0}>
          <WallpaperRounded />
          <Box flex={1}><Typography fontWeight={700}>Background</Typography><Typography color="text.secondary" variant="body2">Use any JPEG, PNG, or WebP image. It stays on this server.</Typography></Box>
          <Stack direction="row" spacing={1}>
            <Button component="label" variant="outlined" startIcon={<UploadRounded />} disabled={backgroundBusy}>
              Choose image
              <input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadBackground} />
            </Button>
            <Button onClick={resetBackground} disabled={backgroundBusy}>Reset</Button>
          </Stack>
        </Paper>
        <Paper className="settings-card" elevation={0}>
          <Box className="telegram-orb">✈</Box>
          <Box flex={1}><Typography fontWeight={800}>Telegram companion</Typography><Typography color="text.secondary" variant="body2">Search, download, and receive links from your private bot.</Typography></Box>
          <Chip color="success" label="Runs with YTgrab" />
        </Paper>
        <Paper className="settings-card" elevation={0}>
          <Box flex={1}><Typography fontWeight={800}>Sign out</Typography><Typography color="text.secondary" variant="body2">End this browser session.</Typography></Box>
          <Button color="error" startIcon={<LogoutRounded />} onClick={async () => { await api('/api/logout', { method: 'POST' }); setAuth(false); }}>Log out</Button>
        </Paper>
      </>}
      </>}
    </Box>

    <Paper component="nav" className="mobile-dock" elevation={0}>
      {navItems.map(({ id, label, icon: Icon }) => <button key={id} className={!channelPage && tab === id ? 'active' : ''} onClick={() => { setChannelPage(null); setTab(id); }}><Icon /><span>{label}</span></button>)}
    </Paper>

    <Dialog open={Boolean(player)} onClose={closePlayer} fullWidth maxWidth="md" PaperProps={{ className: 'player-dialog' }}>
      <IconButton className="dialog-close" onClick={closePlayer}><CloseRounded /></IconButton>
      {player && <>
        <Stack className="player-quality" direction="row" spacing={1}>
          {['360', '480', '720'].map((quality) => <Button key={quality} size="small" variant={playerQuality === quality ? 'contained' : 'outlined'} onClick={() => {
            setPlayerQuality(quality);
            preparePlayback(player, quality);
          }}>{quality}p</Button>)}
        </Stack>
        {playerStatus?.id === player.id && playerStatus.status === 'done'
          ? <HlsPlayer src={`${playerStatus.url}?v=1`} onError={(detail) => setNotice(`Playback failed: ${detail}`)} />
          : <Box className="player-preparing">
              {playerStatus?.status !== 'error' && <CircularProgress />}
              <Typography fontWeight={700}>{playerStatus?.status === 'converting' ? 'Making it browser-friendly…' : playerStatus?.status === 'error' ? 'Could not prepare this video' : `Preparing video${playerStatus?.progress ? ` · ${Math.round(playerStatus.progress)}%` : '…'}`}</Typography>
              {playerStatus?.error && <Typography color="error" variant="body2">{playerStatus.error}</Typography>}
            </Box>}
        <DialogContent><Typography variant="h6" fontWeight={800} dir={textDirection(player.title)}>{player.title}</Typography><Typography color="text.secondary" dir={textDirection(player.channel)}>{player.channel}</Typography></DialogContent>
      </>}
    </Dialog>

    <Dialog open={Boolean(downloadVideo)} onClose={() => { setDownloadVideo(null); setDownloadState(null); }} fullWidth maxWidth="xs" PaperProps={{ className: 'download-dialog' }}>
      <DialogContent>
        <Typography variant="h6" fontWeight={800}>Download video</Typography>
        <Typography color="text.secondary" mb={2}>{downloadVideo?.title}</Typography>
        {!downloadState && <Stack direction="row" flexWrap="wrap" gap={1}>{[['1080','1080p'],['720','720p'],['480','480p'],['audio','Audio'],['best','Best']].map(([value,label]) => <Button key={value} variant="outlined" onClick={() => startDownload(value)}>{label}</Button>)}</Stack>}
        {downloadState && <Box><Typography>{downloadState.status === 'done' ? 'Ready to save' : downloadState.status === 'error' ? downloadState.error : `Downloading… ${Math.round(downloadState.progress || 0)}%`}</Typography>{downloadState.status === 'done' && <Button sx={{ mt: 2 }} variant="contained" href={downloadState.url}>Save file</Button>}</Box>}
      </DialogContent>
    </Dialog>

    <Snackbar open={Boolean(notice)} autoHideDuration={3500} onClose={() => setNotice('')} message={notice} />
  </Box>;
}
