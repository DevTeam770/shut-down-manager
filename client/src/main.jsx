import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import { NotifyProvider } from './context/NotifyContext.jsx';
import { ConfirmProvider } from './context/ConfirmContext.jsx';
import './styles/app.css';

// מצב תצוגה (בהיר/כהה) נשמר מקומית
const savedTheme = localStorage.getItem('theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

// PWA: רישום service worker בפרודקשן — התקנה כאפליקציה + עמידות לניתוקים רגעיים
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SocketProvider>
          <NotifyProvider>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </NotifyProvider>
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
