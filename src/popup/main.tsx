import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/app.css';
import { brand } from '@/config/brand';
import { applyTheme } from '@/app/stores/ui';
import { loadSettings } from '@/storage/settings';
import { Popup } from './Popup';

document.title = brand.name;
applyTheme('system');
// Follow the theme chosen in the workspace once settings are read.
loadSettings()
  .then((settings) => applyTheme(settings.theme))
  .catch(() => undefined);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
