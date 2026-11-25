import { useState } from 'react';
import { Box, Button, Paper, Stack, Switch, Typography } from '@mui/material';
import { AutoAwesomeRounded, DarkModeRounded, GitHub, LogoutRounded, StorageRounded, UploadRounded, WallpaperRounded } from '@mui/icons-material';
import { api } from '../utils';

export default function SettingsPanel({ mode, setMode, performanceMode, performanceBusy, changePerformanceMode, backgroundBusy, uploadBackground, resetBackground, setAuth }) {
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagnosticsError, setDiagnosticsError] = useState('');
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const loadDiagnostics = async (event) => {
    if (!event.currentTarget.open || diagnosticsLoading) return;
    setDiagnosticsLoading(true);
    try { setDiagnostics(await api('/api/diagnostics')); setDiagnosticsError(''); }
    catch (error) { setDiagnosticsError(error.message); }
    finally { setDiagnosticsLoading(false); }
  };
  const size = (bytes) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;
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
        </Paper>
        <Paper className="settings-card" elevation={0}>
          <Box flex={1}><Typography fontWeight={800}>Sign out</Typography><Typography color="text.secondary" variant="body2">End this browser session.</Typography></Box>
          <Button color="error" startIcon={<LogoutRounded />} onClick={async () => { await api('/api/logout', { method: 'POST' }); setAuth(false); }}>Log out</Button>
        </Paper>
        <details className="diagnostics-panel" onToggle={loadDiagnostics}>
          <summary><StorageRounded fontSize="small" /> Server diagnostics</summary>
          {diagnosticsLoading && <Typography color="text.secondary">Checking server…</Typography>}
          {diagnosticsError && <Typography color="error">{diagnosticsError}</Typography>}
          {diagnostics && <Box className="diagnostics-list">
            <p><span>yt-dlp</span><strong>{diagnostics.tools.ytDlp ? 'Available' : 'Unavailable'}</strong></p>
            <p><span>FFmpeg</span><strong>{diagnostics.tools.ffmpeg ? 'Available' : 'Unavailable'}</strong></p>
            <p><span>Saved media</span><strong>{size(diagnostics.storage.saved.bytes)}</strong></p>
            <p><span>Temporary stream cache</span><strong>{size(diagnostics.storage.cache.bytes)} / {size(diagnostics.storage.cacheLimitBytes)}</strong></p>
            <p><span>Active jobs</span><strong>{diagnostics.jobs.streams} streams · {diagnostics.jobs.downloads} downloads</strong></p>
            <p><span>Failed downloads</span><strong>{diagnostics.jobs.failedDownloads}</strong></p>
            {(diagnostics.storage.saved.partial || diagnostics.storage.cache.partial) && <small>Storage scan was capped at 20,000 files.</small>}
            <Button size="small" onClick={() => { setDiagnostics(null); loadDiagnostics({ currentTarget: { open: true } }); }}>Refresh</Button>
          </Box>}
        </details>
        <Button href="https://github.com/mohammadsdg/Ytgrab" target="_blank" rel="noreferrer" startIcon={<GitHub />}>YTgrab on GitHub</Button>
  </>;
}
