import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  Avatar, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, Menu, MenuItem, Paper, Snackbar, TextField, Typography
} from '@mui/material';
import {
  AddRounded, ArrowBackRounded, DownloadRounded,
  HeadphonesRounded, HomeRounded, SearchRounded,
  SettingsRounded, SubscriptionsRounded, VideoLibraryRounded
} from '@mui/icons-material';
import Login from './components/Login';
import VideoCard from './components/VideoCard';
import EmptyState from './components/EmptyState';
import PlaybackDialog from './components/PlaybackDialog';
import DownloadQueue from './components/DownloadQueue';
import VideoSkeleton from './components/VideoSkeleton';
import { api, textDirection } from './utils';
import useVideoPlayback from './video/useVideoPlayback';
import useDownloads from './video/useDownloads';
import useVideoSearch from './video/useVideoSearch';

const MusicSection = lazy(() => import('./MusicSection'));
const VideoLibrary = lazy(() => import('./components/VideoLibrary'));
const DownloadsView = lazy(() => import('./components/DownloadsView'));
const SettingsPanel = lazy(() => import('./components/SettingsPanel'));

const navItems = [
  { id: 'home', label: 'Watch', icon: HomeRounded },
  { id: 'search', label: 'Search', icon: SearchRounded },
  { id: 'music', label: 'Music', icon: HeadphonesRounded },
  { id: 'library', label: 'Library', icon: VideoLibraryRounded },
  { id: 'downloads', label: 'Downloads', short: 'Saved', icon: DownloadRounded },
  { id: 'settings', label: 'Settings', icon: SettingsRounded }
];

export default function App({ mode, setMode }) {
  const [auth, setAuth] = useState(null);
  const [tab, setTab] = useState(() => navItems.some((item) => `#${item.id}` === window.location.hash) ? window.location.hash.slice(1) : 'home');
  const [musicMounted, setMusicMounted] = useState(tab === 'music');
  const [loadingMore, setLoadingMore] = useState(false);
  const [feed, setFeed] = useState([]);
  const [feedPage, setFeedPage] = useState(1);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);
  const [subscriptions, setSubscriptions] = useState([]);
  const [videoPlaylists, setVideoPlaylists] = useState([]);
  const [videoPlaylistView, setVideoPlaylistView] = useState(null);
  const [videoPlaylistChoice, setVideoPlaylistChoice] = useState(null);
  const [videoPlaylistDialog, setVideoPlaylistDialog] = useState(false);
  const [videoPlaylistName, setVideoPlaylistName] = useState('');
  const [pendingPlaylistVideo, setPendingPlaylistVideo] = useState(null);
  const [history, setHistory] = useState([]);
  const [files, setFiles] = useState([]);
  const [notice, setNotice] = useState('');
  const [downloadChoice, setDownloadChoice] = useState(null);
  const [channelPage, setChannelPage] = useState(null);
  const [channelBusy, setChannelBusy] = useState(false);
  const [channelPageNumber, setChannelPageNumber] = useState(1);
  const [channelHasMore, setChannelHasMore] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [performanceMode, setPerformanceMode] = useState('chill');
  const [performanceBusy, setPerformanceBusy] = useState(false);
  const loadMoreRef = useRef(null);
  const { downloadJobs, setDownloadJobs, startDownload } = useDownloads(setFiles);
  const { query, setQuery, results, setResults, searchPage, setSearchPage, searchHasMore, setSearchHasMore, busy, search } = useVideoSearch(setNotice);
  const { player, playerStatus, playerQuality, setPlayerQuality, preparePlayback, play, closePlayer } = useVideoPlayback((video) => {
    setHistory((current) => [{ ...video, watchedAt: Date.now() }, ...current.filter((item) => item.id !== video.id)].slice(0, 100));
    api('/api/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(video) }).catch(() => {});
  });

  useEffect(() => { if (tab === 'music') setMusicMounted(true); }, [tab]);

  useEffect(() => {
    const expired = () => setAuth(false);
    window.addEventListener('ytgrab:unauthorized', expired);
    return () => window.removeEventListener('ytgrab:unauthorized', expired);
  }, []);

  const navigateTab = (id) => {
    if (!navItems.some((item) => item.id === id)) return;
    setChannelPage(null);
    setTab(id);
    if (window.location.hash !== `#${id}`) window.history.pushState({ tab: id }, '', `#${id}`);
  };

  useEffect(() => {
    const restore = () => {
      const id = window.location.hash.slice(1);
      if (navItems.some((item) => item.id === id)) { setChannelPage(null); setTab(id); }
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  const loadPersonalData = async () => {
    // Start the feed immediately; file and preference requests must not delay it.
    setFeedLoading(true);
    const feedRequest = api('/api/feed?page=1').then((data) => {
      setFeed(data.videos || []); setFeedPage(1); setFeedHasMore(Boolean(data.hasMore));
    }).catch((error) => setNotice(error.message)).finally(() => setFeedLoading(false));
    const other = await Promise.allSettled([
      api('/api/subscriptions'), api('/api/history'), api('/api/files'), api('/api/preferences'), api('/api/video-playlists')
    ]);
    if (other[0].status === 'fulfilled') setSubscriptions(other[0].value.subscriptions || []);
    if (other[1].status === 'fulfilled') setHistory(other[1].value.history || []);
    if (other[2].status === 'fulfilled') setFiles(other[2].value.files || []);
    if (other[3].status === 'fulfilled') setPerformanceMode(other[3].value.performanceMode);
    if (other[4].status === 'fulfilled') setVideoPlaylists(other[4].value.playlists || []);
    const failure = other.find((result) => result.status === 'rejected');
    if (failure) setNotice(failure.reason.message);
    await feedRequest;
  };

  useEffect(() => {
    api('/api/session').then(() => {
      setAuth(true);
      document.documentElement.style.setProperty('--app-background', `url("/api/background?v=${Date.now()}")`);
      loadPersonalData();
    }).catch(() => setAuth(false));
  }, []);

  const toggleFollow = async (video) => {
    if (!video.channelId) return;
    const existing = subscriptions.some((item) => item.id === video.channelId);
    try {
      const data = existing
        ? await api(`/api/subscriptions/${encodeURIComponent(video.channelId)}`, { method: 'DELETE' })
        : await api('/api/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: video.channelId, name: video.channel, avatar: video.channelAvatar || `/api/channel-avatar/${video.channelId}` }) });
      setSubscriptions(data.subscriptions);
      setNotice(existing ? `Unfollowed ${video.channel}` : `Following ${video.channel}`);
      setFeedLoading(true);
      api('/api/feed?page=1').then((next) => {
        setFeed(next.videos || []); setFeedPage(1); setFeedHasMore(Boolean(next.hasMore));
      }).catch((error) => setNotice(error.message)).finally(() => setFeedLoading(false));
    } catch (err) { setNotice(err.message); }
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

  const chooseDownload = (video, anchor) => setDownloadChoice({ video, anchor });

  const chooseVideoPlaylist = (video, anchor) => setVideoPlaylistChoice({ video, anchor });

  const addVideoToPlaylist = async (playlistId, video) => {
    try {
      const data = await api(`/api/video-playlists/${encodeURIComponent(playlistId)}/videos`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ video })
      });
      setVideoPlaylists(data.playlists);
      setVideoPlaylistChoice(null);
      setNotice('Added to video playlist.');
    } catch (error) { setNotice(error.message); }
  };

  const createVideoPlaylist = async () => {
    const name = videoPlaylistName.trim();
    if (!name) return;
    try {
      const data = await api('/api/video-playlists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name })
      });
      setVideoPlaylists(data.playlists);
      setVideoPlaylistDialog(false);
      setVideoPlaylistName('');
      const video = pendingPlaylistVideo;
      setPendingPlaylistVideo(null);
      if (video) await addVideoToPlaylist(data.playlist.id, video);
      else setNotice('Video playlist created.');
    } catch (error) { setNotice(error.message); }
  };

  const removeVideoFromPlaylist = async (playlistId, videoId) => {
    try {
      const data = await api(`/api/video-playlists/${encodeURIComponent(playlistId)}/videos/${encodeURIComponent(videoId)}`, { method: 'DELETE' });
      setVideoPlaylists(data.playlists);
      setNotice('Video removed from playlist.');
    } catch (error) { setNotice(error.message); }
  };

  const deleteVideoPlaylist = async (playlistId) => {
    if (!window.confirm('Delete this video playlist?')) return;
    try {
      const data = await api(`/api/video-playlists/${encodeURIComponent(playlistId)}`, { method: 'DELETE' });
      setVideoPlaylists(data.playlists);
      setVideoPlaylistView(null);
      setNotice('Video playlist deleted.');
    } catch (error) { setNotice(error.message); }
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

  const changePerformanceMode = async (nextMode) => {
    if (performanceBusy || nextMode === performanceMode) return;
    setPerformanceBusy(true);
    try {
      const preferences = await api('/api/preferences', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ performanceMode: nextMode })
      });
      setPerformanceMode(preferences.performanceMode);
      setFeedLoading(true);
      const data = await api('/api/feed?page=1');
      setFeed(data.videos); setFeedPage(1); setFeedHasMore(data.hasMore);
      setNotice(nextMode === 'heavy' ? 'Heavy mode enabled. The server is warming your feed.' : 'Chill mode enabled.');
    } catch (error) { setNotice(error.message); }
    finally { setFeedLoading(false); setPerformanceBusy(false); }
  };

  const selectedVideoPlaylist = videoPlaylists.find((item) => item.id === videoPlaylistView);

  if (auth === null) return <Box className="splash"><CircularProgress /></Box>;
  if (!auth) return <Login onLogin={() => {
    setAuth(true);
    document.documentElement.style.setProperty('--app-background', `url("/api/background?v=${Date.now()}")`);
    loadPersonalData();
  }} />;

  return <Box className={`app-shell ${tab === 'music' ? 'music-active' : ''}`}>
    <Box component="header" className="topbar">
      <img className="brand-mark small" src="/ytgrab-mark.png" alt="YTgrab" />
      <Typography className="topbar-destination">{navItems.find((item) => item.id === tab)?.label || 'YTgrab'}</Typography>
      <IconButton className="topbar-settings" onClick={() => navigateTab('settings')} aria-label="Open settings"><SettingsRounded /></IconButton>
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
          <Box className="video-grid">{channelPage.videos.map((video) => <VideoCard key={video.id} video={video} subscriptions={subscriptions} onFollow={toggleFollow} onPlay={play} onDownload={chooseDownload} onChannel={openChannel} onPlaylist={chooseVideoPlaylist} />)}</Box>
          <Box ref={loadMoreRef} className="load-more-sentinel">{loadingMore && <CircularProgress size={26} />}</Box>
        </>}
      </> : <>
      {tab === 'home' && <>
        <Box className="page-heading"><Typography variant="h4" fontWeight={700}>Latest</Typography><Typography color="text.secondary">New videos from channels you follow.</Typography></Box>
        {feedLoading && !feed.length ? <VideoSkeleton />
          : feed.length ? <Box className="video-grid">{feed.map((video) => <VideoCard key={video.id} video={video} subscriptions={subscriptions} onFollow={toggleFollow} onPlay={play} onDownload={chooseDownload} onChannel={openChannel} onPlaylist={chooseVideoPlaylist} />)}</Box>
          : <EmptyState icon={SubscriptionsRounded} title="Your feed starts with people" text="Follow a few channels and their newest videos will show up here." action={<Button onClick={() => navigateTab('search')} startIcon={<AddRounded />}>Find channels</Button>} />}
        {feed.length > 0 && <Box ref={loadMoreRef} className="load-more-sentinel">{loadingMore && <CircularProgress size={26} />}</Box>}
      </>}

      {tab === 'search' && <>
        <Box className="search-hero">
          <Typography variant="h4" fontWeight={700}>Search</Typography>
          <Typography color="text.secondary">Find a video or paste a YouTube link.</Typography>
          <TextField className="big-search" fullWidth value={query} onChange={(e) => { setQuery(e.target.value); setSearchHasMore(false); }} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="Linux, cooking, a video link…" inputProps={{ dir: 'auto' }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded /></InputAdornment>, endAdornment: <Button onClick={search} disabled={busy}>{busy ? 'Looking…' : 'Search'}</Button> }} />
        </Box>
        <Box className="video-grid">{results.map((video) => <VideoCard key={video.id} video={video} subscriptions={subscriptions} onFollow={toggleFollow} onPlay={play} onDownload={chooseDownload} onChannel={openChannel} onPlaylist={chooseVideoPlaylist} />)}</Box>
        <Box ref={loadMoreRef} className="load-more-sentinel">{loadingMore && <CircularProgress size={26} />}</Box>
      </>}

      <Box sx={{ display: tab === 'music' ? 'block' : 'none' }}>
        {musicMounted && <Suspense fallback={<Box className="music-loading">Opening music…</Box>}><MusicSection api={api} active={tab === 'music'} onNotice={setNotice} onDownload={(track) => startDownload({ ...track, channel: track.artist, channelId: track.artistId }, 'audio')} /></Suspense>}
      </Box>

      {tab === 'library' && <Suspense fallback={<Box className="music-loading">Opening library…</Box>}><VideoLibrary
        selectedVideoPlaylist={selectedVideoPlaylist} videoPlaylists={videoPlaylists} subscriptions={subscriptions}
        history={history} files={files} historyOpen={historyOpen} setHistoryOpen={setHistoryOpen}
        setTab={navigateTab} setVideoPlaylistView={setVideoPlaylistView} setPendingPlaylistVideo={setPendingPlaylistVideo}
        setVideoPlaylistDialog={setVideoPlaylistDialog} openChannel={openChannel} toggleFollow={toggleFollow}
        play={play} chooseDownload={chooseDownload} chooseVideoPlaylist={chooseVideoPlaylist}
        removeVideoFromPlaylist={removeVideoFromPlaylist} deleteVideoPlaylist={deleteVideoPlaylist} deleteFile={deleteFile}
      /></Suspense>}

      {tab === 'downloads' && <Suspense fallback={<Box className="music-loading">Opening downloads…</Box>}><DownloadsView files={files} jobs={downloadJobs} onDelete={deleteFile} onRetry={(job) => startDownload(job.video, job.quality)} /></Suspense>}

      {tab === 'settings' && <Suspense fallback={<Box className="music-loading">Opening settings…</Box>}><SettingsPanel
        mode={mode} setMode={setMode} performanceMode={performanceMode} performanceBusy={performanceBusy}
        changePerformanceMode={changePerformanceMode} backgroundBusy={backgroundBusy}
        uploadBackground={uploadBackground} resetBackground={resetBackground} setAuth={setAuth}
      /></Suspense>}
      </>}
    </Box>

    <Paper component="nav" className="mobile-dock" elevation={0}>
      {navItems.map(({ id, label, short, icon: Icon }) => <button key={id} className={!channelPage && tab === id ? 'active' : ''} onClick={() => navigateTab(id)} aria-current={!channelPage && tab === id ? 'page' : undefined}><Icon /><span className="nav-label-full">{label}</span><span className="nav-label-short">{short || label}</span></button>)}
    </Paper>

    <PlaybackDialog player={player} closePlayer={closePlayer} playerQuality={playerQuality} setPlayerQuality={setPlayerQuality} preparePlayback={preparePlayback} playerStatus={playerStatus} setNotice={setNotice} chooseVideoPlaylist={chooseVideoPlaylist} />

    <Menu anchorEl={downloadChoice?.anchor || null} open={Boolean(downloadChoice)} onClose={() => setDownloadChoice(null)} PaperProps={{ className: 'download-menu' }}>
      {[['audio', 'Best audio'], ['480', 'Video · 480p'], ['720', 'Video · 720p'], ['1080', 'Video · 1080p'], ['best', 'Best available video']].map(([quality, label]) => <MenuItem key={quality} onClick={() => {
        startDownload(downloadChoice.video, quality);
        setDownloadChoice(null);
      }}>{label}</MenuItem>)}
    </Menu>

    <Menu anchorEl={videoPlaylistChoice?.anchor || null} open={Boolean(videoPlaylistChoice)} onClose={() => setVideoPlaylistChoice(null)} PaperProps={{ className: 'download-menu' }}>
      {videoPlaylists.map((playlist) => <MenuItem key={playlist.id} onClick={() => addVideoToPlaylist(playlist.id, videoPlaylistChoice.video)}>{playlist.name}</MenuItem>)}
      <MenuItem onClick={() => { setPendingPlaylistVideo(videoPlaylistChoice.video); setVideoPlaylistChoice(null); setVideoPlaylistDialog(true); }}><AddRounded fontSize="small" sx={{ mr: 1 }} />New video playlist</MenuItem>
    </Menu>

    <Dialog open={videoPlaylistDialog} onClose={() => { setVideoPlaylistDialog(false); setPendingPlaylistVideo(null); }} fullWidth maxWidth="xs">
      <DialogTitle>New video playlist</DialogTitle>
      <DialogContent><TextField autoFocus fullWidth label="Playlist name" value={videoPlaylistName} onChange={(event) => setVideoPlaylistName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && createVideoPlaylist()} inputProps={{ maxLength: 100 }} /></DialogContent>
      <DialogActions><Button onClick={() => { setVideoPlaylistDialog(false); setPendingPlaylistVideo(null); }}>Cancel</Button><Button variant="contained" onClick={createVideoPlaylist}>Create</Button></DialogActions>
    </Dialog>

    <DownloadQueue downloadJobs={downloadJobs} setDownloadJobs={setDownloadJobs} />

    <Snackbar open={Boolean(notice)} autoHideDuration={3500} onClose={() => setNotice('')} message={notice} />
  </Box>;
}
