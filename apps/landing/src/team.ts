export type TeamMetric = {
  value: string;
  label: string;
};

export type TeamExperience = {
  eyebrow: string;
  title: string;
  period: string;
  description: string;
  result?: string;
};

export type TeamLink = {
  label: string;
  href: string;
};

export type TeamMember = {
  slug: string;
  sequence: string;
  initials: string;
  name: string;
  romanizedName: string;
  role: string;
  poeticRole: string;
  education: string;
  thesis: string;
  introduction: string;
  contribution: string[];
  focus: string[];
  metrics: TeamMetric[];
  experience: TeamExperience[];
  links: TeamLink[];
};

export const teamMembers: TeamMember[] = [
  {
    slug: 'zhang-shaoqian',
    sequence: '01',
    initials: 'ZSQ',
    name: '张少谦',
    romanizedName: 'Shaoqian Zhang',
    role: 'Agent 制片与系统工程',
    poeticRole: '让一个人，拥有一支剧组的调度力。',
    education: '中山大学 · 软件工程',
    thesis:
      '他把创作拆成可以协作、回放与验收的任务，让模型不只给出灵感，也真正走完从素材到成片的最后一公里。',
    introduction:
      '专注 AI Agent、工具调用、多智能体协作与跨端产品工程。擅长把模糊创意编排成清晰工作流，在高压时间窗内完成从系统架构、全栈实现到现场演示的完整交付。',
    contribution: [
      '编排剧本、分镜、素材、配音、渲染与质检 Agent，建立可追踪的创作链路。',
      '用 Remotion 与跨端工程把生成结果变成可预览、可修改、可交付的真实影片。',
      '为“一人剧组”设计失败重试、质量门槛与人工接管点，让规模化生产仍然可控。',
    ],
    focus: ['Agent Orchestration', 'Remotion', 'Full-stack', 'Quality Control'],
    metrics: [
      { value: '48h', label: '端到端创作链路落地' },
      { value: '13', label: '专业 Agent 协作工作台' },
      { value: '5+', label: '黑客松实战与交付' },
    ],
    experience: [
      {
        eyebrow: '代表项目',
        title: 'MoonCut · AI 口播创作工作台',
        period: '2026',
        description:
          '带领三人团队，在 48 小时内贯通 ASR、文本理解、多模态素材、音乐与声画能力、Agent 编排、Remotion 渲染和质量验收，并同步交付 Web、iOS 与桌面端原型。',
        result: '首届“探月计划 · Physical AI 黑客松”AI Agent（软件）赛道冠军。',
      },
      {
        eyebrow: '内容交互',
        title: '像素圆桌 · 多专家短视频讨论',
        period: '2026',
        description:
          '围绕抖音视频导入、AI 辩题生成、多专家圆桌与 Battle 说服，完成剧本、角色、动画、语音、BGM 与可演示 iOS 产品的闭环。',
        result: '抖音创变者广州站一等奖。',
      },
      {
        eyebrow: 'Agent 基础设施',
        title: 'SYSU-Anything / Finance Anything',
        period: '2026',
        description:
          '将真实服务封装为可调用 Skill，并把 13 位专业 Agent 组织成研究与决策工作台；持续探索 Agent 从“会回答”到“能执行、可审计”的工程边界。',
      },
    ],
    links: [
      { label: '个人 GitHub', href: 'https://github.com/qybaihe' },
      { label: 'SYSU-Anything', href: 'https://github.com/qybaihe/SYSU-Anything' },
      { label: 'Finance Anything', href: 'https://github.com/qybaihe/Finance-Anything' },
    ],
  },
  {
    slug: 'wang-xinqi',
    sequence: '02',
    initials: 'WXQ',
    name: '王鑫琦',
    romanizedName: 'Xinqi Wang',
    role: '生成模型与视觉工程',
    poeticRole: '让机器理解镜头，也理解世界如何流动。',
    education: '复旦大学 · 智能科学与技术',
    thesis:
      '他的研究从世界模型延伸到真实机械臂：既关心一帧画面如何诞生，也关心生成结果能否稳定、准确地进入现实系统。',
    introduction:
      '聚焦 Physical AI、视频生成、世界模型与视觉—语言—动作模型，熟悉 Transformer、GRPO、DDIM、Flow Matching 等路线，并具备从算法验证到硬件系统调试的实践能力。',
    contribution: [
      '评估并优化视频生成模型，为角色一致性、动作连续性和镜头变化建立技术基线。',
      '将世界模型与强化学习经验用于镜头预测、素材筛选和生成质量提升。',
      '从推理效率、数据格式与底层控制解决“模型可用但产品不可用”的工程断点。',
    ],
    focus: ['Video Generation', 'World Models', 'Physical AI', 'Model Evaluation'],
    metrics: [
      { value: 'Top 10%', label: '专业学业表现' },
      { value: '3.88', label: '核心课程绩点 / 4.0' },
      { value: '0.1%', label: '精密电源控制误差' },
    ],
    experience: [
      {
        eyebrow: '生成研究',
        title: '面向自动驾驶的世界模型',
        period: '研究进行中',
        description:
          '以未来视频生成为入口，让驾驶系统获得更强的时序理解与规划能力，并探索 GRPO 对生成结果和选择能力的提升。',
        result: '相关工作正在论文投稿阶段。',
      },
      {
        eyebrow: '多模态模型',
        title: 'VLA 微调、遗忘学习与仿真测试',
        period: '研究项目',
        description:
          '在 H800 环境中围绕 OpenVLA-OFT 与 LIBERO 数据开展微调和指令遗忘实验，比较正常模型与遗忘模型在不同任务上的行为差异。',
      },
      {
        eyebrow: '真实世界验证',
        title: '机械臂绘画与 AI 硬件交付',
        period: '工程实践',
        description:
          '在 xArm 上实现精度可控的触碰与轨迹生成，并完成六自由度机械臂、嵌入式电源和 AI 桌宠的底层优化；覆盖运动学、路径规划、图像传输与交互延迟。',
        result: '精密数控电源项目在校内实物赛获得满分。',
      },
    ],
    links: [{ label: 'OneCrew 技术仓库', href: 'https://github.com/qybaihe/onecrew' }],
  },
  {
    slug: 'chen-yingying',
    sequence: '03',
    initials: 'CYY',
    name: '陈颖萤',
    romanizedName: 'Yingying Chen',
    role: '出海策略与内容增长',
    poeticRole: '让一束东方微光，找到世界另一端的观众。',
    education: '中山大学 · 工商管理（管理科学与工程）',
    thesis:
      '她站在内容与市场的交界处，把用户洞察、生成工具和财务判断连接起来，让一次创作不止被完成，还能被看见、被验证、被放大。',
    introduction:
      '兼具数据分析、行业研究、产品管理与 AIGC 实践。持续关注 TikTok、Amazon 等海外内容与消费场景，擅长把评论、文案与经营数据转译为选题、素材和投放决策。',
    contribution: [
      '从海外受众、平台语境与文化差异出发，建立选题、本地化和发行实验。',
      '把 Amazon 评论与 TikTok 高表现文案转化为可复用提示词、素材规范与内容模板。',
      '以预算、转化与风险指标管理 100 万投入，让创作增长同时具备商业纪律。',
    ],
    focus: ['Global Growth', 'Content Strategy', 'AIGC Product', 'Budget Modeling'],
    metrics: [
      { value: '+42%', label: '项目预测点击率提升' },
      { value: '15+', label: '风格布局与产品规范' },
      { value: '4 / 106', label: '专业综合排名' },
    ],
    experience: [
      {
        eyebrow: '出海一线',
        title: '跨境电商 AIGC 内容工程',
        period: '2026 — 至今',
        description:
          '围绕美国中高端家具，结合 Amazon 评论、TikTok 文案与亚马逊评论优化微调提示词；设计覆盖脚本、素材匹配、语音合成与剪辑渲染的视频生成 Agent。',
        result: '项目测算点击率提升 42%，沉淀 15+ 系列风格布局与产品规范。',
      },
      {
        eyebrow: '行业与预算',
        title: '国金证券 / 广州银行研究实践',
        period: '2026',
        description:
          '参与消费行业研究、数据清洗、趋势跟踪、财务与估值模型，也在银行风险管理中梳理 AI 自动化需求；为内容投放的预算分配、回报预期与风险控制提供量化视角。',
      },
      {
        eyebrow: '产品与创作',
        title: 'Colorbook · 此地有回声',
        period: '2026',
        description:
          '负责 AI 城市叙事产品的 PM 与 AIGC 能力，组织 RAG、图像生成、20+ 音色与动态 Few-Shot 模板，让旅行素材成为可行走、可聆听的城市故事。',
        result: '智能创新黑客松文旅赛道第一，并在国家会展中心路演。',
      },
    ],
    links: [
      { label: '个人 GitHub', href: 'https://github.com/qianqiu0926' },
      { label: 'Colorbook', href: 'https://github.com/qybaihe/colorbook' },
      { label: 'Pixel Roundtable', href: 'https://github.com/qybaihe/Pixel' },
    ],
  },
];

export function getTeamMember(slug: string) {
  return teamMembers.find((member) => member.slug === slug);
}
