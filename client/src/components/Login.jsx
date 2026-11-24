import { useState } from 'react';
import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material';
import { api } from '../utils';

export default function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      onLogin();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <Box className="login-page">
    <Paper className="login-card" elevation={0} component="form" onSubmit={submit}>
      <img className="login-mark" src="/ytgrab-mark.png" alt="" />
      <Box className="login-heading"><Typography variant="h4" fontWeight={700}>YTgrab</Typography><Typography color="text.secondary">Your place.</Typography></Box>
      <TextField fullWidth type="password" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
      {error && <Alert severity="error">{error}</Alert>}
      <Button size="large" variant="contained" type="submit" disabled={busy}>{busy ? 'Opening…' : 'Come in'}</Button>
    </Paper>
  </Box>;
}
