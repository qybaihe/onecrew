import { useState } from 'react';
import type { CreativeEntity } from '@onecrew/contracts';
import type { WorkbenchRoute } from './workbench-model.js';
import type { WorkbenchData } from './OneCrewWorkbench.js';
import { navigateTo } from './workbench-model.js';

type AssetFilter = 'all' | 'character' | 'scene' | 'prop' | 'history';

const FILTER_LABELS: Array<{ id: AssetFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'character', label: '角色' },
  { id: 'scene', label: '场景' },
  { id: 'prop', label: '道具' },
  { id: 'history', label: '版本历史' },
];

const KIND_LABELS: Record<CreativeEntity['kind'], string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
};

function filterFromRoute(route: WorkbenchRoute): AssetFilter {
  if (route === 'asset-character') return 'character';
  if (route === 'asset-scene') return 'scene';
  if (route === 'asset-prop') return 'prop';
  if (route === 'asset-history') return 'history';
  return 'all';
}

export function AssetsHubPage({ data, route }: { data: WorkbenchData; route: WorkbenchRoute }) {
  const [filter, setFilter] = useState<AssetFilter>(() => filterFromRoute(route));
  const entities = data.project?.bundle.entities ?? [];
  const assets = data.project?.assets ?? [];
  const filteredEntities = filter === 'all' ? entities : filter === 'history' ? [] : entities.filter((e) => e.kind === filter);

  return (
    <>
      <div className="oc-page-header">
        <h1>资产库</h1>
        <p>角色、场景、道具设定与受控媒体版本。</p>
      </div>

      <div className="oc-stats">
        <div className="oc-stat">
          <div className="oc-stat-label">设定实体</div>
          <div className="oc-stat-value">{entities.length}</div>
          <div className="oc-stat-detail">{entities.filter((e) => e.status === 'ready').length} 个就绪</div>
        </div>
        <div className="oc-stat">
          <div className="oc-stat-label">媒体版本</div>
          <div className="oc-stat-value">{assets.length}</div>
          <div className="oc-stat-detail">{assets.filter((a) => a.status === 'approved').length} 个已批准</div>
        </div>
        <div className="oc-stat">
          <div className="oc-stat-label">角色</div>
          <div className="oc-stat-value">{entities.filter((e) => e.kind === 'character').length}</div>
        </div>
        <div className="oc-stat">
          <div className="oc-stat-label">场景 / 道具</div>
          <div className="oc-stat-value">{entities.filter((e) => e.kind !== 'character').length}</div>
        </div>
      </div>

      <div className="oc-filters">
        {FILTER_LABELS.map((f) => (
          <button key={f.id} className={filter === f.id ? 'oc-filter-btn active' : 'oc-filter-btn'} type="button" onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="oc-btn small" type="button" onClick={() => navigateTo('asset-search')}>全局复用</button>
        <button className="oc-btn small" type="button" onClick={() => navigateTo('asset-split')}>组合图拆分</button>
      </div>

      {filter === 'history' ? (
        <div className="oc-card">
          <div className="oc-card-header"><h2>版本资产记录</h2><span className="subtitle">{assets.length} 条</span></div>
          <div className="oc-card-body" style={{ padding: 0 }}>
            <div className="oc-table-wrap">
              <table className="oc-table">
                <thead><tr><th>资产</th><th>类型</th><th>版本</th><th>Provider</th><th>状态</th></tr></thead>
                <tbody>
                  {assets.map((asset) => (
                    <tr key={asset.assetId}>
                      <td><strong>{asset.creativeRole ?? asset.assetId}</strong></td>
                      <td>{asset.type}</td>
                      <td className="mono">v{asset.version}</td>
                      <td>{asset.provider}<small>{asset.model}</small></td>
                      <td><span className={`oc-chip ${asset.status === 'approved' ? 'ok' : 'plain'}`}>{asset.status}</span></td>
                    </tr>
                  ))}
                  {assets.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--oc-fg-muted)' }}>暂无版本资产</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : filteredEntities.length === 0 ? (
        <div className="oc-empty"><h3>暂无{filter === 'all' ? '' : KIND_LABELS[filter as CreativeEntity['kind']] ?? ''}素材</h3><p>通过故事规划或手动创建设定实体。</p></div>
      ) : (
        <div className="oc-asset-grid">
          {filteredEntities.map((entity) => (
            <button
              key={entity.entityId}
              className="oc-asset-card"
              type="button"
              onClick={() => navigateTo(entity.kind === 'character' ? 'asset-character' : entity.kind === 'scene' ? 'asset-scene' : 'asset-prop')}
            >
              <div className={`oc-asset-mark ${entity.kind}`}>{entity.name.slice(0, 1)}</div>
              <div>
                <h3>{entity.name}</h3>
                <p>{entity.description ?? entity.prompt ?? '等待补充设定'}</p>
                <small>{KIND_LABELS[entity.kind]} · {entity.referenceAssetIds.length} 个参考 · {entity.extraAssetIds.length} 个扩展</small>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
