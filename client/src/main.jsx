import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createTheme, CssBaseline, ThemeProvider } from '@mui/material';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/700.css';
import App from './App';
import './styles.css';

function Root() {
  const [mode, setMode] = useState(() => localStorage.getItem('ytgrab_theme') || 'dark');

  useEffect(() => {
    localStorage.setItem('ytgrab_theme', mode);
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  const theme = useMemo(() => createTheme({
    palette: {
      mode,
      primary: { main: '#ff4e45' },
      background: mode === 'dark'
        ? { default: '#0e0e0f', paper: '#18181a' }
        : { default: '#f7f7f6', paper: '#ffffff' },
      text: mode === 'dark'
        ? { primary: '#f4f4f2', secondary: '#a4a4a0' }
        : { primary: '#181817', secondary: '#696966' }
    },
    typography: {
      fontFamily: 'Vazirmatn, system-ui, sans-serif',
      button: { textTransform: 'none', fontWeight: 600 }
    },
    shape: { borderRadius: 10 },
    components: {
      MuiButton: { styleOverrides: { root: { borderRadius: 9 } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } }
    }
  }), [mode]);

  return <ThemeProvider theme={theme}><CssBaseline /><App mode={mode} setMode={setMode} /></ThemeProvider>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><Root /></React.StrictMode>);
