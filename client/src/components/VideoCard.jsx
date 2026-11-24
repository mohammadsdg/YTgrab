import { Avatar, Box, Button, IconButton, Paper, Stack, Typography } from '@mui/material';
import { CheckRounded, DownloadRounded, PersonAddRounded, PlayArrowRounded, PlaylistAddRounded } from '@mui/icons-material';
import { formatDuration, textDirection } from '../utils';

export default function VideoCard({ video, subscriptions, onFollow, onPlay, onDownload, onChannel, onPlaylist }) {
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
        <IconButton className="round-action playlist-action" size="small" onClick={(event) => onPlaylist(video, event.currentTarget)} title="Add to video playlist" aria-label="Add to video playlist"><PlaylistAddRounded fontSize="small" /></IconButton>
        <IconButton className="round-action download-action" size="small" onClick={(event) => onDownload(video, event.currentTarget)} title="Download" aria-label="Download"><DownloadRounded fontSize="small" /></IconButton>
      </Stack>
    </Box>
  </Paper>;
}
