import type { CreativeProjectBundle } from '@onecrew/contracts';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';

const projectFile = {
  version: '1.4',
  exported_at: '2026-07-15T00:00:00.000Z',
  drama: { title: 'API 导入测试', genre: '短剧' },
  episodes: [
    {
      episode_number: 1,
      title: '第一集',
      storyboards: [{ storyboard_number: 1, action: '角色进入场景。', scene_index: 0 }],
    },
  ],
  characters: [],
  scenes: [{ location: '测试场景' }],
  props: [],
};

describe('creative routes', () => {
  it('imports LocalMiniDrama JSON into the creative repository', async () => {
    let importedBundle: CreativeProjectBundle | undefined;
    const app = createApp({
      logger: false,
      probes: [],
      creatives: {
        repository: {
          async importBundle(bundle) {
            importedBundle = bundle;
            return {
              projectId: bundle.project.projectId,
              episodes: bundle.episodes.length,
              entities: bundle.entities.length,
              shots: bundle.shots.length,
              framePrompts: bundle.framePrompts.length,
              assets: 0,
            };
          },
          async getBundle() {
            if (!importedBundle) throw new Error('not imported');
            return importedBundle;
          },
          async listProjects() {
            return importedBundle ? [importedBundle.project] : [];
          },
          async listAssets() {
            return [];
          },
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/creative/imports/local-mini-drama/json',
      payload: { projectId: 'prj_api_import', ownerOpenId: 'ou_api', project: projectFile },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      ok: true,
      imported: { projectId: 'prj_api_import', episodes: 1, shots: 1 },
      source: { system: 'local-mini-drama', version: '1.4', license: 'MIT' },
    });
    expect(importedBundle?.shots[0]).toMatchObject({ action: '角色进入场景。', status: 'planned' });
    await app.close();
  });

  it('keeps creative imports unavailable when no repository is wired', async () => {
    const app = createApp({ logger: false, probes: [] });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/creative/imports/local-mini-drama/json',
      payload: { project: projectFile },
    });
    expect(response.statusCode).toBe(503);
    await app.close();
  });
});
