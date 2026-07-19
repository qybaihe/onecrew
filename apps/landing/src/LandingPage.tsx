import { useEffect, useRef, useState } from 'react';

import { getTeamMember, teamMembers, type TeamMember } from './team.js';

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_083109_283f3553-e28f-428b-a723-d639c617eb2b.mp4';
const GITHUB_URL = 'https://github.com/qybaihe/onecrew';
const BRAND_MARK_URL = `${import.meta.env.BASE_URL}onecrew-mark.png`;

const navigation = [
  { label: '首页', href: '#home' },
  { label: '团队', href: '#team' },
  { label: '产品能力', href: `${GITHUB_URL}#主要功能` },
  { label: '工作流', href: `${GITHUB_URL}#系统如何工作` },
];

function ArrowUpRightIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path d="M5 15 15 5M7 5h8v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path d="m12.5 4.5-5.5 5.5 5.5 5.5M7.5 10H17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CinematicVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<number | null>(null);
  const restartTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateOpacity = () => {
      const { currentTime, duration } = video;
      if (Number.isFinite(duration) && duration > 0) {
        const fadeInOpacity = Math.min(currentTime / 0.5, 1);
        const fadeOutOpacity = Math.min(Math.max((duration - currentTime) / 0.5, 0), 1);
        video.style.opacity = String(Math.min(fadeInOpacity, fadeOutOpacity));
      }
      frameRef.current = window.requestAnimationFrame(updateOpacity);
    };

    frameRef.current = window.requestAnimationFrame(updateOpacity);
    void video.play().catch(() => undefined);

    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    };
  }, []);

  const restart = () => {
    const video = videoRef.current;
    if (!video) return;
    video.style.opacity = '0';
    restartTimerRef.current = window.setTimeout(() => {
      video.currentTime = 0;
      void video.play().catch(() => undefined);
    }, 100);
  };

  return (
    <div aria-hidden="true" className="pointer-events-none fixed right-0 bottom-0 left-0 top-[250px] z-0 overflow-hidden sm:top-[300px]">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover object-center opacity-0"
        src={VIDEO_URL}
        muted
        autoPlay
        playsInline
        preload="auto"
        onCanPlay={(event) => void event.currentTarget.play().catch(() => undefined)}
        onEnded={restart}
      />
      <div className="video-gradient absolute inset-0" />
    </div>
  );
}

function SiteHeader({ memberPage = false }: { memberPage?: boolean }) {
  return (
      <header className="sticky top-0 z-50 px-4 pt-4 sm:px-6 sm:pt-5 lg:px-8">
        <nav
          aria-label="主导航"
          className="nav-glass mx-auto flex max-w-7xl items-center justify-between rounded-full px-4 py-3 sm:px-5"
        >
          <a href="#home" aria-label="OneCrew 首页" className="group flex items-center gap-2.5 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black">
            <img src={BRAND_MARK_URL} alt="" className="brand-mark h-11 w-11 object-contain transition-transform duration-200 group-hover:-rotate-3 group-hover:scale-105" />
            <span className="font-display text-[1.75rem] leading-none tracking-[-0.045em]">OneCrew</span>
          </a>

          <div className="hidden items-center gap-7 md:flex">
            {navigation.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={`text-sm transition-colors duration-200 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black ${(!memberPage && item.label === '首页') || (memberPage && item.label === '团队') ? 'text-black' : 'text-[#6f6f6f] hover:text-black'}`}
              >
                {item.label}
              </a>
            ))}
          </div>

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-black px-4 text-sm font-medium text-white transition-transform duration-200 hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black sm:px-6"
          >
            <span className="hidden sm:inline">查看 GitHub</span>
            <span className="sm:hidden">GitHub</span>
            <ArrowUpRightIcon />
          </a>
        </nav>
      </header>
  );
}

function TeamCard({ member }: { member: TeamMember }) {
  return (
    <a
      href={`#/member/${member.slug}`}
      className="team-card group flex min-h-[31rem] flex-col rounded-[2rem] p-6 text-left transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black sm:p-8"
    >
      <div className="flex items-start justify-between">
        <span className="font-display text-5xl text-black/15 transition-colors duration-300 group-hover:text-black/30">{member.sequence}</span>
        <span className="member-orbit grid h-12 w-12 place-items-center rounded-full font-body text-[0.62rem] font-semibold tracking-[0.16em] text-black/70">
          {member.initials}
        </span>
      </div>

      <div className="mt-auto">
        <p className="mb-3 text-xs font-medium tracking-[0.16em] text-[#6f6f6f] uppercase">{member.role}</p>
        <h3 className="font-display text-5xl leading-none tracking-[-0.04em] sm:text-6xl">{member.name}</h3>
        <p className="mt-2 text-xs text-[#6f6f6f]">{member.romanizedName}</p>
        <p className="font-display mt-6 text-2xl leading-tight text-[#3f3f3f] italic">“{member.poeticRole}”</p>

        <div className="mt-7 flex flex-wrap gap-2">
          {member.focus.slice(0, 3).map((focus) => (
            <span key={focus} className="rounded-full border border-black/10 bg-white/40 px-3 py-1.5 text-[0.68rem] text-[#6f6f6f]">
              {focus}
            </span>
          ))}
        </div>

        <div className="mt-8 flex items-center justify-between border-t border-black/10 pt-5 text-sm font-medium">
          <span>阅读个人介绍</span>
          <span className="grid h-9 w-9 place-items-center rounded-full bg-black text-white transition-transform duration-300 group-hover:rotate-45">
            <ArrowUpRightIcon />
          </span>
        </div>
      </div>
    </a>
  );
}

function HomePage() {
  return (
    <>
      <SiteHeader />

      <main id="home" className="relative z-10 flex min-h-[calc(100vh-89px)] flex-col items-center justify-center px-6 pb-32 pt-[calc(8rem-75px)] text-center sm:pb-40">
        <div className="eyebrow-glass animate-fade-rise mb-7 inline-flex items-center gap-2 rounded-full px-4 py-2 font-body text-[0.68rem] font-medium tracking-[0.19em] text-[#6f6f6f]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#2ec4b6] shadow-[0_0_0_4px_rgba(46,196,182,0.12)]" />
          一人掌舵 · 万象成片
        </div>

        <h1 className="font-display animate-fade-rise max-w-7xl text-[2.55rem] leading-[0.96] font-normal tracking-[-1.6px] sm:text-7xl sm:leading-[0.95] sm:tracking-[-2.46px] md:text-8xl">
          <span className="block">一人掌舵，越过山海。</span>
          <em className="block font-normal text-[#6f6f6f]">
            万千灵感，<span className="block sm:inline">汇成星河。</span>
          </em>
        </h1>

        <p className="animate-fade-rise-delay mt-8 max-w-2xl text-base leading-relaxed text-[#6f6f6f] sm:text-lg">
          让故事从一束微光启程。OneCrew 把剧本、分镜、生成、质检与双语发布，编织成一条不熄的创作航线——飞书掌舵，API 并肩，Remotion 将每一次想象送往银幕。
        </p>

        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="animate-fade-rise-delay-2 mt-12 inline-flex min-h-14 items-center gap-3 rounded-full bg-black px-14 py-5 text-base font-medium text-white transition-transform duration-200 hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
        >
          沿星轨启程
          <ArrowUpRightIcon />
        </a>

        <p className="animate-fade-rise-delay-2 mt-5 text-xs tracking-[0.14em] text-[#6f6f6f] uppercase">
          Open source · Built for one, powered as a crew
        </p>
      </main>

      <section id="team" className="relative z-10 scroll-mt-28 px-4 pb-20 sm:px-6 sm:pb-28 lg:px-8">
        <div className="team-shell mx-auto max-w-7xl rounded-[2.5rem] px-5 py-14 sm:px-10 sm:py-20 lg:px-14">
          <div className="grid gap-10 lg:grid-cols-[0.78fr_1.22fr] lg:items-end">
            <div>
              <p className="text-xs font-medium tracking-[0.2em] text-[#6f6f6f] uppercase">The Crew · 核心团队</p>
              <h2 className="font-display mt-5 max-w-xl text-5xl leading-[0.95] tracking-[-0.04em] sm:text-7xl">
                三束专长，<em className="font-normal text-[#6f6f6f]">合成一支剧组。</em>
              </h2>
            </div>
            <div className="lg:pb-2">
              <p className="max-w-2xl text-base leading-8 text-[#5f5f5f] sm:text-lg">
                面对“一个爆款短剧 IP、一套 AI 全链路工具与 100 万预算”，我们从来不把答案寄托在某一个模型上。真正的 OneCrew，是让创作系统、生成影像与全球发行彼此咬合，让每一分钱、每一帧画面、每一次观众反馈都回到同一条航线上。
              </p>
            </div>
          </div>

          <div className="mt-12 grid gap-4 lg:mt-16 lg:grid-cols-3">
            {teamMembers.map((member) => (
              <TeamCard key={member.slug} member={member} />
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}

function MetricCard({ value, label, explanation }: { value: string; label: string; explanation: string }) {
  return (
    <div className="metric-card rounded-2xl p-4">
      <p className="font-display metric-value text-2xl tracking-[-0.03em] sm:text-3xl">{value}</p>
      <p className="mt-1.5 text-[0.7rem] font-medium leading-5 text-[#3f3f3f]">{label}</p>
      <p className="mt-1.5 text-[0.68rem] leading-[1.6] text-[#6f6f6f]">{explanation}</p>
    </div>
  );
}

function MemberPage({ member }: { member: TeamMember }) {
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.title = `${member.name} · OneCrew`;
    return () => {
      document.title = 'OneCrew · 一人掌舵，万象成片';
    };
  }, [member]);

  const accentClass = `accent-${member.accent}`;

  return (
    <>
      <SiteHeader memberPage />
      <main className={`relative z-10 px-4 pb-16 pt-12 sm:px-6 sm:pb-20 sm:pt-16 lg:px-8 ${accentClass}`}>
        <div className="mx-auto max-w-7xl">
          {/* === Two-column: sticky identity sidebar (left) + main flow (right) === */}
          <div className="grid gap-5 lg:grid-cols-[0.36fr_0.64fr] lg:gap-6">

            {/* --- LEFT: sticky identity card --- */}
            <aside className="member-panel h-fit rounded-[1.75rem] p-5 sm:p-6 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
              <a
                href="#team"
                className="back-link inline-flex items-center gap-2 rounded-full text-xs text-[#5f5f5f] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
              >
                <ArrowLeftIcon />
                返回团队
              </a>

              <div className="accent-eyebrow mt-5 text-[0.65rem] font-medium tracking-[0.18em] uppercase">
                <span>{member.sequence}</span>
                <span className="h-px w-8 bg-black/15" />
                <span>{member.role}</span>
              </div>

              <h1 className="font-display mt-3 text-5xl leading-[0.9] tracking-[-0.045em] sm:text-6xl">
                {member.name}
              </h1>
              <p className="mt-2 text-[0.72rem] tracking-[0.06em] text-[#6f6f6f]">
                {member.romanizedName} · {member.education}
              </p>

              <p className="font-display mt-4 text-base leading-snug italic text-[#3f3f3f]">
                “{member.poeticRole}”
              </p>

              <div className="mt-5">
                <p className="text-[0.6rem] font-semibold tracking-[0.18em] text-[#6f6f6f] uppercase">核心能力</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {member.focus.map((focus) => (
                    <span
                      key={focus}
                      className="accent-chip rounded-full px-2.5 py-1 text-[0.64rem] font-medium"
                    >
                      {focus}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-6 border-t border-black/10 pt-4">
                <p className="text-[0.6rem] font-semibold tracking-[0.18em] text-[#6f6f6f] uppercase">作品与代码</p>
                <ul className="mt-3 space-y-2">
                  {member.links.map((link) => (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="group inline-flex w-full items-center justify-between gap-2 rounded-lg border border-black/8 bg-white/40 px-3 py-2 text-[0.74rem] text-[#2a2a2a] transition-colors hover:border-black/20 hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                      >
                        <span className="min-w-0 truncate">{link.label}</span>
                        <ArrowUpRightIcon />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>

            {/* --- RIGHT: main flow --- */}
            <div className="min-w-0 space-y-4">

              {/* 2) HERO / THESIS CALLOUT — compact */}
              <section className="member-hero overflow-hidden rounded-[1.75rem] p-5 sm:p-7">
                <p className="text-[0.65rem] font-medium tracking-[0.18em] uppercase" style={{ color: 'var(--accent-ink)' }}>
                  Role in OneCrew · 剧组中的位置
                </p>
                <p className="font-display mt-3 max-w-3xl text-lg leading-[1.35] tracking-[-0.015em] text-[#1f1f1f] sm:text-xl">
                  {member.thesis}
                </p>
              </section>

              {/* 3) CAPABILITY OVERVIEW */}
              <section className="member-panel rounded-[1.75rem] p-5 sm:p-6">
                <p className="accent-eyebrow text-[0.65rem] font-medium tracking-[0.18em] uppercase">
                  Capability Overview · 能力概览
                </p>
                <h2 className="font-display mt-3 text-2xl leading-tight tracking-[-0.025em] sm:text-3xl">
                  关于 {member.name}
                </h2>

                <div className="mt-5 grid gap-5 sm:gap-6 lg:grid-cols-[1fr_1fr]">
                  <div className="min-w-0">
                    <p className="text-sm leading-[1.75] text-[#3f3f3f]">
                      {member.introduction}
                    </p>
                  </div>

                  <div className="thesis-connection rounded-xl p-4 sm:p-5">
                    <p className="text-[0.6rem] font-semibold tracking-[0.18em] uppercase" style={{ color: 'var(--accent-ink)' }}>
                      与 OneCrew 命题的连接
                    </p>
                    <p className="mt-2 text-[0.8rem] leading-[1.75] text-[#2a2a2a]">
                      {member.thesisConnection}
                    </p>
                  </div>
                </div>

                <div className="mt-6">
                  <p className="text-[0.6rem] font-semibold tracking-[0.18em] text-[#6f6f6f] uppercase">
                    Proof Metrics · 可验证的指标
                  </p>
                  <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
                    {member.metrics.map((metric) => (
                      <MetricCard key={metric.value + metric.label} {...metric} />
                    ))}
                  </div>
                </div>
              </section>

              {/* 4) SELECTED EXPERIENCE */}
              <section className="member-panel rounded-[1.75rem] p-5 sm:p-6">
                <div className="flex items-end justify-between gap-4">
                  <div className="min-w-0">
                    <p className="accent-eyebrow text-[0.65rem] font-medium tracking-[0.18em] uppercase">
                      Selected Experience · 精选履历
                    </p>
                    <h2 className="font-display mt-3 text-2xl leading-tight tracking-[-0.025em] sm:text-3xl">
                      与命题相关的三段实战
                    </h2>
                  </div>
                  <span className="hidden font-display text-4xl text-black/10 sm:block">03</span>
                </div>

                <div className="mt-6 divide-y divide-black/10 border-t border-black/10">
                  {member.experience.map((item, index) => (
                    <article key={item.title} className="experience-entry grid gap-4 py-5 sm:grid-cols-[3rem_1fr] sm:gap-5">
                      <span className="font-display text-2xl text-black/20">0{index + 1}</span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-[0.6rem] font-semibold tracking-[0.16em] text-[#6f6f6f] uppercase">{item.eyebrow}</span>
                          <span className="text-[0.68rem] text-[#8a8a8a]">{item.period}</span>
                        </div>
                        <h3 className="font-display mt-2 text-lg leading-tight tracking-[-0.015em] sm:text-xl">{item.title}</h3>

                        <p className="mt-2.5 text-[0.76rem] font-medium leading-[1.65] text-[#3f3f3f]">
                          <span className="text-[#6f6f6f]">职责 · </span>{item.responsibility}
                        </p>

                        <p className="mt-2 text-[0.82rem] leading-[1.75] text-[#3f3f3f]">{item.description}</p>

                        {item.result ? (
                          <p className="experience-result mt-2.5 pl-3 text-[0.82rem] font-medium leading-[1.65] text-[#1f1f1f]">
                            <span className="text-[#6f6f6f]">成果 · </span>{item.result}
                          </p>
                        ) : null}

                        <div className="experience-relevance mt-3 rounded-lg p-3">
                          <p className="text-[0.58rem] font-semibold tracking-[0.16em] uppercase" style={{ color: 'var(--accent-ink)' }}>
                            与 OneCrew 的关联
                          </p>
                          <p className="mt-1.5 text-[0.78rem] leading-[1.7] text-[#2a2a2a]">{item.relevance}</p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              {/* 5) CONTRIBUTION TO ONECREW */}
              <section className="member-panel rounded-[1.75rem] p-5 sm:p-6">
                <p className="accent-eyebrow text-[0.65rem] font-medium tracking-[0.18em] uppercase">
                  Contribution to OneCrew · 对生产线的贡献
                </p>
                <h2 className="font-display mt-3 text-2xl leading-tight tracking-[-0.025em] sm:text-3xl">
                  为这条航线补上的三块拼图
                </h2>

                <ol className="mt-5 grid gap-3 sm:grid-cols-3">
                  {member.contribution.map((item, index) => (
                    <li
                      key={item.title}
                      className="contribution-card flex flex-col rounded-xl p-5"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-display contribution-index text-2xl tracking-[-0.02em]">
                          0{index + 1}
                        </span>
                        <span className="h-px flex-1 accent-divider" />
                      </div>
                      <h3 className="contribution-title font-display mt-3 text-base leading-tight tracking-[-0.015em] sm:text-lg">
                        {item.title}
                      </h3>
                      <p className="mt-2 text-[0.8rem] leading-[1.75] text-[#3f3f3f]">
                        {item.description}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>

            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

function Footer() {
  return (
    <footer className="relative z-10 px-4 pb-6 sm:px-6 lg:px-8">
      <div className="nav-glass mx-auto flex max-w-7xl flex-col gap-3 rounded-[1.5rem] px-6 py-5 text-xs text-[#6f6f6f] sm:flex-row sm:items-center sm:justify-between">
        <span>© 2026 OneCrew · 一人掌舵，万象成片</span>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="transition-colors hover:text-black">Open source on GitHub ↗</a>
      </div>
    </footer>
  );
}

function readMemberSlug() {
  const match = window.location.hash.match(/^#\/member\/([^/]+)/);
  return match?.[1] ?? null;
}

export function LandingPage() {
  const [memberSlug, setMemberSlug] = useState(readMemberSlug);

  useEffect(() => {
    const onHashChange = () => {
      const nextMemberSlug = readMemberSlug();
      setMemberSlug(nextMemberSlug);
      if (!nextMemberSlug && window.location.hash) {
        window.requestAnimationFrame(() => {
          const anchor = window.location.hash.slice(1) || 'home';
          document.getElementById(anchor)?.scrollIntoView();
        });
      }
    };

    window.addEventListener('hashchange', onHashChange);
    onHashChange();
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const member = memberSlug ? getTeamMember(memberSlug) : undefined;

  return (
    <div className="ambient-page relative min-h-screen w-full overflow-x-clip bg-white text-black">
      <CinematicVideo />
      {member ? <MemberPage key={member.slug} member={member} /> : <HomePage />}
    </div>
  );
}
