import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/app.css';
import { brand } from '@/config/brand';
import { applyFeel, applyTheme } from '@/app/stores/ui';
import { installUiSounds } from '@/app/services/sfx';
import { loadSettings } from '@/storage/settings';
import { Popup } from './Popup';

document.title = brand.name;
applyTheme('system');
// Follow the theme chosen in the workspace once settings are read.
installUiSounds();
loadSettings()
  .then((settings) => {
    applyTheme(settings.theme);
    applyFeel(settings);
  })
  .catch(() => undefined);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
