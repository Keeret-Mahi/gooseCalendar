import { useEffect, useRef, useState } from "react";

import svgPaths from "../../imports/svg-up87mvwjbr";

function UploadCloudIcon() {
  return (
    <div className="h-[38px] w-[32px] -scale-y-100">
      <svg className="block size-full" fill="none" viewBox="0 0 32 38">
        <path d={svgPaths.p13b85700} fill="#B38F1D" />
      </svg>
    </div>
  );
}

function VideoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 5V19L19 12L8 5Z" fill="#645F52" />
    </svg>
  );
}

function CloseCircleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M18 6L6 18M6 6L18 18"
        stroke="#645F52"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M6 9L12 15L18 9"
        stroke="#1B180D"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 3H5C3.89543 3 3 3.89543 3 5V8M16 3H19C20.1046 3 21 3.89543 21 5V8M3 16V19C3 20.1046 3.89543 21 5 21H8M21 16V19C21 20.1046 20.1046 21 19 21H16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GuidePreview({ kind }: { kind: "upload" | "select" | "review" | "export" }) {
  if (kind === "upload") {
    return (
      <div className="flex h-[120px] flex-col items-center justify-center rounded-[24px] border-2 border-dashed border-[#e0d5a8] bg-[#fffdf7] px-5">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(241,200,75,0.18)]">
          <UploadCloudIcon />
        </div>
        <div className="rounded-full bg-[#f1c84b] px-4 py-2 font-['Inter',sans-serif] text-xs font-bold text-[#1b180d]">
          Upload outlines
        </div>
      </div>
    );
  }

  if (kind === "select") {
    return (
      <div className="flex h-[120px] flex-wrap content-center gap-2 rounded-[24px] bg-[#f8f8f6] px-4 py-4">
        {["Lecture", "Tutorial", "Assignments"].map((label) => (
          <div
            key={label}
            className="rounded-full bg-[#1b180d] px-3 py-1.5 font-['Inter',sans-serif] text-[11px] font-semibold text-white"
          >
            {label}
          </div>
        ))}
      </div>
    );
  }

  if (kind === "review") {
    return (
      <div className="flex h-[120px] flex-col justify-center gap-2 rounded-[24px] bg-[#f8f8f6] px-4 py-4">
        <div className="rounded-2xl border border-[#eadfc3] bg-white px-3 py-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-full bg-[#fff1cc] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#b38f1d]">
              Lecture
            </span>
            <span className="text-xs font-semibold text-[#1b180d]">CS 135 (LEC)</span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-[#78716c]">
            <span>Mon/Wed/Fri · 10:30 AM</span>
            <span>Edit</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[120px] flex-col justify-center gap-3 rounded-[24px] bg-[#f8f8f6] px-4 py-4">
      <div className="flex gap-2">
        <div className="flex h-10 flex-1 items-center justify-center rounded-2xl bg-[#f7efe0] text-xs font-bold text-[#8b8170]">
          Google
        </div>
        <div className="flex h-10 flex-1 items-center justify-center rounded-2xl bg-[#f1c84b] text-xs font-bold text-[#1b180d]">
          .ics
        </div>
      </div>
      <div className="flex gap-1.5">
        {["#879e7d", "#ead7c5", "#98c8d2", "#b7dfe1", "#b9b2a5"].map((color) => (
          <div key={color} className="h-6 flex-1 rounded-full" style={{ backgroundColor: color }} />
        ))}
      </div>
    </div>
  );
}

function GuideStepCard({
  number,
  title,
  description,
  detail,
  kind,
}: {
  number: number;
  title: string;
  description: string;
  detail: string;
  kind: "upload" | "select" | "review" | "export";
}) {
  return (
    <div className="rounded-[28px] border border-[#eadfc3] bg-white p-5 shadow-[0px_12px_30px_-24px_rgba(28,24,13,0.55)]">
      <div className="mb-4 flex items-center justify-between">
        <span className="rounded-full bg-[rgba(241,200,75,0.18)] px-3 py-1 font-['Inter',sans-serif] text-xs font-bold uppercase tracking-[0.12em] text-[#b38f1d]">
          Step {number}
        </span>
      </div>
      <GuidePreview kind={kind} />
      <div className="mt-4 space-y-2">
        <h3 className="font-['Inter',sans-serif] text-[22px] font-bold leading-[28px] text-[#1b180d]">
          {title}
        </h3>
        <p className="font-['Lexend',sans-serif] text-base leading-[26px] text-[#645f52]">
          {description}
        </p>
        <p className="font-['Inter',sans-serif] text-sm leading-[22px] text-[#8b8170]">{detail}</p>
      </div>
    </div>
  );
}

const HOW_IT_WORKS_VIDEO_URL = "https://www.youtube.com/watch?v=8gJ716dhStg&t=430s";
const HOW_IT_WORKS_VIDEO_EMBED_URL = "https://www.youtube.com/embed/8gJ716dhStg?start=430";

const steps = [
  {
    number: 1,
    title: "Upload Course Outlines",
    description: "Drop in one or more Waterloo outline HTML files.",
    detail:
      "gooseCalendar reads deadlines, lectures, labs, tutorials, office hours, and assessments from each outline.",
    kind: "upload" as const,
  },
  {
    number: 2,
    title: "Review and Fix Anything Missing",
    description:
      "Choose sections, edit detected events, add missing ones, and make sure everything looks right.",
    detail: "This is the best place to catch odd outline formatting before anything gets exported.",
    kind: "review" as const,
  },
  {
    number: 3,
    title: "Export Your Calendar",
    description: "Send everything to Google Calendar or download a ready-to-import .ics file.",
    detail: "You can choose a color palette, set reminders, and keep your gooseCalendar export organized.",
    kind: "export" as const,
  },
];

export function HowItWorksModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [videoOpen, setVideoOpen] = useState(false);
  const [isVideoFullscreen, setIsVideoFullscreen] = useState(false);
  const videoFrameRef = useRef<HTMLDivElement | null>(null);
  const activeVideoEmbedUrl = videoOpen ? HOW_IT_WORKS_VIDEO_EMBED_URL : "about:blank";

  const handleFullscreen = async () => {
    const fullscreenDocument = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };

    if (document.fullscreenElement || fullscreenDocument.webkitFullscreenElement) {
      if (typeof document.exitFullscreen === "function") {
        await document.exitFullscreen();
        return;
      }

      if (typeof fullscreenDocument.webkitExitFullscreen === "function") {
        fullscreenDocument.webkitExitFullscreen();
        return;
      }
    }

    const element = videoFrameRef.current;
    if (!element) return;

    const fullscreenTarget = element as HTMLDivElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };

    if (typeof fullscreenTarget.requestFullscreen === "function") {
      await fullscreenTarget.requestFullscreen();
      return;
    }

    if (typeof fullscreenTarget.webkitRequestFullscreen === "function") {
      fullscreenTarget.webkitRequestFullscreen();
      return;
    }

    window.open(HOW_IT_WORKS_VIDEO_URL, "_blank", "noopener,noreferrer");
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreenDocument = document as Document & {
        webkitFullscreenElement?: Element | null;
      };

      const activeElement =
        document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null;

      setIsVideoFullscreen(activeElement === videoFrameRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange as EventListener);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener(
        "webkitfullscreenchange",
        handleFullscreenChange as EventListener,
      );
    };
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(28,24,13,0.36)] px-4 py-6 backdrop-blur-[6px]"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[min(860px,92vh)] w-full max-w-[1180px] flex-col overflow-hidden rounded-[36px] border border-[#eadfc3] bg-[#fffdf9] shadow-[0px_40px_120px_-36px_rgba(28,24,13,0.65)]"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 z-10 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-[#eadfc3] bg-white/95 transition-colors hover:bg-[#f8f8f6]"
          aria-label="Close how it works guide"
        >
          <CloseCircleIcon />
        </button>

        <div className="overflow-y-auto px-6 pb-6 pt-8 sm:px-8 sm:pb-8 sm:pt-10">
          <div className="mx-auto max-w-[1040px]">
            <div className="max-w-[760px]">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[rgba(241,200,75,0.18)] px-4 py-2 font-['Inter',sans-serif] text-xs font-bold uppercase tracking-[0.14em] text-[#b38f1d]">
                <span className="flex h-4 w-4 items-center justify-center">
                  <VideoIcon />
                </span>
                <span className="leading-none">Step-by-step guide</span>
              </div>
              <h2 className="font-['Inter',sans-serif] text-[32px] font-bold leading-[38px] tracking-[-1px] text-[#1b180d] sm:text-[42px] sm:leading-[46px]">
                How to use gooseCalendar
              </h2>
              <p className="mt-3 font-['Inter',sans-serif] text-sm font-medium uppercase tracking-[0.12em] text-[#8b8170]">
                Three quick steps before you export
              </p>
            </div>

            <div className="mt-8 rounded-[28px] border border-[#eadfc3] bg-[linear-gradient(180deg,rgba(241,200,75,0.14)_0%,rgba(255,252,243,0.96)_100%)] p-4">
              <button
                type="button"
                onClick={() => setVideoOpen((current) => !current)}
                className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-[22px] border border-[#e7d89d] bg-[rgba(241,200,75,0.18)] px-4 py-3 text-left transition-colors hover:bg-[rgba(241,200,75,0.24)]"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f1c84b]">
                    <VideoIcon />
                  </div>
                  <div>
                    <p className="font-['Inter',sans-serif] text-[17px] font-bold leading-[22px] text-[#1b180d]">
                      Watch a video walkthrough
                    </p>
                    <p className="mt-0.5 font-['Inter',sans-serif] text-[13px] leading-[20px] text-[#645f52]">
                      Prefer a video? Click here for a quick demo.
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="hidden rounded-full border border-[#dcc46d] bg-white/80 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-[#8d6a00] sm:inline-flex">
                    {videoOpen ? "Hide" : "Show"}
                  </span>
                  <ChevronIcon open={videoOpen} />
                </div>
              </button>

              <div
                className={`overflow-hidden transition-[max-height,opacity,margin] duration-300 ease-out ${
                  videoOpen ? "mt-4 max-h-[720px] opacity-100" : "mt-0 max-h-0 opacity-0"
                }`}
              >
                {HOW_IT_WORKS_VIDEO_URL ? (
                  <div
                    ref={videoFrameRef}
                    className={`relative overflow-hidden ${
                      isVideoFullscreen
                        ? "h-full rounded-none border-none bg-black shadow-none"
                        : "rounded-[24px] border border-[#eadfc3] bg-white shadow-[0px_18px_40px_-28px_rgba(28,24,13,0.55)]"
                    }`}
                  >
                    <div
                      className={`w-full bg-[#1b180d] ${
                        isVideoFullscreen ? "h-full" : "aspect-video"
                      }`}
                    >
                      <iframe
                        src={activeVideoEmbedUrl}
                        aria-label="gooseCalendar walkthrough video"
                        className="h-full w-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        referrerPolicy="strict-origin-when-cross-origin"
                        allowFullScreen
                      />
                    </div>
                    <div
                      className={`flex flex-col ${
                        isVideoFullscreen
                          ? "absolute inset-x-0 bottom-0 z-10 gap-3 bg-gradient-to-t from-[rgba(0,0,0,0.84)] via-[rgba(0,0,0,0.52)] to-transparent px-6 pb-5 pt-14 sm:flex-row sm:items-end sm:justify-between"
                          : "gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                      }`}
                    >
                      <div className={isVideoFullscreen ? "max-w-[420px]" : ""}>
                        <p
                          className={`font-['Inter',sans-serif] text-sm font-semibold ${
                            isVideoFullscreen ? "text-white" : "text-[#1b180d]"
                          }`}
                        >
                          Video walkthrough
                        </p>
                        <p
                          className={`mt-1 font-['Inter',sans-serif] text-xs ${
                            isVideoFullscreen
                              ? "leading-[18px] text-[rgba(255,255,255,0.76)]"
                              : "leading-[20px] text-[#8b8170]"
                          }`}
                        >
                          A quick visual run-through of the full gooseCalendar flow.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handleFullscreen}
                          className={`inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 self-start rounded-full font-['Inter',sans-serif] text-sm font-bold transition-colors ${
                            isVideoFullscreen
                              ? "border border-[rgba(255,255,255,0.24)] bg-[rgba(255,255,255,0.12)] px-4 py-2 text-white hover:bg-[rgba(255,255,255,0.18)]"
                              : "border border-[#eadfc3] bg-white px-5 py-3 text-[#1b180d] hover:bg-[#f8f8f6]"
                          }`}
                        >
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                            <FullscreenIcon />
                          </span>
                          <span className="leading-none">
                            {isVideoFullscreen ? "Exit full screen" : "Full screen"}
                          </span>
                        </button>
                        <a
                          href={HOW_IT_WORKS_VIDEO_URL}
                          target="_blank"
                          rel="noreferrer"
                          className={`inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 self-start rounded-full bg-[#f1c84b] font-['Inter',sans-serif] text-sm font-bold text-[#1b180d] transition-[background-color,box-shadow] hover:bg-[#e8bf3b] hover:shadow-[0px_10px_24px_-16px_rgba(28,24,13,0.55)] ${
                            isVideoFullscreen ? "px-4 py-2" : "px-5 py-3"
                          }`}
                        >
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                            <VideoIcon />
                          </span>
                          <span className="leading-none">Open on YouTube</span>
                        </a>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[22px] border border-dashed border-[#d9c884] bg-white/80 px-4 py-4">
                    <p className="font-['Inter',sans-serif] text-sm font-semibold text-[#1b180d]">
                      YouTube guide coming soon
                    </p>
                    <p className="mt-1 font-['Inter',sans-serif] text-xs leading-[20px] text-[#8b8170]">
                      Add your link to{" "}
                      <code className="rounded bg-[#f8f8f6] px-1.5 py-0.5">HOW_IT_WORKS_VIDEO_URL</code>{" "}
                      in this component when it&apos;s ready.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {steps.map((step) => (
                <GuideStepCard
                  key={step.number}
                  number={step.number}
                  title={step.title}
                  description={step.description}
                  detail={step.detail}
                  kind={step.kind}
                />
              ))}
            </div>

            <div className="mt-8 rounded-[28px] border border-[#eadfc3] bg-white p-6">
              <h3 className="font-['Inter',sans-serif] text-[24px] font-bold text-[#1b180d]">
                Quick tips before you export
              </h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  "Review the events page before exporting. gooseCalendar can make mistakes.",
                  "Assignments and assessments can include both publish and due dates when the outline gives both.",
                  "If something is missing, add it manually from the review page before export.",
                  "Google Calendar export keeps your chosen color palette by creating GooseCalendar calendars.",
                ].map((tip) => (
                  <div
                    key={tip}
                    className="rounded-[22px] border border-[#f0e7d4] bg-[#fffdf7] px-4 py-3 font-['Inter',sans-serif] text-sm leading-[22px] text-[#645f52]"
                  >
                    {tip}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 flex justify-end border-t border-[#f3ecdd] pt-6">
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded-full border border-[#eadfc3] bg-white px-5 py-3 font-['Inter',sans-serif] text-sm font-semibold text-[#645f52] transition-colors hover:bg-[#f8f8f6]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
