import { Box, Button, Chip, Paper, Stack, Switch, Typography } from '@mui/material';
import { AutoAwesomeRounded, DarkModeRounded, LogoutRounded, UploadRounded, WallpaperRounded } from '@mui/icons-material';
import { api } from '../utils';

export default function SettingsPanel({ mode, setMode, performanceMode, performanceBusy, changePerformanceMode, backgroundBusy, uploadBackground, resetBackground, setAuth }) {
  return <>
        <Typography variant="h4" fontWeight={700} mb={3}>Settings</Typography>
        <Paper className="settings-card" elevation={0}>
          <DarkModeRounded />
          <Box flex={1}><Typography fontWeight={700}>Dark mode</Typography><Typography color="text.secondary" variant="body2">Use the dark interface.</Typography></Box>
          <Switch checked={mode === 'dark'} onChange={(event) => setMode(event.target.checked ? 'dark' : 'light')} />
        </Paper>
        <Paper className="settings-card performance-setting" elevation={0}>
          <AutoAwesomeRounded />
          <Box flex={1}><Typography fontWeight={700}>Server load</Typography><Typography color="text.secondary" variant="body2">Heavy mode loads more videos and warms the feed when the server starts. Chill mode uses fewer resources.</Typography></Box>
          <Stack direction="row" spacing={1} className="performance-buttons">
            <Button variant={performanceMode === 'chill' ? 'contained' : 'outlined'} disabled={performanceBusy} onClick={() => changePerformanceMode('chill')}>Chill</Button>
            <Button variant={performanceMode === 'heavy' ? 'contained' : 'outlined'} disabled={performanceBusy} onClick={() => changePerformanceMode('heavy')}>Heavy</Button>
          </Stack>
        </Paper>
        <Paper className="settings-card background-setting" elevation={0}>
          <WallpaperRounded />
          <Box flex={1}><Typography fontWeight={700}>Background</Typography><Typography color="text.secondary" variant="body2">Use any JPEG, PNG, or WebP image. It stays on this server.</Typography></Box>
          <Stack direction="row" spacing={1}>
            <Button component="label" variant="outlined" startIcon={<UploadRounded />} disabled={backgroundBusy}>
              Choose image
              <input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadBackground} />
            </Button>
            <Button onClick={resetBackground} disabled={backgroundBusy}>Reset</Button>
          </Stack>
        </Paper>
        <Paper className="settings-card" elevation={0}>
          <Box className="telegram-orb">✈</Box>
          <Box flex={1}><Typography fontWeight={800}>Telegram companion</Typography><Typography color="text.secondary" variant="body2">Search, download, and receive links from your private bot.</Typography></Box>
          <Chip color="success" label="Runs with YTgrab" />
        </Paper>
        <Paper className="settings-card" elevation={0}>
          <Box flex={1}><Typography fontWeight={800}>Sign out</Typography><Typography color="text.secondary" variant="body2">End this browser session.</Typography></Box>
          <Button color="error" startIcon={<LogoutRounded />} onClick={async () => { await api('/api/logout', { method: 'POST' }); setAuth(false); }}>Log out</Button>
        </Paper>
  </>;
}
