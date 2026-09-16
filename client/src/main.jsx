import React from 'react';
import { createRoot } from 'react-dom/client';
import { createTheme, CssBaseline, ThemeProvider } from '@mui/material';
import App from './App';
import './styles.css';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#ef4b59', contrastText: '#ffffff' },
    secondary: { main: '#328372' },
    background: { default: '#f6f4ef', paper: '#ffffff' },
    text: { primary: '#24221f', secondary: '#756f66' }
  },
  typography: {
    fontFamily: "ui-rounded, 'Segoe UI', system-ui, sans-serif",
    button: { textTransform: 'none', fontWeight: 700 }
  },
  shape: { borderRadius: 14 },
  components: {
    MuiButton: { styleOverrides: { root: { borderRadius: 12 } } },
    MuiDialog: { styleOverrides: { paper: { backgroundImage: 'none' } } }
  }
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode><ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider></React.StrictMode>
);
