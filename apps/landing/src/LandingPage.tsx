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

          <div className="team-manifesto mt-4 grid gap-8 rounded-[2rem] p-7 sm:p-10 lg:grid-cols-[1fr_1.25fr] lg:items-center">
            <p className="font-display text-3xl leading-tight tracking-[-0.025em] sm:text-5xl">
              不是三份简历的并排，<br />而是一条完整航线。
            </p>
            <div className="grid gap-5 sm:grid-cols-3">
              {[
                ['01', '把故事组织成可执行的生产系统'],
                ['02', '把模型锻造成稳定可信的镜头'],
                ['03', '把内容送到真正会回应的市场'],
              ].map(([number, text]) => (
                <div key={number} className="border-l border-black/10 pl-4">
                  <span className="text-[0.65rem] font-semibold tracking-[0.18em] text-[#6f6f6f]">{number}</span>
                  <p className="mt-2 text-sm leading-6 text-[#4f4f4f]">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}

function MetricCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="metric-card rounded-3xl p-5 sm:p-6">
      <p className="font-display text-4xl tracking-[-0.03em] sm:text-5xl">{value}</p>
      <p className="mt-2 text-xs leading-5 text-[#6f6f6f]">{label}</p>
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

  return (
    <>
      <SiteHeader memberPage />
      <main className="relative z-10 px-4 pb-20 pt-14 sm:px-6 sm:pb-28 sm:pt-20 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <a href="#team" className="inline-flex items-center gap-2 rounded-full text-sm text-[#5f5f5f] transition-colors hover:text-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black">
            <ArrowLeftIcon />
            返回团队
          </a>

          <section className="member-hero mt-8 overflow-hidden rounded-[2.5rem] p-6 sm:p-10 lg:p-14">
            <div className="grid gap-10 lg:grid-cols-[1.32fr_0.68fr] lg:items-end">
              <div>
                <div className="flex items-center gap-3 text-xs font-medium tracking-[0.18em] text-[#6f6f6f] uppercase">
                  <span>{member.sequence}</span>
                  <span className="h-px w-10 bg-black/15" />
                  <span>{member.role}</span>
                </div>
                <h1 className="font-display mt-8 text-[4.4rem] leading-[0.83] tracking-[-0.055em] sm:text-[7.5rem] lg:text-[9.5rem]">
                  {member.name}
                </h1>
                <p className="mt-5 text-sm tracking-[0.08em] text-[#6f6f6f]">{member.romanizedName} · {member.education}</p>
              </div>
              <div className="member-seal ml-auto grid aspect-square w-full max-w-[18rem] place-items-center rounded-full p-8 text-center">
                <span className="font-display text-3xl leading-tight italic text-[#3f3f3f]">{member.poeticRole}</span>
              </div>
            </div>

            <div className="mt-14 grid gap-8 border-t border-black/10 pt-10 lg:grid-cols-[0.75fr_1.25fr]">
              <p className="text-xs font-medium tracking-[0.18em] text-[#6f6f6f] uppercase">Role in OneCrew</p>
              <p className="font-display max-w-4xl text-3xl leading-[1.12] tracking-[-0.02em] text-[#333] sm:text-5xl">{member.thesis}</p>
            </div>
          </section>

          <section className="mt-5 grid gap-5 lg:grid-cols-[0.76fr_1.24fr]">
            <aside className="member-panel h-fit rounded-[2rem] p-6 sm:p-8 lg:sticky lg:top-28">
              <p className="text-xs font-medium tracking-[0.18em] text-[#6f6f6f] uppercase">关于 {member.name}</p>
              <p className="mt-6 text-base leading-8 text-[#4f4f4f]">{member.introduction}</p>
              <div className="mt-8 flex flex-wrap gap-2">
                {member.focus.map((focus) => (
                  <span key={focus} className="rounded-full border border-black/10 bg-white/40 px-3 py-2 text-[0.7rem] text-[#5f5f5f]">{focus}</span>
                ))}
              </div>
              <div className="mt-9 grid grid-cols-3 gap-2">
                {member.metrics.map((metric) => <MetricCard key={metric.value} {...metric} />)}
              </div>
            </aside>

            <div className="space-y-5">
              <section className="member-panel rounded-[2rem] p-6 sm:p-9">
                <div className="flex items-end justify-between gap-6">
                  <div>
                    <p className="text-xs font-medium tracking-[0.18em] text-[#6f6f6f] uppercase">Selected Experience</p>
                    <h2 className="font-display mt-4 text-4xl tracking-[-0.03em] sm:text-5xl">与命题相关的精选履历</h2>
                  </div>
                  <span className="hidden font-display text-6xl text-black/10 sm:block">03</span>
                </div>

                <div className="mt-10 divide-y divide-black/10 border-t border-black/10">
                  {member.experience.map((item, index) => (
                    <article key={item.title} className="grid gap-5 py-8 sm:grid-cols-[4.5rem_1fr]">
                      <span className="font-display text-3xl text-black/20">0{index + 1}</span>
                      <div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <span className="text-[0.65rem] font-semibold tracking-[0.16em] text-[#6f6f6f] uppercase">{item.eyebrow}</span>
                          <span className="text-xs text-[#8a8a8a]">{item.period}</span>
                        </div>
                        <h3 className="font-display mt-3 text-3xl leading-tight tracking-[-0.02em] sm:text-4xl">{item.title}</h3>
                        <p className="mt-4 text-sm leading-7 text-[#565656] sm:text-base sm:leading-8">{item.description}</p>
                        {item.result ? <p className="mt-4 border-l-2 border-black pl-4 text-sm font-medium leading-6 text-[#343434]">{item.result}</p> : null}
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="member-panel rounded-[2rem] p-6 sm:p-9">
                <p className="text-xs font-medium tracking-[0.18em] text-[#6f6f6f] uppercase">What this adds to OneCrew</p>
                <h2 className="font-display mt-4 text-4xl tracking-[-0.03em] sm:text-5xl">为这条航线补上的三块拼图</h2>
                <ol className="mt-9 space-y-4">
                  {member.contribution.map((item, index) => (
                    <li key={item} className="grid gap-4 rounded-2xl border border-black/8 bg-white/30 p-5 sm:grid-cols-[2.5rem_1fr] sm:items-start">
                      <span className="font-display text-2xl text-[#6f6f6f]">0{index + 1}</span>
                      <p className="text-sm leading-7 text-[#484848] sm:text-base">{item}</p>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="member-links rounded-[2rem] bg-black p-7 text-white sm:p-9">
                <div className="flex flex-col justify-between gap-8 sm:flex-row sm:items-end">
                  <div>
                    <p className="text-xs font-medium tracking-[0.18em] text-white/50 uppercase">Selected Links</p>
                    <h2 className="font-display mt-4 text-4xl tracking-[-0.03em] sm:text-5xl">沿着作品，继续认识。</h2>
                  </div>
                  <div className="flex flex-wrap gap-3 sm:justify-end">
                    {member.links.map((link) => (
                      <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-3 text-sm transition-colors hover:bg-white hover:text-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
                        {link.label}
                        <ArrowUpRightIcon />
                      </a>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </section>
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
