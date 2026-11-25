import { Box, IconButton } from '@mui/material';
import { ArrowDownwardRounded, ArrowUpwardRounded, DownloadRounded, FavoriteBorderRounded, FavoriteRounded, MoreHorizRounded } from '@mui/icons-material';

export function time(value) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}

export default function SongRow({ song, index, current, playing, liked, onPlay, onArtist, onLike, onDownload, onMenu, onMove, count }) {
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
    <IconButton size="small" onClick={(event) => onMenu(song, event.currentTarget)} aria-label={`More actions for ${song.title}`}><MoreHorizRounded /></IconButton>
    {onMove && <Box className="music-song-order"><IconButton size="small" disabled={index === 0} onClick={() => onMove(index, index - 1)} aria-label={`Move ${song.title} up`}><ArrowUpwardRounded /></IconButton><IconButton size="small" disabled={index === count - 1} onClick={() => onMove(index, index + 1)} aria-label={`Move ${song.title} down`}><ArrowDownwardRounded /></IconButton></Box>}
  </Box>;
}
