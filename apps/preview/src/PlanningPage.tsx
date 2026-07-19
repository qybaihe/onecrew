import { useState } from 'react';
import type { WorkbenchRoute } from './workbench-model.js';
import type { WorkbenchData } from './OneCrewWorkbench.js';
import { RegionalLocalizationPage } from './RegionalLocalizationPage.js';
import { BudgetAllocationPage } from './BudgetAllocationPage.js';
import { StoryPlanStep } from './StoryPlanStep.js';

type PlanningStep = 'regional' | 'budget' | 'story';

const STEPS: Array<{ id: PlanningStep; label: string }> = [
  { id: 'regional', label: '地域本土化' },
  { id: 'budget', label: '预算策略' },
  { id: 'story', label: '故事规划' },
];

function stepFromRoute(route: WorkbenchRoute): PlanningStep {
  if (route === 'budget-agent') return 'budget';
  if (route === 'story-plan' || route === 'story-plan-confirm') return 'story';
  return 'regional';
}

export function PlanningPage({ data, route }: { data: WorkbenchData; route: WorkbenchRoute }) {
  const [step, setStep] = useState<PlanningStep>(() => stepFromRoute(route));

  return (
    <>
      <div className="oc-page-header">
        <h1>策划</h1>
        <p>地域本土化、预算策略与故事规划 — 按顺序完成出海策划流程。</p>
      </div>

      <div className="oc-steps">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={step === s.id ? 'oc-step active' : 'oc-step'}
            onClick={() => setStep(s.id)}
          >
            <span className="oc-step-num">{i + 1}</span>
            <span className="oc-step-label">{s.label}</span>
          </button>
        ))}
      </div>

      {step === 'regional' && (
        <RegionalLocalizationPage
          {...(data.selectedProjectId ? { projectId: data.selectedProjectId } : {})}
          {...(data.project ? { project: data.project } : {})}
          onRefresh={() => data.refresh()}
          onOpenStoryPlan={() => setStep('story')}
        />
      )}
      {step === 'budget' && (
        <BudgetAllocationPage
          {...(data.selectedProjectId ? { projectId: data.selectedProjectId } : {})}
          {...(data.project ? { project: data.project } : {})}
          onRefresh={() => data.refresh()}
        />
      )}
      {step === 'story' && (
        <StoryPlanStep data={data} />
      )}
    </>
  );
}
