import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import '@fontsource-variable/inter';
import 'bootstrap/dist/css/bootstrap.min.css';
import './platform/styles.css';
import App from './App';
import { AuthProvider } from './platform/auth';
import ErrorBoundary from './platform/components/ErrorBoundary';
import { startMonitoring } from './platform/monitoring';
import { applyTheme, systemTheme } from './platform/preferences';

applyTheme(systemTheme());
void startMonitoring();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
