import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogContent,
  IconButton, InputAdornment, Paper, Snackbar, Stack, Switch, TextField, Typography
} from '@mui/material';
import {
  AddRounded, ArrowBackRounded, CheckRounded, CloseRounded, DarkModeRounded, DownloadRounded, ExploreRounded,
  HomeRounded, LogoutRounded, PersonAddRounded, PlayArrowRounded, SearchRounded,
  SettingsRounded, SubscriptionsRounded, VideoLibraryRounded
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
      <Box className="brand-mark">Y</Box>
      <Typography variant="h4" fontWeight={800}>Welcome home</Typography>
      <Typography color="text.secondary">Your private corner of YouTube.</Typography>
      <TextField fullWidth type="password" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      {error && <Alert severity="error">{error}</Alert>}
      <Button size="large" variant="contained" type="submit" disabled={busy}>{busy ? 'Opening…' : 'Open YTgrab'}</Button>
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
      <Typography className="video-title">{video.title}</Typography>
      <Stack direction="row" alignItems="center" spacing={1} mt={0.75}>
        <Avatar className="tiny-avatar">{(video.channel || '?')[0]}</Avatar>
        <button className="channel-link" onClick={() => video.channelId && onChannel(video.channelId)}>{video.channel || 'YouTube'}</button>
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
  const [downloadVideo, setDownloadVideo] = useState(null);
  const [downloadState, setDownloadState] = useState(null);
  const [channelPage, setChannelPage] = useState(null);
  const [channelBusy, setChannelBusy] = useState(false);

  const title = useMemo(() => navItems.find((item) => item.id === tab)?.label, [tab]);

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

  const play = async (video) => {
    setPlayer(video);
    api('/api/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(video) }).catch(() => {});
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

  if (auth === null) return <Box className="splash"><CircularProgress /></Box>;
  if (!auth) return <Login onLogin={() => { setAuth(true); loadPersonalData(); }} />;

  return <Box className="app-shell">
    <Box component="header" className="topbar">
      <Stack direction="row" alignItems="center" spacing={1.2}>
        <Box className="brand-mark small">Y</Box>
        <Box><Typography className="eyebrow">YTGRAB</Typography><Typography variant="h5" fontWeight={700}>{channelPage?.channel?.name || title}</Typography></Box>
      </Stack>
      <Avatar className="profile-avatar">you</Avatar>
    </Box>

    <Box component="main" className="main-content">
      {channelPage ? <>
        <Button className="back-button" startIcon={<ArrowBackRounded />} onClick={() => setChannelPage(null)}>Back</Button>
        {channelBusy || !channelPage.channel ? <Box className="channel-loading"><CircularProgress /></Box> : <>
          <Box className="channel-header">
            <Avatar className="channel-avatar">{channelPage.channel.name[0]}</Avatar>
            <Box className="channel-heading">
              <Typography variant="h4" fontWeight={700}>{channelPage.channel.name}</Typography>
              <Typography color="text.secondary">{channelPage.channel.followers ? `${channelPage.channel.followers.toLocaleString()} followers · ` : ''}{channelPage.videos.length} recent videos</Typography>
              {channelPage.channel.description && <Typography className="channel-description" color="text.secondary">{channelPage.channel.description}</Typography>}
            </Box>
            <Button variant={subscriptions.some((item) => item.id === channelPage.channel.id) ? 'outlined' : 'contained'} onClick={() => toggleFollow({ channelId: channelPage.channel.id, channel: channelPage.channel.name })}>
              {subscriptions.some((item) => item.id === channelPage.channel.id) ? 'Following' : 'Follow'}
            </Button>
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
          <TextField className="big-search" fullWidth value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="Linux, cooking, a video link…" InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded /></InputAdornment>, endAdornment: <Button onClick={search} disabled={busy}>{busy ? 'Looking…' : 'Search'}</Button> }} />
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
      {player && <><Box component="video" className="video-player" src={`/api/stream/${player.id}`} controls autoPlay playsInline /><DialogContent><Typography variant="h6" fontWeight={800}>{player.title}</Typography><Typography color="text.secondary">{player.channel}</Typography></DialogContent></>}
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
