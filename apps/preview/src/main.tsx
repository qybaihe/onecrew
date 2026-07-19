import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';
import './workbench.css';
import { OneCrewWorkbench } from './OneCrewWorkbench.js';

const root = document.getElementById('root');
if (!root) throw new Error('Preview root is missing');
createRoot(root).render(<StrictMode><OneCrewWorkbench /></StrictMode>);
