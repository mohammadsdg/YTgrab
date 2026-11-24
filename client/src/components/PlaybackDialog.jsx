import { Box, Button, CircularProgress, Dialog, DialogContent, IconButton, Stack, Typography } from '@mui/material';
import { CloseRounded, PlaylistAddRounded } from '@mui/icons-material';
import HlsPlayer from './HlsPlayer';
import { textDirection } from '../utils';

export default function PlaybackDialog({ player, closePlayer, playerQuality, setPlayerQuality, preparePlayback, playerStatus, setNotice, chooseVideoPlaylist }) {
  return <>
    <Dialog open={Boolean(player)} onClose={closePlayer} fullWidth maxWidth="md" PaperProps={{ className: 'player-dialog' }}>
      <IconButton className="dialog-close" onClick={closePlayer}><CloseRounded /></IconButton>
      {player && <>
        <Stack className="player-quality" direction="row" spacing={1}>
          {[['audio', 'Audio'], ['480', '480p'], ['720', '720p'], ['1080', '1080p']].map(([quality, label]) => <Button key={quality} size="small" variant={playerQuality === quality ? 'contained' : 'outlined'} onClick={() => {
            setPlayerQuality(quality);
            preparePlayback(player, quality);
          }}>{label}</Button>)}
        </Stack>
        {playerStatus?.id === player.id && playerStatus.status === 'done'
          ? <HlsPlayer src={`${playerStatus.url}?v=1`} audioOnly={playerQuality === 'audio'} onError={(detail) => setNotice(`Playback failed: ${detail}`)} />
          : <Box className="player-preparing">
              {playerStatus?.status !== 'error' && <CircularProgress />}
              <Typography fontWeight={700}>{playerStatus?.status === 'converting' ? 'Making it browser-friendly…' : playerStatus?.status === 'error' ? 'Could not prepare this video' : `Preparing video${playerStatus?.progress ? ` · ${Math.round(playerStatus.progress)}%` : '…'}`}</Typography>
              {playerStatus?.error && <Typography color="error" variant="body2">{playerStatus.error}</Typography>}
            </Box>}
        <DialogContent><Typography variant="h6" fontWeight={800} dir={textDirection(player.title)}>{player.title}</Typography><Typography color="text.secondary" dir={textDirection(player.channel)}>{player.channel}</Typography><Button size="small" startIcon={<PlaylistAddRounded />} onClick={(event) => chooseVideoPlaylist(player, event.currentTarget)} sx={{ mt: 1 }}>Add to playlist</Button></DialogContent>
      </>}
    </Dialog>

  </>;
}
