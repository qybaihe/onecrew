import { loadEnv } from '@onecrew/config';
import { projectSpecSchema, shotSpecSchema } from '@onecrew/contracts';

import { createDatabase } from './client.js';
import { projects, shots } from './schema.js';

const env = loadEnv();
const client = createDatabase(env.DATABASE_URL);

const project = projectSpecSchema.parse({
  projectId: 'prj_shanhai_demo',
  nameZh: '山海星辰',
  nameEn: 'Stars Beyond the Mountains and Seas',
  synopsis: '两位守星人在山海裂隙中寻找失落星图。',
  audience: '18-35 岁奇幻短剧观众',
  genres: ['奇幻', '冒险'],
  ownerOpenId: 'ou_demo_owner',
  locales: ['zh-CN', 'en-US'],
  aspectRatios: ['16:9', '9:16', '1:1'],
  budgetLimitCny: 100,
  status: 'draft',
});

const seedShots = [
  shotSpecSchema.parse({
    shotId: 'shot_demo_001',
    projectId: project.projectId,
    sequence: 1,
    durationSec: 6,
    characters: ['char_lin'],
    sceneId: 'scene_stargate',
    action: '林遥在熄灭的星门前拾起仍在发光的残片。',
    camera: '低机位缓慢推近，最后停在残片反光中的眼睛。',
    dialogueZh: '星图没有消失，它在等我们。',
    prompt: 'cinematic fantasy, ancient stargate, blue-gold starlight, young guardian',
    negativePrompt: 'text, watermark, unstable face',
    referenceAssetIds: [],
    importance: 'hero',
    closeupDialogue: true,
    status: 'planned',
  }),
  shotSpecSchema.parse({
    shotId: 'shot_demo_002',
    projectId: project.projectId,
    sequence: 2,
    durationSec: 6,
    characters: ['char_lin', 'char_yue'],
    sceneId: 'scene_stargate',
    action: '岳岚从风沙中出现，展开一张缺角的山海图。',
    camera: '横向跟拍后切双人中景。',
    dialogueZh: '那就把最后一角找回来。',
    prompt: 'two guardians, sandstorm, ancient map, cinematic blue and amber lighting',
    negativePrompt: 'text, watermark, duplicate people',
    referenceAssetIds: [],
    importance: 'normal',
    closeupDialogue: false,
    status: 'planned',
  }),
  ...[
    {
      action: '两人踏入星门，脚下的碎片依次亮起。',
      camera: '俯拍转环绕，跟随光路向前。',
      dialogueZh: '越过第三道星门。',
      prompt: 'two guardians entering an ancient stargate, luminous path, cinematic fantasy',
    },
    {
      action: '巨大的山海兽影掠过云层，遮住远方星光。',
      camera: '超广角仰拍后快速推向云层缺口。',
      dialogueZh: '越过第四道星门。',
      prompt: 'colossal mythic beast silhouette above clouds, starlight, cinematic scale',
    },
    {
      action: '林遥用残片投出一幅旋转星图，缺口指向雪岭。',
      camera: '手部特写拉焦到全息星图。',
      dialogueZh: '越过第五道星门。',
      prompt: 'glowing star map projection, snowy ridge coordinates, blue amber fantasy',
    },
    {
      action: '岳岚在断桥前钉下绳索，风暴从深谷升起。',
      camera: '侧面中景跟随动作，轻微手持感。',
      dialogueZh: '越过第六道星门。',
      prompt: 'guardian securing rope at broken bridge, abyss storm, cinematic fantasy',
    },
    {
      action: '两人沿绳索穿过峡谷，身后星门逐一熄灭。',
      camera: '长焦压缩空间，随后横移展示追来的黑暗。',
      dialogueZh: '越过第七道星门。',
      prompt: 'two guardians crossing abyss on rope, stargates fading behind, cinematic',
    },
    {
      action: '雪岭祭坛中央，最后一角星图悬在冰晶之中。',
      camera: '从祭坛全景缓慢推进到冰晶近景。',
      dialogueZh: '越过第八道星门。',
      prompt: 'snow ridge altar, final star map shard inside crystal, mythic cinematic light',
    },
    {
      action: '林遥触碰冰晶，记忆中的山海与现实重叠。',
      camera: '面部近景叠化到快速闪回蒙太奇。',
      dialogueZh: '越过第九道星门。',
      prompt: 'guardian touching crystal, memory montage of mountains and seas, emotional',
    },
    {
      action: '完整星图在黎明上空展开，两人望向新的航路。',
      camera: '从双人背影升格拉远，露出辽阔天际。',
      dialogueZh: '越过第十道星门。',
      prompt: 'complete star map across dawn sky, two guardians, hopeful cinematic finale',
    },
  ].map((scene, offset) => {
    const sequence = offset + 3;
    return shotSpecSchema.parse({
      shotId: `shot_demo_${String(sequence).padStart(3, '0')}`,
      projectId: project.projectId,
      sequence,
      durationSec: 6,
      characters: sequence % 2 === 0 ? ['char_lin', 'char_yue'] : ['char_lin'],
      sceneId: sequence < 6 ? 'scene_stargate' : sequence < 9 ? 'scene_abyss' : 'scene_snow_altar',
      action: scene.action,
      camera: scene.camera,
      dialogueZh: scene.dialogueZh,
      prompt: scene.prompt,
      negativePrompt: 'text, watermark, unstable face, duplicate people',
      referenceAssetIds: [],
      importance: sequence === 8 || sequence === 10 ? 'hero' : 'normal',
      closeupDialogue: sequence === 5 || sequence === 9,
      status: 'planned',
    });
  }),
];

try {
  await client.db
    .insert(projects)
    .values({ projectId: project.projectId, spec: project, status: project.status })
    .onConflictDoNothing();
  await client.db
    .insert(shots)
    .values(
      seedShots.map((shot) => ({
        shotId: shot.shotId,
        projectId: shot.projectId,
        sequence: shot.sequence,
        spec: shot,
        status: shot.status,
      })),
    )
    .onConflictDoNothing();
} finally {
  await client.close();
}
