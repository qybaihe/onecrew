import { Suspense, lazy, useState } from 'react';
import type { WorkbenchRoute } from './workbench-model.js';
import type { WorkbenchData } from './OneCrewWorkbench.js';
import type { StudioFocus } from './StudioApp.js';
import { navigateTo } from './workbench-model.js';

const StudioApp = lazy(async () => ({ default: (await import('./StudioApp.js')).StudioApp }));

type ProductionTab = 'script' | 'shots' | 'generate' | 'entities';

const TABS: Array<{ id: ProductionTab; label: string; desc: string }> = [
  { id: 'script', label: '剧本管理', desc: '剧集列表与剧本编辑' },
  { id: 'shots', label: '分镜工作台', desc: '分镜列表、画布与参数编辑' },
  { id: 'generate', label: '生成任务', desc: '单镜生成、批量与工作流组' },
  { id: 'entities', label: '素材设定', desc: '角色、场景、道具管理' },
];

const TAB_FOCUS: Record<ProductionTab, StudioFocus> = {
  script: 'script-editor',
  shots: 'shot-detail',
  generate: 'shot-batches',
  entities: 'asset-character',
};

function tabFromRoute(route: WorkbenchRoute): ProductionTab {
  if (route === 'script-editor' || route === 'episodes') return 'script';
  if (route === 'shot-canvas' || route === 'shot-detail' || route === 'shots') return 'shots';
  if (route === 'shot-generate' || route === 'shot-batches') return 'generate';
  if (route.startsWith('asset-')) return 'entities';
  return 'script';
}

export function ProductionPage({ data, route }: { data: WorkbenchData; route: WorkbenchRoute }) {
  const [tab, setTab] = useState<ProductionTab>(() => tabFromRoute(route));
  const focus = TAB_FOCUS[tab];

  return (
    <div style={{ margin: '-28px -32px -72px' }}>
      {/* Sub navigation */}
      <div className="oc-prod-nav">
        <div className="oc-prod-nav-inner">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? 'oc-prod-tab active' : 'oc-prod-tab'}
              onClick={() => setTab(t.id)}
            >
              <strong>{t.label}</strong>
              <small>{t.desc}</small>
            </button>
          ))}
        </div>
      </div>

      {/* Studio content with tab-scoped visibility */}
      <div className={`oc-prod-body oc-prod-${tab}`}>
        <Suspense fallback={<div className="oc-empty"><div className="oc-spinner" /><h3>加载制作空间</h3></div>}>
          <StudioApp
            embedded
            focus={focus}
            {...(data.selectedProjectId ? { initialProjectId: data.selectedProjectId } : {})}
            onProjectChange={data.selectProject}
            onOpenReview={() => navigateTo('review')}
          />
        </Suspense>
      </div>
    </div>
  );
}
