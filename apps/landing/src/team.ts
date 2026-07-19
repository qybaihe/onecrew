export type TeamMetric = {
  value: string;
  label: string;
  explanation: string;
};

export type TeamExperience = {
  eyebrow: string;
  title: string;
  period: string;
  responsibility: string;
  description: string;
  relevance: string;
  result?: string;
};

export type TeamContribution = {
  title: string;
  description: string;
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
  thesisConnection: string;
  introduction: string;
  contribution: TeamContribution[];
  focus: string[];
  metrics: TeamMetric[];
  experience: TeamExperience[];
  links: TeamLink[];
  accent: 'teal' | 'cyan' | 'sea';
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
    thesisConnection:
      '“一人剧组”的地基。他把剧本、分镜、素材、配音、渲染与质检组织成一个人就能调度、可追踪、可回放的工作流，让 OneCrew 从“能生成”走到“能交付”。',
    introduction:
      '专注 AI Agent、工具调用、多智能体协作与跨端产品工程。擅长把模糊创意编排成清晰工作流，在高压时间窗内完成从系统架构、全栈实现到现场演示的完整交付。',
    contribution: [
      {
        title: '剧本与分镜编排',
        description:
          '把创作简报、剧本计划与分镜画布组织成可追踪的创作链路，让 Agent 能读取上下文、绑定参考素材并按结构生成下一镜。',
      },
      {
        title: '多智能体调度',
        description:
          '为 13+ 专业 Agent 设计任务追踪、失败重试与人工接管点，让剧本、素材、配音、渲染与质检彼此咬合，规模化生产仍然可控、可审计。',
      },
      {
        title: '渲染与质检',
        description:
          '用 Remotion 与跨端工程把生成结果变成可预览、可修改、可交付的影片，并设立自动质检与人工接管闸门，让模型输出真正走完最后一公里。',
      },
    ],
    focus: ['Agent Orchestration', 'Remotion', 'Full-stack', 'Quality Control'],
    metrics: [
      {
        value: '48h',
        label: '端到端创作链路落地',
        explanation:
          '在首届“探月计划 · Physical AI 黑客松”48 小时限时挑战中，从 ASR、文本理解、多模态素材、音乐到 Agent 编排、Remotion 渲染与质检全链路打通，并同步交付 Web、iOS 与桌面端可演示原型。',
      },
      {
        value: '13',
        label: '专业 Agent 协作工作台',
        explanation:
          '在 SYSU-Anything 与 Finance Anything 中，将 13 位专业 Agent 与真实服务封装的 Skill 组织成可调用、可审计的研究与决策工作台。',
      },
      {
        value: '5+',
        label: '黑客松实战与交付',
        explanation:
          '累计参与 5 场以上黑客松与限时交付，覆盖 AI Agent、Physical AI、内容创作与跨端工程，多次获得冠军与一等奖。',
      },
    ],
    experience: [
      {
        eyebrow: '代表项目',
        title: 'MoonCut · AI 口播创作工作台',
        period: '2026',
        responsibility: '三人团队技术负责人，负责整体架构、Agent 编排与跨端交付。',
        description:
          '带领三人团队，在 48 小时内贯通 ASR、文本理解、多模态素材、音乐与声画能力、Agent 编排、Remotion 渲染和质量验收，并同步交付 Web、iOS 与桌面端原型。',
        relevance:
          '直接验证“一人剧组”命题：48 小时内把剧本、分镜、素材、配音、渲染、质检组织成可执行工作流，并产出可演示成片，正是 OneCrew 生产线的最小完整闭环。',
        result: '首届“探月计划 · Physical AI 黑客松”AI Agent（软件）赛道冠军。',
      },
      {
        eyebrow: '内容交互',
        title: '像素圆桌 · 多专家短视频讨论',
        period: '2026',
        responsibility: '负责剧本、角色、动画、语音、BGM 与 iOS 产品端的整体设计与落地。',
        description:
          '围绕抖音视频导入、AI 辩题生成、多专家圆桌与 Battle 说服，完成剧本、角色、动画、语音、BGM 与可演示 iOS 产品的闭环。',
        relevance:
          '证明 AI 多专家编排能稳定生成可消费的短内容，为 OneCrew 的角色化 Agent 协作与短剧叙事提供可复用模板。',
        result: '抖音创变者广州站一等奖。',
      },
      {
        eyebrow: 'Agent 基础设施',
        title: 'SYSU-Anything / Finance Anything',
        period: '2026',
        responsibility: '系统架构与 Skill 封装，把 13 位专业 Agent 组织成可调用工作台。',
        description:
          '将真实服务封装为可调用 Skill，并把 13 位专业 Agent 组织成研究与决策工作台；持续探索 Agent 从“会回答”到“能执行、可审计”的工程边界。',
        relevance:
          '为 OneCrew 的任务追踪、失败重试、人工接管与可审计执行提供基础设施经验，是“一人剧组”可规模化生产的工程底座。',
      },
    ],
    links: [
      { label: '个人 GitHub', href: 'https://github.com/qybaihe' },
      { label: 'SYSU-Anything', href: 'https://github.com/qybaihe/SYSU-Anything' },
      { label: 'Finance Anything', href: 'https://github.com/qybaihe/Finance-Anything' },
    ],
    accent: 'teal',
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
    thesisConnection:
      '“一人剧组”的镜头。他让生成模型稳定输出可用的画面，解决角色一致性、动作连续性与底层性能，让“一个人”也能拿到一支剧组的影像质量。',
    introduction:
      '聚焦 Physical AI、视频生成、世界模型与视觉—语言—动作模型，熟悉 Transformer、GRPO、DDIM、Flow Matching 等路线，并具备从算法验证到硬件系统调试的实践能力。',
    contribution: [
      {
        title: '视频生成质量',
        description:
          '评估并优化视频生成模型在镜头时序、动作连续性与画面变化上的表现，为 OneCrew 建立可复现的生成质量基线。',
      },
      {
        title: '角色一致性',
        description:
          '结合世界模型与视觉—语言—动作模型经验，为角色身份、服装与镜头轴线一致性提供技术方案，避免“每镜一个角色”。',
      },
      {
        title: '内容测试',
        description:
          '用 H800 级实验环境与对比实验方法，对生成结果做可控评测与回归验证，避免“看起来好”替代“真的稳定”。',
      },
    ],
    focus: ['Video Generation', 'World Models', 'Physical AI', 'Model Evaluation'],
    metrics: [
      {
        value: 'Top 10%',
        label: '专业学业表现',
        explanation: '复旦大学智能科学与技术专业，学业成绩稳定保持在前 10%。',
      },
      {
        value: '3.88',
        label: '核心课程绩点 / 4.0',
        explanation: '核心课程 GPA 3.88/4.0，覆盖数学、控制、机器学习与智能系统主线。',
      },
      {
        value: '0.1%',
        label: '精密电源控制误差',
        explanation:
          '在六自由度机械臂与嵌入式数控电源项目中，将控制误差稳定收敛到 0.1% 以内，校内实物赛获得满分。',
      },
    ],
    experience: [
      {
        eyebrow: '生成研究',
        title: '面向自动驾驶的世界模型',
        period: '研究进行中',
        responsibility: '研究方向：未来视频生成、时序理解与 GRPO 在生成结果选择上的应用。',
        description:
          '以未来视频生成为入口，让驾驶系统获得更强的时序理解与规划能力，并探索 GRPO 对生成结果和选择能力的提升。',
        relevance:
          '为 OneCrew 的视频生成质量评估与镜头时序一致性提供研究基础与方法论，让“模型可用”具备可验证的底层逻辑。',
        result: '相关工作正在论文投稿阶段（研究进行中，尚未发表）。',
      },
      {
        eyebrow: '多模态模型',
        title: 'VLA 微调、遗忘学习与仿真测试',
        period: '研究项目',
        responsibility: '在 H800 环境完成 OpenVLA-OFT 与 LIBERO 微调与指令遗忘实验，对比正常与遗忘模型行为差异。',
        description:
          '在 H800 环境中围绕 OpenVLA-OFT 与 LIBERO 数据开展微调和指令遗忘实验，比较正常模型与遗忘模型在不同任务上的行为差异。',
        relevance:
          '积累模型评估、对比实验与可复现验证经验，直接支撑 OneCrew 生成质量评测基线与内容测试方法的建设。',
      },
      {
        eyebrow: '真实世界验证',
        title: '机械臂绘画与 AI 硬件交付',
        period: '工程实践',
        responsibility:
          'xArm 触碰与轨迹生成、六自由度机械臂运动学/路径规划、嵌入式电源与 AI 桌宠底层优化。',
        description:
          '在 xArm 上实现精度可控的触碰与轨迹生成，并完成六自由度机械臂、嵌入式电源和 AI 桌宠的底层优化；覆盖运动学、路径规划、图像传输与交互延迟。',
        relevance:
          '把“模型可用”推进到“系统可用”，解决推理效率、数据格式与底层性能等工程断点，是 OneCrew 生成结果进入真实交付的工程保障。',
        result: '精密数控电源项目在校内实物赛获得满分。',
      },
    ],
    links: [{ label: 'OneCrew 技术仓库', href: 'https://github.com/qybaihe/onecrew' }],
    accent: 'cyan',
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
    thesisConnection:
      '“爆款出海”的航线。她让成片找到真正的海外观众，用评论与内容数据驱动选题与素材，并让 100 万预算有纪律地变成可量化的增长。',
    introduction:
      '兼具数据分析、行业研究、产品管理与 AIGC 实践。持续关注 TikTok、Amazon 等海外内容与消费场景，擅长把评论、文案与经营数据转译为选题、素材和投放决策。',
    contribution: [
      {
        title: '海外本地化',
        description:
          '从海外受众、平台语境与文化差异出发，建立选题、本地化翻译与发行实验，让中文短剧找到世界另一端的观众。',
      },
      {
        title: '内容测试',
        description:
          '把 Amazon 评论与 TikTok 高表现文案转化为可复用提示词、素材规范与内容模板，用投放与反馈数据驱动下一轮选题与生成。',
      },
      {
        title: '预算管理',
        description:
          '以预算、转化与风险指标管理 100 万投入，让创作增长同时具备商业纪律与可量化的回报预期。',
      },
    ],
    focus: ['Global Growth', 'Content Strategy', 'AIGC Product', 'Budget Modeling'],
    metrics: [
      {
        value: '+42%',
        label: '项目预测点击率提升',
        explanation:
          '在跨境电商 AIGC 内容工程项目测算中，基于 Amazon 评论与 TikTok 高表现文案优化的提示词与素材匹配方案，项目预测点击率较原有素材提升 42%（项目预测，非已实现结果）。',
      },
      {
        value: '15+',
        label: '风格布局与产品规范',
        explanation:
          '围绕美国家具品类沉淀 15+ 套可复用的视频风格布局与产品级素材规范，支撑规模化内容生成与投放。',
      },
      {
        value: '4 / 106',
        label: '专业综合排名',
        explanation: '中山大学工商管理（管理科学与工程方向）专业综合排名 4/106。',
      },
    ],
    experience: [
      {
        eyebrow: '出海一线',
        title: '跨境电商 AIGC 内容工程',
        period: '2026 — 至今',
        responsibility:
          'AIGC 内容工程负责人：评论洞察、提示词微调、脚本/素材匹配、语音合成、剪辑渲染 Agent 设计。',
        description:
          '围绕美国中高端家具，结合 Amazon 评论、TikTok 文案与亚马逊评论优化微调提示词；设计覆盖脚本、素材匹配、语音合成与剪辑渲染的视频生成 Agent。',
        relevance:
          '直接对应 OneCrew 的海外受众研究、内容本地化与素材规范生成能力，是“爆款出海”命题在内容侧的最小可复用闭环。',
        result: '项目测算点击率提升 42%，沉淀 15+ 系列风格布局与产品规范（项目预测，非已实现结果）。',
      },
      {
        eyebrow: '行业与预算',
        title: '国金证券 / 广州银行研究实践',
        period: '2026',
        responsibility: '消费行业研究、数据清洗、趋势跟踪、财务估值模型；银行风险管理中的 AI 自动化需求梳理。',
        description:
          '参与消费行业研究、数据清洗、趋势跟踪、财务与估值模型，也在银行风险管理中梳理 AI 自动化需求；为内容投放的预算分配、回报预期与风险控制提供量化视角。',
        relevance:
          '为 OneCrew 的预算分配、回报预期与风险控制提供量化与商业纪律视角，让 100 万投入不止是创作预算，更是可审计的增长投资。',
      },
      {
        eyebrow: '产品与创作',
        title: 'Colorbook · 此地有回声',
        period: '2026',
        responsibility: 'PM 与 AIGC 能力负责人：RAG、图像生成、20+ 音色与动态 Few-Shot 模板组织。',
        description:
          '负责 AI 城市叙事产品的 PM 与 AIGC 能力，组织 RAG、图像生成、20+ 音色与动态 Few-Shot 模板，让旅行素材成为可行走、可聆听的城市故事。',
        relevance:
          '验证内容生成 Agent 在真实赛道（文旅）的可落地性与可演示性，为 OneCrew 的多模态叙事与本地化提供产品方法论。',
        result: '智能创新黑客松文旅赛道第一，并在国家会展中心路演。',
      },
    ],
    links: [
      { label: '个人 GitHub', href: 'https://github.com/qianqiu0926' },
      { label: 'Colorbook', href: 'https://github.com/qybaihe/colorbook' },
      { label: 'Pixel Roundtable', href: 'https://github.com/qybaihe/Pixel' },
    ],
    accent: 'sea',
  },
];

export function getTeamMember(slug: string) {
  return teamMembers.find((member) => member.slug === slug);
}
