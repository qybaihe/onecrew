import {
  vlmProviderOutputSchema,
  type QcRunRequest,
  type TechnicalQcReport,
  type VlmProviderOutput,
} from '@onecrew/contracts';

export interface QcPolicyDecision {
  decision: VlmProviderOutput['decision'];
  reason: string;
  retryPatch?: Record<string, unknown>;
  needsHuman: boolean;
}

export function evaluateQcPolicy(
  request: QcRunRequest,
  technical: TechnicalQcReport,
  semanticInput: VlmProviderOutput,
): QcPolicyDecision {
  const semantic = vlmProviderOutputSchema.parse(semanticInput);
  const technicalFailures = technical.checks.filter((check) => !check.passed && check.severity === 'error');
  const combinedPatch: Record<string, unknown> = {
    ...(semantic.retryPatch ?? {}),
    ...(technicalFailures.length
      ? { technical_failure_codes: technicalFailures.map((check) => check.code) }
      : {}),
    ...(request.remediation === 'remotion' && technicalFailures.length ? { remotion_only: true } : {}),
  };
  const reasons = [
    technicalFailures.length
      ? `Technical QC failed: ${technicalFailures.map((check) => check.reason).join('; ')}`
      : 'Technical QC passed',
    `Semantic QC: ${semantic.reason}`,
  ];

  if (semantic.decision === 'manual' || semantic.scores.compliance < 0.7) {
    return {
      decision: 'manual',
      reason: reasons.join(' | '),
      ...(Object.keys(combinedPatch).length ? { retryPatch: combinedPatch } : {}),
      needsHuman: true,
    };
  }

  let decision: QcPolicyDecision['decision'] = 'pass';
  if (technicalFailures.length) decision = 'regenerate';
  else if (semantic.decision !== 'pass') decision = semantic.decision;

  if (decision === 'regenerate' && request.qualityAttempt > 1) {
    return {
      decision: 'manual',
      reason: `${reasons.join(' | ')} | Automatic quality retry limit reached`,
      ...(Object.keys(combinedPatch).length ? { retryPatch: combinedPatch } : {}),
      needsHuman: true,
    };
  }

  return {
    decision,
    reason: reasons.join(' | '),
    ...(Object.keys(combinedPatch).length ? { retryPatch: combinedPatch } : {}),
    needsHuman: false,
  };
}
