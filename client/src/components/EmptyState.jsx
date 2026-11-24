import { Box, Typography } from '@mui/material';

export default function EmptyState({ icon: Icon, title, text, action }) {
  return <Box className="empty-state">
    <Box className="empty-icon"><Icon /></Box>
    <Typography variant="h6" fontWeight={750}>{title}</Typography>
    <Typography color="text.secondary" maxWidth={360}>{text}</Typography>
    {action}
  </Box>;
}
