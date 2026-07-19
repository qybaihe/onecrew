/** OneCrew Workbench navigation model – 5 primary sections + deep route compat. */

export type PrimarySection = 'dashboard' | 'planning' | 'production' | 'assets' | 'delivery';

/** All legacy routes kept for backward-compatible hash navigation. */
export type WorkbenchRoute =
  | PrimarySection
  // Legacy deep routes (still resolvable, not shown in primary nav)
  | 'projects'
  | 'project-overview'
  | 'project-settings'
  | 'project-transfer'
  | 'studio'
  | 'regional-localization'
  | 'budget-agent'
  | 'story-plan'
  | 'story-plan-confirm'
  | 'episodes'
  | 'script-editor'
  | 'shots'
  | 'shot-canvas'
  | 'shot-detail'
  | 'shot-generate'
  | 'shot-batches'
  | 'asset-character'
  | 'asset-scene'
  | 'asset-prop'
  | 'asset-history'
  | 'asset-split'
  | 'asset-search'
  | 'jobs'
  | 'job-batch'
  | 'qc'
  | 'qc-detail'
  | 'renders'
  | 'render-detail'
  | 'localization'
  | 'locale-detail'
  | 'review'
  | 'review-compare'
  | 'promo'
  | 'release'
  | 'releases'
  | 'experiments'
  | 'experiment-detail'
  | 'providers'
  | 'infra'
  | 'budget'
  | 'audit';

export interface NavigationItem {
  section: PrimarySection;
  label: string;
  description: string;
  icon: string;
}

export const PRIMARY_NAVIGATION: NavigationItem[] = [
  { section: 'dashboard', label: '工作台', description: '项目状态、进度与下一步', icon: 'grid' },
  { section: 'planning', label: '策划', description: '地域本土化、预算策略与故事规划', icon: 'compass' },
  { section: 'production', label: '制作', description: '剧本、分镜与生成', icon: 'film' },
  { section: 'assets', label: '资产', description: '角色、场景、道具与版本', icon: 'layers' },
  { section: 'delivery', label: '交付', description: '审片、渲染、发布与实验', icon: 'send' },
];

/** Map legacy routes to their primary section for nav highlighting. */
const ROUTE_TO_SECTION: Record<string, PrimarySection> = {
  dashboard: 'dashboard',
  projects: 'dashboard',
  'project-overview': 'dashboard',
  'project-settings': 'dashboard',
  'project-transfer': 'dashboard',
  studio: 'dashboard',
  jobs: 'dashboard',
  'job-batch': 'dashboard',
  planning: 'planning',
  'regional-localization': 'planning',
  'budget-agent': 'planning',
  'story-plan': 'planning',
  'story-plan-confirm': 'planning',
  production: 'production',
  episodes: 'production',
  'script-editor': 'production',
  shots: 'production',
  'shot-canvas': 'production',
  'shot-detail': 'production',
  'shot-generate': 'production',
  'shot-batches': 'production',
  assets: 'assets',
  'asset-character': 'assets',
  'asset-scene': 'assets',
  'asset-prop': 'assets',
  'asset-history': 'assets',
  'asset-split': 'assets',
  'asset-search': 'assets',
  delivery: 'delivery',
  review: 'delivery',
  'review-compare': 'delivery',
  renders: 'delivery',
  'render-detail': 'delivery',
  promo: 'delivery',
  localization: 'delivery',
  'locale-detail': 'delivery',
  release: 'delivery',
  releases: 'delivery',
  experiments: 'delivery',
  'experiment-detail': 'delivery',
  providers: 'dashboard',
  infra: 'dashboard',
  budget: 'dashboard',
  audit: 'dashboard',
  qc: 'production',
  'qc-detail': 'production',
};

const ALL_ROUTES = Object.keys(ROUTE_TO_SECTION) as WorkbenchRoute[];

export function routeFromHash(hash: string): WorkbenchRoute {
  const candidate = hash.replace(/^#\/?/, '').split('?')[0];
  // Map old 'studio' default to new 'dashboard'
  if (!candidate || candidate === 'studio') return 'dashboard';
  return (ALL_ROUTES as string[]).includes(candidate) ? (candidate as WorkbenchRoute) : 'dashboard';
}

export function sectionForRoute(route: WorkbenchRoute): PrimarySection {
  return ROUTE_TO_SECTION[route] ?? 'dashboard';
}

export function navigateTo(route: WorkbenchRoute): void {
  window.location.hash = `#/${route}`;
}

export function routeLabel(route: WorkbenchRoute): string {
  const labels: Partial<Record<WorkbenchRoute, string>> = {
    dashboard: '工作台',
    planning: '策划',
    production: '制作',
    assets: '资产',
    delivery: '交付',
    'regional-localization': '地域本土化',
    'budget-agent': '出海预算',
    'story-plan': '故事规划',
    'project-transfer': '工程导入导出',
    review: '审片',
    renders: '渲染',
    release: '发布',
    experiments: '实验',
    providers: 'Provider 状态',
    infra: '基础设施',
    budget: '预算与审批',
    audit: '操作日志',
    jobs: '任务中心',
    qc: 'QC 质检',
  };
  return labels[route] ?? route;
}
