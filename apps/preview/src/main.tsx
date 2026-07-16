import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';

const ReviewApp = lazy(async () => {
  const module = await import('./ReviewApp.js');
  return { default: module.ReviewApp };
});
const StudioApp = lazy(async () => {
  const module = await import('./StudioApp.js');
  return { default: module.StudioApp };
});

type AppMode = 'studio' | 'review';

function modeFromHash(): AppMode {
  return window.location.hash === '#review' ? 'review' : 'studio';
}

function OneCrewApp() {
  const [mode, setMode] = useState<AppMode>(modeFromHash);

  useEffect(() => {
    const onHashChange = () => setMode(modeFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    document.title = mode === 'studio' ? 'OneCrew · 创作台' : 'OneCrew · 成片审阅';
  }, [mode]);

  const navigate = (next: AppMode) => {
    window.location.hash = next;
    setMode(next);
  };

  return (
    <Suspense fallback={<div className="app-loading"><span />正在加载 OneCrew…</div>}>
      {mode === 'review'
        ? <ReviewApp onOpenStudio={() => navigate('studio')} />
        : <StudioApp onOpenReview={() => navigate('review')} />}
    </Suspense>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Preview root is missing');
createRoot(root).render(<StrictMode><OneCrewApp /></StrictMode>);
