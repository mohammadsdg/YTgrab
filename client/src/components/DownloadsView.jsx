import { useState } from 'react';
import { Box, Button, IconButton, LinearProgress, Typography } from '@mui/material';
import { DeleteOutlineRounded, DownloadRounded, GraphicEqRounded, MovieRounded, ReplayRounded } from '@mui/icons-material';

export default function DownloadsView({ files, jobs = [], onDelete, onRetry }) {
  const [openFile, setOpenFile] = useState('');
  const audio = files.filter((file) => file.quality === 'audio' || /\.(m4a|mp3|aac|opus|ogg)$/i.test(file.name));
  const videos = files.filter((file) => !audio.includes(file));
  const active = jobs.filter((job) => !['done', 'error'].includes(job.status));
  const failed = jobs.filter((job) => job.status === 'error');
  const section = (title, items, Icon) => <section className="saved-media-section" key={title}>
    <Box className="saved-media-heading"><Icon /><Typography variant="h6" fontWeight={700}>{title}</Typography><small>{items.length}</small></Box>
    {items.length ? <Box className="saved-media-list">{items.map((file) => <Box className="saved-media-row" key={file.name}>
      {file.thumbnail ? <img src={file.thumbnail} alt="" loading="lazy" /> : <Box className="saved-media-placeholder"><Icon /></Box>}
      <Box className="saved-media-copy"><strong dir="auto">{file.title || file.name}</strong><small dir="auto">{file.channel || 'Saved media'} · {(file.size / 1048576).toFixed(1)} MB</small></Box>
      <Button size="small" onClick={() => setOpenFile(openFile === file.name ? '' : file.name)}>{openFile === file.name ? 'Close' : 'Play'}</Button>
      <IconButton href={file.url} aria-label={`Download ${file.title || file.name}`}><DownloadRounded /></IconButton>
      <IconButton color="error" onClick={() => { if (window.confirm(`Delete ${file.title || file.name}?`)) onDelete(file); }} aria-label={`Delete ${file.title || file.name}`}><DeleteOutlineRounded /></IconButton>
      {openFile === file.name && (audio.includes(file) ? <audio className="saved-media-playback" controls preload="none" src={file.playUrl} /> : <video className="saved-media-playback" controls preload="none" src={file.playUrl} />)}
    </Box>)}</Box> : <Typography color="text.secondary" className="saved-media-empty">Nothing saved here yet.</Typography>}
  </section>;
  return <Box className="downloads-view">
    <Box className="page-heading"><Typography variant="h4" fontWeight={700}>Downloads</Typography><Typography color="text.secondary">Media saved on this server.</Typography></Box>
    {!!active.length && <section className="saved-media-section"><Typography variant="h6" fontWeight={700}>In progress</Typography>{active.map((job) => <Box className="saved-job" key={job.key}><span dir="auto">{job.video?.title || 'Download'}</span><LinearProgress variant={job.progress ? 'determinate' : 'indeterminate'} value={job.progress || 0} /><small>{job.status === 'processing' ? `${Math.round(job.progress || 0)}%` : 'Starting…'}</small></Box>)}</section>}
    {!!failed.length && <section className="saved-media-section"><Typography variant="h6" fontWeight={700}>Needs attention</Typography>{failed.map((job) => <Box className="saved-failed" key={job.key}><span dir="auto">{job.video?.title || 'Download'} · {job.error || 'Download failed.'}</span><Button size="small" startIcon={<ReplayRounded />} onClick={() => onRetry(job)}>Retry</Button></Box>)}</section>}
    {section('Music', audio, GraphicEqRounded)}
    {section('Videos', videos, MovieRounded)}
  </Box>;
}
