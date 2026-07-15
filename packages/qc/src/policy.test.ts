import type { QcRunRequest, TechnicalQcReport, VlmProviderOutput } from '@onecrew/contracts';
import { describe, expect, it } from 'vitest';

import { evaluateQcPolicy } from './policy.js';

const request: QcRunRequest = {
  projectId: 'prj_qc_policy',
  mediaUri: 's3://onecrew/fixture.mp4',
  mediaType: 'video',
  expectedDescription: 'A stable hero shot',
  criteria: ['character', 'flicker'],
  technical: {
    durationToleranceSec: 0.35,
    requireAudio: false,
    allowedVideoCodecs: ['h264'],
    allowedAudioCodecs: ['aac', 'mp3'],
    allowedPixelFormats: ['yuv420p'],
    maxBlackDurationSec: 0.75,
    maxFreezeDurationSec: 1.5,
    maxSilenceDurationSec: 2,
    maxBrightnessJump: 70,
    subtitleCues: [],
  },
  route: 'primary',
  qualityAttempt: 1,
  autoRemediate: true,
  remediation: 'generation',
};

const report: TechnicalQcReport = {
  passed: true,
  probe: { durationSec: 6, width: 1080, height: 1080, fps: 30, videoCodec: 'h264', pixelFormat: 'yuv420p' },
  blackSegments: [],
  freezeSegments: [],
  silenceSegments: [],
  checks: [{ code: 'decode', passed: true, severity: 'info', reason: 'ok' }],
  analyzedAt: new Date().toISOString(),
};

const semantic: VlmProviderOutput = {
  scores: { character: 0.9, clothing: 0.9, background: 0.9, action: 0.9, flicker: 0.9, lipsync: 0.9, subtitle: 0.9, brand: 0.9, safeArea: 0.9, audio: 0.9, compliance: 0.9 },
  decision: 'pass',
  reason: 'semantic pass',
};

describe('QC retry policy', () => {
  it('passes only when technical and semantic checks pass', () => {
    expect(evaluateQcPolicy(request, report, semantic)).toMatchObject({ decision: 'pass', needsHuman: false });
  });

  it('requests one regeneration and then escalates the same quality defect', () => {
    const failed: TechnicalQcReport = {
      ...report,
      passed: false,
      checks: [{ code: 'freeze_frames', passed: false, severity: 'error', reason: 'face froze' }],
    };
    expect(evaluateQcPolicy(request, failed, semantic)).toMatchObject({
      decision: 'regenerate',
      retryPatch: { technical_failure_codes: ['freeze_frames'] },
    });
    expect(evaluateQcPolicy({ ...request, qualityAttempt: 2 }, failed, semantic)).toMatchObject({
      decision: 'manual',
      needsHuman: true,
    });
  });

  it('never auto-bypasses a compliance failure', () => {
    expect(
      evaluateQcPolicy(request, report, {
        ...semantic,
        scores: { ...semantic.scores, compliance: 0.3 },
        decision: 'regenerate',
      }),
    ).toMatchObject({ decision: 'manual', needsHuman: true });
  });
});
