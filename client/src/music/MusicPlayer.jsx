import { useEffect, useRef, useState } from 'react';
import {
  Box, Button, CircularProgress, Dialog, IconButton, Menu, MenuItem, Slider, Tooltip, Typography
} from '@mui/material';
import {
  ArrowDownwardRounded, ArrowUpwardRounded, BedtimeRounded, CloseRounded, DownloadRounded,
  FavoriteBorderRounded, FavoriteRounded, GraphicEqRounded, KeyboardArrowDownRounded,
  LyricsRounded, MoreHorizRounded, PauseRounded, PlayArrowRounded, PlaylistPlayRounded,
  RepeatOneRounded, RepeatRounded, ShuffleRounded, SkipNextRounded, SkipPreviousRounded,
  VolumeOffRounded, VolumeUpRounded
} from '@mui/icons-material';
import './music-player.css';

const rates = [0.75, 1, 1.25, 1.5, 1.75, 2];

function clock(value) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}

function LyricsPanel({ lyrics, loading, elapsed, offset, onOffset, onSeek }) {
  const activeLine = lyrics?.lines?.length
    ? lyrics.lines.findLastIndex((line) => line.time <= elapsed - offset) : -1;
  const activeRef = useRef(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeLine]);

  if (loading) return <Box className="np-empty"><CircularProgress size={25} /><span>Finding lyrics…</span></Box>;
  if (!lyrics?.available) return <Box className="np-empty"><LyricsRounded /><span>{lyrics?.error || 'Lyrics are not available for this song.'}</span></Box>;
  return <Box className="np-lyrics-wrap">
    <Box className="np-panel-top"><span>{lyrics.source}{lyrics.language ? ` · ${lyrics.language}` : ''}</span>
      {!!lyrics.lines?.length && <Box className="np-offset"><button onClick={() => onOffset(offset - 0.5)} aria-label="Show lyrics earlier">−</button><span>{offset ? `${offset > 0 ? '+' : ''}${offset.toFixed(1)}s` : 'Sync'}</span><button onClick={() => onOffset(offset + 0.5)} aria-label="Show lyrics later">+</button></Box>}
    </Box>
    {lyrics.lines?.length ? <Box className="np-lyrics-timed">
      {lyrics.lines.map((line, index) => <button key={`${line.time}-${index}`} ref={index === activeLine ? activeRef : undefined}
        className={index === activeLine ? 'active' : ''} dir="auto" onClick={() => onSeek(Math.max(0, line.time + offset))}>{line.text}</button>)}
    </Box> : <Typography className="np-lyrics-plain" dir="auto">{lyrics.text}</Typography>}
  </Box>;
}

export default function MusicPlayer({ current, queue, audioRef, streamState, playing, elapsed, duration,
  shuffle, repeat, rate, volume, muted, sleep, lyrics, lyricsLoading, lyricsOffset, liked,
  onTimeUpdate, onEnded, onPlay, onPause, onToggle, onNext, onPrevious, onSeek, onShuffle,
  onRepeat, onRate, onVolume, onMute, onSleep, onLyrics, onLyricsOffset, onLike, onDownload,
  onArtist, onPlayQueue, onMoveQueue, onRemoveQueue, onClose }) {
  const [expanded, setExpanded] = useState(false);
  const [panel, setPanel] = useState('lyrics');
  const [speedAnchor, setSpeedAnchor] = useState(null);
  const [sleepAnchor, setSleepAnchor] = useState(null);
  const [moreAnchor, setMoreAnchor] = useState(null);

  useEffect(() => {
    if (expanded && panel === 'lyrics' && current) onLyrics();
  }, [expanded, panel, current?.id]);

  const openPanel = (name) => { setPanel(name); setExpanded(true); setMoreAnchor(null); };
  const seek = (_event, value) => onSeek(Number(value));
  const status = streamState === 'preparing' ? 'Preparing audio…' : streamState === 'error' ? 'Playback unavailable' : playing ? 'Playing' : 'Paused';
  const playButton = <IconButton className="np-play" onClick={onToggle} disabled={streamState === 'preparing'} aria-label={playing ? 'Pause' : 'Play'}>
    {streamState === 'preparing' ? <CircularProgress size={22} /> : playing ? <PauseRounded /> : <PlayArrowRounded />}
  </IconButton>;

  return <>
    <audio ref={audioRef} onTimeUpdate={onTimeUpdate} onLoadedMetadata={onTimeUpdate} onEnded={onEnded} onPlay={onPlay} onPause={onPause} />
    {current && <>
      <Box className="music-player" role="region" aria-label="Music player">
        <Box className="music-player-progress"><span style={{ width: `${duration ? Math.min(100, elapsed / duration * 100) : 0}%` }} /></Box>
        <button className="music-player-identity" onClick={() => setExpanded(true)} aria-label="Open now playing">
          <img src={current.thumbnail || `/api/thumbnail/${current.id}`} alt="" />
          <span><strong dir="auto">{current.title}</strong><small dir="auto">{current.artist}</small></span>
        </button>
        <Box className="music-player-primary">
          <Tooltip title="Previous"><IconButton onClick={onPrevious} aria-label="Previous song"><SkipPreviousRounded /></IconButton></Tooltip>
          {playButton}
          <Tooltip title="Next"><IconButton onClick={onNext} aria-label="Next song"><SkipNextRounded /></IconButton></Tooltip>
        </Box>
        <Box className="music-player-timeline"><span>{clock(elapsed)}</span><Slider min={0} max={Math.max(duration, 1)} value={Math.min(elapsed, Math.max(duration, 1))} onChangeCommitted={seek} aria-label="Seek song" /><span>{clock(duration)}</span></Box>
        <Box className="music-player-extra">
          <Tooltip title="Shuffle"><IconButton className={shuffle ? 'selected' : ''} onClick={onShuffle} aria-label="Shuffle" aria-pressed={shuffle}><ShuffleRounded /></IconButton></Tooltip>
          <Tooltip title={repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat off'}><IconButton className={repeat !== 'off' ? 'selected' : ''} onClick={onRepeat} aria-label="Repeat" aria-pressed={repeat !== 'off'}>{repeat === 'one' ? <RepeatOneRounded /> : <RepeatRounded />}</IconButton></Tooltip>
          <Tooltip title="Lyrics"><IconButton onClick={() => openPanel('lyrics')} aria-label="Open lyrics"><LyricsRounded /></IconButton></Tooltip>
          <Tooltip title="Up next"><IconButton onClick={() => openPanel('queue')} aria-label="Open queue"><PlaylistPlayRounded /></IconButton></Tooltip>
          <Tooltip title="More controls"><IconButton onClick={(event) => setMoreAnchor(event.currentTarget)} aria-label="More music controls"><MoreHorizRounded /></IconButton></Tooltip>
        </Box>
      </Box>

      <Dialog open={expanded} onClose={() => setExpanded(false)} fullScreen PaperProps={{ className: 'now-playing' }}>
        <Box className="np-backdrop" style={{ backgroundImage: `linear-gradient(120deg, rgba(9,7,17,.86), rgba(9,7,17,.97)), url("${current.thumbnail || `/api/thumbnail/${current.id}`}")` }} />
        <Box className="np-shell">
          <Box className="np-header"><Button startIcon={<KeyboardArrowDownRounded />} onClick={() => setExpanded(false)}>Back</Button><Box><span>NOW PLAYING</span><strong dir="auto">{current.artist}</strong></Box><IconButton onClick={() => { setExpanded(false); onClose(); }} aria-label="Close player" title="Close player"><CloseRounded /></IconButton></Box>
          <Box className="np-main">
            <Box className="np-art-column">
              <img className="np-art" src={current.thumbnail || `/api/thumbnail/${current.id}`} alt="Album artwork" />
              <Box className="np-track"><Box><Typography variant="h4" fontWeight={800} dir="auto">{current.title}</Typography><button dir="auto" onClick={() => { setExpanded(false); onArtist(current.artistId, current.artist); }} disabled={!current.artistId}>{current.artist}</button></Box><IconButton onClick={onLike} color={liked ? 'primary' : 'default'} aria-label={liked ? 'Unlike song' : 'Like song'}>{liked ? <FavoriteRounded /> : <FavoriteBorderRounded />}</IconButton></Box>
              <Box className="np-seek"><Slider min={0} max={Math.max(duration, 1)} value={Math.min(elapsed, Math.max(duration, 1))} onChangeCommitted={seek} aria-label="Seek song" /><Box><span>{clock(elapsed)}</span><span>{clock(duration)}</span></Box></Box>
              <Box className="np-controls"><IconButton className={shuffle ? 'selected' : ''} onClick={onShuffle} aria-label="Shuffle" aria-pressed={shuffle}><ShuffleRounded /></IconButton><IconButton onClick={onPrevious} aria-label="Previous song"><SkipPreviousRounded /></IconButton>{playButton}<IconButton onClick={onNext} aria-label="Next song"><SkipNextRounded /></IconButton><IconButton className={repeat !== 'off' ? 'selected' : ''} onClick={onRepeat} aria-label="Repeat" aria-pressed={repeat !== 'off'}>{repeat === 'one' ? <RepeatOneRounded /> : <RepeatRounded />}</IconButton></Box>
              <Box className="np-secondary"><Box className="np-volume"><IconButton onClick={onMute} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? <VolumeOffRounded /> : <VolumeUpRounded />}</IconButton><Slider min={0} max={1} step={0.01} value={muted ? 0 : volume} onChange={(_event, value) => onVolume(Number(value))} aria-label="Volume" /></Box><Button onClick={(event) => setSpeedAnchor(event.currentTarget)}>{rate}× speed</Button><IconButton onClick={(event) => setSleepAnchor(event.currentTarget)} aria-label="Sleep timer" title="Sleep timer" className={sleep ? 'selected' : ''}><BedtimeRounded /></IconButton><IconButton onClick={() => onDownload(current)} aria-label="Download audio" title="Download audio"><DownloadRounded /></IconButton></Box>
              <Typography className="np-status" variant="caption">{status}{sleep ? ` · Sleep ${sleep === 'track' ? 'after this song' : 'timer on'}` : ''}</Typography>
            </Box>
            <Box className="np-side"><Box className="np-tabs" role="tablist" aria-label="Now playing panels">{[['lyrics', 'Lyrics', LyricsRounded], ['queue', 'Up next', PlaylistPlayRounded], ['details', 'Details', GraphicEqRounded]].map(([id, label, Icon]) => <button key={id} role="tab" aria-selected={panel === id} className={panel === id ? 'active' : ''} onClick={() => setPanel(id)}><Icon fontSize="small" />{label}</button>)}</Box>
              <Box className="np-panel" role="tabpanel">
                {panel === 'lyrics' && <LyricsPanel lyrics={lyrics} loading={lyricsLoading} elapsed={elapsed} offset={lyricsOffset} onOffset={onLyricsOffset} onSeek={onSeek} />}
                {panel === 'queue' && <Box className="np-queue"><Box className="np-panel-top"><span>{queue.length} songs in queue</span></Box>{queue.map((song, index) => <Box key={`${song.id}-${index}`} className={`np-queue-row ${song.id === current.id ? 'current' : ''}`}><button onClick={() => onPlayQueue(index)}><img src={song.thumbnail || `/api/thumbnail/${song.id}`} alt="" /><span><strong dir="auto">{song.title}</strong><small dir="auto">{song.artist}</small></span></button><IconButton size="small" disabled={index === 0} onClick={() => onMoveQueue(index, index - 1)} aria-label={`Move ${song.title} up`}><ArrowUpwardRounded fontSize="small" /></IconButton><IconButton size="small" disabled={index === queue.length - 1} onClick={() => onMoveQueue(index, index + 1)} aria-label={`Move ${song.title} down`}><ArrowDownwardRounded fontSize="small" /></IconButton><IconButton size="small" onClick={() => onRemoveQueue(index)} aria-label={`Remove ${song.title} from queue`}><CloseRounded fontSize="small" /></IconButton></Box>)}</Box>}
                {panel === 'details' && <Box className="np-details"><Typography variant="h6" fontWeight={700}>Track details</Typography>{[['Title', current.title], ['Artist', current.artist], ['Album', current.album], ['Year', current.year], ['Length', clock(duration || current.duration)], ['Playback', 'AAC · HLS stream'], ['Source', 'YouTube Music']].filter(([, value]) => value).map(([label, value]) => <Box key={label}><span>{label}</span><strong dir="auto">{value}</strong></Box>)}<Button href={`https://music.youtube.com/watch?v=${current.id}`} target="_blank" rel="noreferrer">Open source</Button></Box>}
              </Box>
            </Box>
          </Box>
        </Box>
      </Dialog>

      <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}><MenuItem onClick={() => openPanel('lyrics')}>Lyrics</MenuItem><MenuItem onClick={() => openPanel('queue')}>Up next</MenuItem><MenuItem onClick={() => openPanel('details')}>Track details</MenuItem><MenuItem onClick={() => { setSpeedAnchor(moreAnchor); setMoreAnchor(null); }}>Playback speed</MenuItem><MenuItem onClick={() => { setMoreAnchor(null); onLike(); }}>{liked ? 'Unlike song' : 'Like song'}</MenuItem><MenuItem onClick={() => { setMoreAnchor(null); onDownload(current); }}>Download audio</MenuItem></Menu>
      <Menu anchorEl={speedAnchor} open={Boolean(speedAnchor)} onClose={() => setSpeedAnchor(null)}>{rates.map((value) => <MenuItem key={value} selected={rate === value} onClick={() => { onRate(value); setSpeedAnchor(null); }}>{value}×</MenuItem>)}</Menu>
      <Menu anchorEl={sleepAnchor} open={Boolean(sleepAnchor)} onClose={() => setSleepAnchor(null)}>{[[0, 'Off'], [15, '15 minutes'], [30, '30 minutes'], [60, '60 minutes'], ['track', 'After this song']].map(([value, label]) => <MenuItem key={value} onClick={() => { onSleep(value); setSleepAnchor(null); }}>{label}</MenuItem>)}</Menu>
    </>}
  </>;
}
