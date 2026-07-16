import { useEffect, useRef } from 'react';

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_083109_283f3553-e28f-428b-a723-d639c617eb2b.mp4';
const GITHUB_URL = 'https://github.com/qybaihe/onecrew';
const BRAND_MARK_URL = `${import.meta.env.BASE_URL}onecrew-mark.png`;

const navigation = [
  { label: '首页', href: '#home', active: true },
  { label: '产品能力', href: `${GITHUB_URL}#主要功能` },
  { label: '工作流', href: `${GITHUB_URL}#系统如何工作` },
  { label: '关于', href: GITHUB_URL },
];

function ArrowUpRightIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path d="M5 15 15 5M7 5h8v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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
    <div aria-hidden="true" className="pointer-events-none absolute right-0 bottom-0 left-0 top-[300px] z-0 overflow-hidden">
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

export function LandingPage() {
  return (
    <div id="home" className="relative min-h-screen w-full overflow-hidden bg-white text-black">
      <CinematicVideo />

      <header className="relative z-10 px-4 pt-4 sm:px-6 sm:pt-5 lg:px-8">
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
                className={`text-sm transition-colors duration-200 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black ${item.active ? 'text-black' : 'text-[#6f6f6f] hover:text-black'}`}
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

      <main className="relative z-10 flex min-h-[calc(100vh-89px)] flex-col items-center justify-center px-6 pb-32 pt-[calc(8rem-75px)] text-center sm:pb-40">
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
    </div>
  );
}
