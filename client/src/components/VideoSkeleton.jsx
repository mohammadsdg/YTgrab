import { Box } from '@mui/material';

export default function VideoSkeleton({ count = 8 }) {
  return <Box className="video-grid" aria-label="Loading videos" aria-busy="true">
    {Array.from({ length: count }, (_, index) => <Box className="video-skeleton" key={index}>
      <Box className="video-skeleton-image" />
      <Box className="video-skeleton-line" />
      <Box className="video-skeleton-line short" />
    </Box>)}
  </Box>;
}
