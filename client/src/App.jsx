import { useEffect, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogContent,
  IconButton, InputAdornment, Paper, Snackbar, Stack, Switch, TextField, Typography
} from '@mui/material';
import {
  AddRounded, ArrowBackRounded, CheckRounded, CloseRounded, DarkModeRounded, DownloadRounded, ExploreRounded,
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
        <Avatar className="tiny-avatar" src={video.channelAvatar || undefined}>{(video.channel || '?')[0]}</Avatar>
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
  const [feed, setFeed] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [history, setHistory] = useState([]);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [player, setPlayer] = useState(null);
  const [playerStatus, setPlayerStatus] = useState(null);
  const [downloadVideo, setDownloadVideo] = useState(null);
  const [downloadState, setDownloadState] = useState(null);
  const [channelPage, setChannelPage] = useState(null);
  const [channelBusy, setChannelBusy] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);

  const loadPersonalData = async () => {
    const [subs, watched, stored] = await Promise.all([
      api('/api/subscriptions'), api('/api/history'), api('/api/files')
    ]);
    setSubscriptions(subs.subscriptions); setHistory(watched.history); setFiles(stored.files);
    if (subs.subscriptions.length) {
      try { setFeed((await api('/api/feed')).videos); } catch (err) { setNotice(err.message); }
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
      setResults([direct]);
      return;
    }
    setBusy(true);
    try { setResults((await api(`/api/search?q=${encodeURIComponent(value)}`)).results); }
    catch (err) { setNotice(err.message); }
    finally { setBusy(false); }
  };

  const toggleFollow = async (video) => {
    if (!video.channelId) return;
    const existing = subscriptions.some((item) => item.id === video.channelId);
    try {
      const data = existing
        ? await api(`/api/subscriptions/${encodeURIComponent(video.channelId)}`, { method: 'DELETE' })
        : await api('/api/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: video.channelId, name: video.channel }) });
      setSubscriptions(data.subscriptions);
      setNotice(existing ? `Unfollowed ${video.channel}` : `Following ${video.channel}`);
    } catch (err) { setNotice(err.message); }
  };

  const pollStream = (videoId) => {
    const check = async () => {
      try {
        const state = await api(`/api/stream/${videoId}/status`);
        setPlayerStatus({ id: videoId, ...state });
        if (!['done', 'error'].includes(state.status)) setTimeout(check, 1500);
      } catch (error) {
        setPlayerStatus({ id: videoId, status: 'error', error: error.message });
      }
    };
    setTimeout(check, 800);
  };

  const play = async (video) => {
    setPlayer(video);
    setPlayerStatus({ id: video.id, status: 'starting', progress: 0 });
    api('/api/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(video) }).catch(() => {});
    try {
      const state = await api(`/api/stream/${video.id}/prepare`, { method: 'POST' });
      setPlayerStatus({ id: video.id, ...state });
      if (!['done', 'error'].includes(state.status)) pollStream(video.id);
    } catch (error) {
      setPlayerStatus({ id: video.id, status: 'error', error: error.message });
    }
  };

  const openChannel = async (channelId) => {
    if (!channelId) return;
    setChannelBusy(true);
    setChannelPage({ channel: null, videos: [] });
    try { setChannelPage(await api(`/api/channels/${encodeURIComponent(channelId)}`)); }
    catch (err) { setChannelPage(null); setNotice(err.message); }
    finally { setChannelBusy(false); }
  };

  const startDownload = async (quality) => {
    const video = downloadVideo;
    setDownloadState({ status: 'starting', progress: 0 });
    try {
      const started = await api('/api/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${video.id}`, quality }) });
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
        </>}
      </> : <>
      {tab === 'home' && <>
        <Box className="page-heading"><Typography variant="h4" fontWeight={700}>Latest</Typography><Typography color="text.secondary">New videos from channels you follow.</Typography></Box>
        {feed.length ? <Box className="video-grid">{feed.map((video) => <VideoCard key={video.id} video={video} subscriptions={subscriptions} onFollow={toggleFollow} onPlay={play} onDownload={setDownloadVideo} onChannel={openChannel} />)}</Box>
          : <EmptyState icon={SubscriptionsRounded} title="Your feed starts with people" text="Follow a few channels and their newest videos will show up here." action={<Button onClick={() => setTab('search')} startIcon={<AddRounded />}>Find channels</Button>} />}
      </>}

      {tab === 'search' && <>
        <Box className="search-hero">
          <Typography variant="h4" fontWeight={700}>Search</Typography>
          <Typography color="text.secondary">Find a video or paste a YouTube link.</Typography>
          <TextField className="big-search" fullWidth value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="Linux, cooking, a video link…" inputProps={{ dir: 'auto' }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded /></InputAdornment>, endAdornment: <Button onClick={search} disabled={busy}>{busy ? 'Looking…' : 'Search'}</Button> }} />
        </Box>
        <Box className="video-grid">{results.map((video) => <VideoCard key={video.id} video={video} subscriptions={subscriptions} onFollow={toggleFollow} onPlay={play} onDownload={setDownloadVideo} onChannel={openChannel} />)}</Box>
      </>}

      {tab === 'library' && <>
        <Typography variant="h4" fontWeight={850} mb={3}>Your space</Typography>
        <Typography className="section-title">Following</Typography>
        <Stack direction="row" gap={1.2} className="channel-strip">
          {subscriptions.map((channel) => <Chip key={channel.id} avatar={<Avatar>{channel.name[0]}</Avatar>} label={channel.name} onDelete={() => toggleFollow({ channelId: channel.id, channel: channel.name })} />)}
          {!subscriptions.length && <Typography color="text.secondary">No channels followed yet.</Typography>}
        </Stack>
        <Typography className="section-title">Recently watched</Typography>
        {history.length ? <Box className="video-grid compact">{history.map((video) => <VideoCard key={video.id} video={video} subscriptions={subscriptions} onFollow={toggleFollow} onPlay={play} onDownload={setDownloadVideo} onChannel={openChannel} />)}</Box> : <Typography color="text.secondary">Videos you watch will appear here.</Typography>}
        <Typography className="section-title">Downloads</Typography>
        <Stack spacing={1}>{files.map((file) => <Paper className="file-item" key={file.name} elevation={0}><Box><Typography fontWeight={700} noWrap>{file.name}</Typography><Typography variant="caption" color="text.secondary">{(file.size / 1048576).toFixed(1)} MB</Typography></Box><Button href={file.url} startIcon={<DownloadRounded />}>Save</Button></Paper>)}</Stack>
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

    <Dialog open={Boolean(player)} onClose={() => setPlayer(null)} fullWidth maxWidth="md" PaperProps={{ className: 'player-dialog' }}>
      <IconButton className="dialog-close" onClick={() => setPlayer(null)}><CloseRounded /></IconButton>
      {player && <>
        {playerStatus?.id === player.id && playerStatus.status === 'done'
          ? <Box component="video" className="video-player" src={`${playerStatus.url}?v=3`} controls autoPlay playsInline onError={(event) => {
              const mediaError = event.currentTarget.error;
              const detail = mediaError?.message || `media error code ${mediaError?.code || 'unknown'}`;
              setNotice(`Playback failed: ${detail}`);
            }} />
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
