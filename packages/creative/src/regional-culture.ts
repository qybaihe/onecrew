import {
  regionalCulturePackSchema,
  type LlmProviderRequest,
  type ProjectSpec,
  type RegionalCulturePackRequest,
} from '@onecrew/contracts';
import { z } from 'zod';

export interface BuildRegionalCultureRequestInput {
  project: Pick<ProjectSpec, 'projectId' | 'nameZh' | 'nameEn' | 'synopsis' | 'audience' | 'genres'>;
  request: RegionalCulturePackRequest;
}

export function regionalCulturePackOutputSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(regionalCulturePackSchema, { target: 'draft-2020-12' }),
    title: 'OneCrewRegionalCulturePack',
  };
}

const REGION_GUIDES: Record<RegionalCulturePackRequest['region'], string> = {
  america: [
    '目标地区：美国（america）。核心受众为 ReelShort / DramaBox 上的中年女性与千禧一代女性，偏好竖屏 1-3 分钟单集、强 cliffhanger 节奏。',
    '偏好题材：狼人 / 龙族 / 吸血鬼等 Alpha 奇幻浪漫、billionaire 强势男主、contract marriage、secret heiress、fated mate、复仇逆袭。',
    '核心精神面貌：个人命运翻转、被低估的女主逆袭、欲望与危险并存、禁忌之恋、女性自我主张。',
    '钩子结构：开场 5 秒必须出现高冲突画面（献祭、追逐、变身、婚礼打断）；每 60 秒一个反转；每集结尾必须是命运级悬念。',
    '视觉符号：月光、中世纪城堡与龙穴、现代豪宅、男主深邃眼神特写、女主红裙、满月、誓约戒指、魔法印记。',
    '禁忌规避：避免东亚家族伦理戏、避免婆媳关系主线、避免修仙渡劫设定、避免中式婚礼符号。',
    '参考案例：ReelShort 2026 爆款《Claimed by the Dragon》——龙族诅咒 + 命定伴侣 + 美国中年女性受众 + 每集结尾 cliffhanger，证明"西方奇幻浪漫 + 命运绑定"在美国市场的爆发力。',
  ].join('\n'),
  russia: [
    '目标地区：俄罗斯（russia）。受众偏好强情节、家庭荣誉、男性英雄主义与民族叙事。',
    '偏好题材：二战/历史史诗、寡头权力斗争、东正教宿命、民间童话（芭芭雅嘎、火鸟）、冰雪王国、硬汉复仇。',
    '核心精神面貌：忍受与救赎、家庭与祖国高于个人、男性的沉默担当、命运不可逃避。',
    '钩子结构：开场即展现巨大牺牲或不公；中段通过对立家族/阶级冲突推进；结尾常带悲剧性反转。',
    '视觉符号：雪原、洋葱顶教堂、苏联时代建筑、军大衣、伏特加酒杯、东正教圣像、火鸟图腾。',
    '禁忌规避：避免过度西化的个人主义叙事、避免 LGBTQ+ 主线、避免对东正教不敬的符号。',
    '参考案例：俄罗斯本土历史剧与 Netflix 上受欢迎的俄国史诗片，强调"牺牲-救赎"弧线。',
  ].join('\n'),
  uk: [
    '目标地区：英国（uk）。受众偏好转折克制、机智对白、阶级张力与时代剧美学。',
    '偏好题材：摄政时期浪漫（Bridgerton 式）、贵族秘辛、阶级跨越、侦探悬疑、职场智斗、冷幽默。',
    '核心精神面貌：克制的激情、尊严与体面、智慧胜于蛮力、命运与阶级博弈。',
    '钩子结构：开场以一句机智对白或一封挑战信设局；中段靠阶级/身份错位推进；结尾留白或体面反转。',
    '视觉符号：乔治王朝庄园、雨夜伦敦街道、茶会与舞会、手写书信、定制西装、古典油画质感。',
    '禁忌规避：避免过度裸露与直白情欲、避免美式大喊大叫的冲突、避免不尊重王室与历史的桥段。',
    '参考案例：Bridgerton、Downton Abbey 的国际化成功证明英式阶级浪漫 + 克制张力的全球吸引力。',
  ].join('\n'),
};

export function buildRegionalCultureRequest(input: BuildRegionalCultureRequestInput): LlmProviderRequest {
  const { project, request } = input;
  const regionGuide = REGION_GUIDES[request.region];
  const prompt = [
    '你是 OneCrew 出海短剧本地化策略师。请基于给定项目与目标地区，产出一份可直接驱动后续剧本创作的"地域文化包"。',
    '必须严格遵循给定 JSON Schema 输出，不要输出额外字段。',
    'localizedBrief 必须是把项目简介用该地区受众熟悉的题材、精神面貌和视觉符号彻底重写后的创作简报，而不是字面翻译。',
    'themes、spiritValues、hookStructures、visualMotifs 必须具体、可被编剧直接执行，避免空泛词汇。',
    'taboos 必须列出该地区受众会立即弃剧的文化雷区。',
    'referenceCases 至少给出 1 个真实出海爆款短剧或该地区本土成功剧集，并说明其成功要素如何映射到本项目。',
    `项目：${project.nameZh} / ${project.nameEn}`,
    `项目简介：${project.synopsis}`,
    `原受众：${project.audience}`,
    `原类型：${project.genres.join('、')}`,
    regionGuide,
    `本次创作要求：${request.brief}`,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 100_000);

  return {
    capability: 'llm',
    projectId: project.projectId,
    operation: 'regional_culture',
    prompt,
    locale: 'zh-CN',
    imageUris: [],
    outputSchema: regionalCulturePackOutputSchema(),
    maxOutputTokens: 8_000,
    route: request.route,
    generationNonce: request.generationNonce,
  };
}
