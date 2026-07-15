import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CompositionId } from '@onecrew/contracts';
import { createFixtureInput } from '@onecrew/remotion/fixtures';
import { PreviewPlayer } from '@onecrew/remotion/preview';

import { compositionOptions, optionFor } from './composition-options.js';
import './styles.css';

function PreviewApp() {
  const [selectedId, setSelectedId] = useState<CompositionId>('EpisodeMaster');
  const input = useMemo(() => createFixtureInput(selectedId), [selectedId]);
  const selected = optionFor(selectedId);
  const manifest = input.manifest;
  const isMock = manifest.shots.every((shot) => shot.videoUri.startsWith('mock://'));

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#preview" aria-label="OneCrew 预览页首页">
          <span className="brand-mark" aria-hidden="true">✦</span>
          <span>
            <strong>ONECREW</strong>
            <small>REMOTION PREVIEW</small>
          </span>
        </a>
        <div className="read-only"><span aria-hidden="true" /> 只读预览</div>
      </header>

      <main id="preview" className="workspace">
        <aside className="rail" aria-label="Composition 列表">
          <div className="rail-heading">
            <p>DELIVERABLES</p>
            <h1>成片规格</h1>
          </div>
          <nav className="composition-list">
            {compositionOptions.map((option, index) => (
              <button
                key={option.id}
                className={option.id === selectedId ? 'composition active' : 'composition'}
                type="button"
                aria-pressed={option.id === selectedId}
                onClick={() => setSelectedId(option.id)}
              >
                <span className="index">{String(index + 1).padStart(2, '0')}</span>
                <span className="composition-copy">
                  <small>{option.eyebrow}</small>
                  <strong>{option.label}</strong>
                </span>
                <span className="spec">{option.duration}<br />{option.format}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section className="stage" aria-labelledby="stage-title">
          <div className="stage-heading">
            <div>
              <p>{selected.eyebrow} · {manifest.locale}</p>
              <h2 id="stage-title">{manifest.localePack.title}</h2>
            </div>
            <div className="mode-badges" aria-label="预览状态">
              <span className="badge preview">PREVIEW</span>
              <span className={isMock ? 'badge mock' : 'badge'}>{isMock ? 'MOCK ASSETS' : 'CONTROLLED ASSETS'}</span>
            </div>
          </div>

          <div className={`player-frame ratio-${manifest.aspectRatio.replace(':', '-')}`}>
            <div className="corner top-left" aria-hidden="true" />
            <div className="corner bottom-right" aria-hidden="true" />
            <PreviewPlayer input={input} />
          </div>

          <dl className="manifest-strip">
            <div><dt>COMPOSITION</dt><dd>{manifest.compositionId}</dd></div>
            <div><dt>CANVAS</dt><dd>{manifest.output.width} × {manifest.output.height}</dd></div>
            <div><dt>FRAME RATE</dt><dd>{manifest.fps} FPS</dd></div>
            <div><dt>DESIGN PACK</dt><dd>{manifest.designPack.version}</dd></div>
            <div><dt>LOCALE</dt><dd>{manifest.locale}</dd></div>
          </dl>

          <footer className="notice">
            <span className="notice-mark" aria-hidden="true">i</span>
            <p><strong>审片环境</strong>此页只播放经过 RenderManifest 和 Design Pack 验证的 Remotion Composition，不提供项目状态或审批操作。</p>
          </footer>
        </section>
      </main>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Preview root is missing');
createRoot(root).render(<StrictMode><PreviewApp /></StrictMode>);
