import { Avatar, Box, Button, IconButton, Paper, Typography } from '@mui/material';
import { AddRounded, ArrowBackRounded, DeleteOutlineRounded, DownloadRounded, ExpandMoreRounded, PlaylistAddRounded, VideoLibraryRounded } from '@mui/icons-material';
import VideoCard from './VideoCard';
import EmptyState from './EmptyState';
import { textDirection } from '../utils';

export default function VideoLibrary({ selectedVideoPlaylist, videoPlaylists, subscriptions, history, files, historyOpen, setHistoryOpen, setTab, setVideoPlaylistView, setPendingPlaylistVideo, setVideoPlaylistDialog, openChannel, toggleFollow, play, chooseDownload, chooseVideoPlaylist, removeVideoFromPlaylist, deleteVideoPlaylist, deleteFile }) {
  return <>
        {selectedVideoPlaylist ? <>
          <Button className="back-button" startIcon={<ArrowBackRounded />} onClick={() => setVideoPlaylistView(null)}>Back to Library</Button>
          <Box className="video-playlist-heading"><Box><Typography variant="overline" color="primary">VIDEO PLAYLIST</Typography><Typography variant="h4" fontWeight={800} dir={textDirection(selectedVideoPlaylist.name)}>{selectedVideoPlaylist.name}</Typography><Typography color="text.secondary">{selectedVideoPlaylist.videos.length} videos</Typography></Box><Button color="error" startIcon={<DeleteOutlineRounded />} onClick={() => deleteVideoPlaylist(selectedVideoPlaylist.id)}>Delete playlist</Button></Box>
          {selectedVideoPlaylist.videos.length ? <Box className="video-grid">{selectedVideoPlaylist.videos.map((video) => <Box className="playlist-video-item" key={video.id}><VideoCard video={video} subscriptions={subscriptions} onFollow={toggleFollow} onPlay={play} onDownload={chooseDownload} onChannel={openChannel} onPlaylist={chooseVideoPlaylist} /><Button size="small" color="error" startIcon={<DeleteOutlineRounded />} onClick={() => removeVideoFromPlaylist(selectedVideoPlaylist.id, video.id)}>Remove from playlist</Button></Box>)}</Box>
            : <EmptyState icon={PlaylistAddRounded} title="This playlist is waiting" text="Add videos from your feed, search, or watch history." action={<Button onClick={() => setTab('search')}>Find videos</Button>} />}
        </> : <>
          <Typography variant="h4" fontWeight={850} mb={3}>Your space</Typography>
          <Typography className="section-title">Your channels</Typography>
          <Box className="subscription-grid">
            {subscriptions.map((channel) => <button className="subscription-card" key={channel.id} onClick={() => openChannel(channel.id)}><Avatar src={channel.avatar || `/api/channel-avatar/${channel.id}`}>{channel.name[0]}</Avatar><span dir={textDirection(channel.name)}>{channel.name}</span></button>)}
            {!subscriptions.length && <Typography color="text.secondary">No channels followed yet.</Typography>}
          </Box>
          <Box className="video-playlist-section-head"><Typography className="section-title">Video playlists</Typography><Button size="small" variant="outlined" startIcon={<AddRounded />} onClick={() => { setPendingPlaylistVideo(null); setVideoPlaylistDialog(true); }}>New playlist</Button></Box>
          <Box className="video-playlist-grid">{videoPlaylists.map((playlist) => <button className="video-playlist-card" key={playlist.id} onClick={() => setVideoPlaylistView(playlist.id)}><span className="video-playlist-cover">{playlist.videos[0] ? <img src={playlist.videos[0].thumbnail} alt="" /> : <PlaylistAddRounded />}</span><strong dir={textDirection(playlist.name)}>{playlist.name}</strong><small>{playlist.videos.length} videos</small></button>)}
            {!videoPlaylists.length && <Typography color="text.secondary">Make a playlist, then save videos to it with the playlist button on each video.</Typography>}
          </Box>
          <button className={`history-toggle ${historyOpen ? 'open' : ''}`} onClick={() => setHistoryOpen((open) => !open)}><span>Watch history</span><span>{history.length} videos</span><ExpandMoreRounded /></button>
          {historyOpen && (history.length ? <Box className="video-grid compact">{history.map((video) => <VideoCard key={video.id} video={video} subscriptions={subscriptions} onFollow={toggleFollow} onPlay={play} onDownload={chooseDownload} onChannel={openChannel} onPlaylist={chooseVideoPlaylist} />)}</Box> : <Typography color="text.secondary">Nothing watched yet.</Typography>)}
          <Typography className="section-title">Downloads</Typography>
          <Box className="downloads-grid">{files.map((file) => <Paper className="file-item" key={file.name} elevation={0}>{file.thumbnail ? <img src={file.thumbnail} alt="" /> : <Box className="file-placeholder"><VideoLibraryRounded /></Box>}<Box className="file-copy"><Typography fontWeight={700} noWrap>{file.title || file.name}</Typography>{file.channel && <Typography variant="body2" color="text.secondary" noWrap>{file.channel}</Typography>}<Typography variant="caption" color="text.secondary">{(file.size / 1048576).toFixed(1)} MB</Typography></Box><Box className="file-actions"><IconButton href={file.url} aria-label="Save"><DownloadRounded /></IconButton><IconButton color="error" onClick={() => deleteFile(file)} aria-label="Delete"><DeleteOutlineRounded /></IconButton></Box></Paper>)}</Box>
        </>}
  </>;
}
