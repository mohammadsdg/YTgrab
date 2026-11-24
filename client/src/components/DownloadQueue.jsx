import { Box, IconButton, LinearProgress, Paper, Typography } from '@mui/material';
import { CloseRounded, DownloadRounded } from '@mui/icons-material';

export default function DownloadQueue({ downloadJobs, setDownloadJobs }) {
  return <>
    {downloadJobs.length > 0 && <Paper className="download-queue" elevation={8}>
      <Box className="download-queue-heading"><DownloadRounded /><Typography fontWeight={800}>Downloads</Typography><Typography variant="caption" color="text.secondary">{downloadJobs.filter((job) => !['done', 'error'].includes(job.status)).length} active</Typography></Box>
      <Box className="download-queue-list">{downloadJobs.map((job) => <Box className="download-job" key={job.key}>
        <img src={job.video.thumbnail || `/api/thumbnail/${job.video.id}`} alt="" />
        <Box className="download-job-copy">
          <Typography variant="body2" fontWeight={700} noWrap>{job.video.title}</Typography>
          <Typography variant="caption" color={job.status === 'error' ? 'error' : 'text.secondary'} noWrap>{job.status === 'done' ? 'Ready' : job.status === 'error' ? job.error : `Downloading · ${Math.round(job.progress || 0)}%`}</Typography>
          {!['done', 'error'].includes(job.status) && <LinearProgress variant={job.progress ? 'determinate' : 'indeterminate'} value={job.progress || 0} />}
        </Box>
        {job.status === 'done' && <IconButton size="small" href={job.url} aria-label="Save download"><DownloadRounded fontSize="small" /></IconButton>}
        {['done', 'error'].includes(job.status) && <IconButton size="small" onClick={() => setDownloadJobs((current) => current.filter((item) => item.key !== job.key))} aria-label="Dismiss"><CloseRounded fontSize="small" /></IconButton>}
      </Box>)}</Box>
    </Paper>}

  </>;
}
