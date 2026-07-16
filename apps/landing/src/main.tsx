import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { LandingPage } from './LandingPage.js';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Landing root is missing');

createRoot(root).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
);
