import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router";
import { useAppContext } from "./AppContext";
import svgPaths from "../../imports/svg-up87mvwjbr";
import img920081 from "figma:asset/b92fc544a736117e881173174fe48bce3b51e1e8.png";

function UploadCloudIcon() {
  return (
    <div className="h-[38px] w-[32px] -scale-y-100">
      <svg className="block size-full" fill="none" viewBox="0 0 32 38">
        <path d={svgPaths.p13b85700} fill="#B38F1D" />
      </svg>
    </div>
  );
}

function UploadArrowIcon() {
  return (
    <div className="h-[24px] w-[20px] -scale-y-100">
      <svg className="block size-full" fill="none" viewBox="0 0 20 24">
        <path d={svgPaths.p2bf480} fill="#1B180D" />
      </svg>
    </div>
  );
}

function VideoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M8 5V19L19 12L8 5Z" fill="#645F52" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path
        d="M4 1.33333C3.26667 1.33333 2.67333 1.93333 2.67333 2.66667L2.66667 13.3333C2.66667 14.0667 3.26 14.6667 3.99333 14.6667H12C12.7333 14.6667 13.3333 14.0667 13.3333 13.3333V5.33333L9.33333 1.33333H4ZM8.66667 6V2.33333L12.3333 6H8.66667Z"
        fill="#B38F1D"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M11.0833 3.73917L10.2608 2.91667L7 6.1775L3.73917 2.91667L2.91667 3.73917L6.1775 7L2.91667 10.2608L3.73917 11.0833L7 7.8225L10.2608 11.0833L11.0833 10.2608L7.8225 7L11.0833 3.73917Z"
        fill="#9CA3AF"
      />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="18" height="22" viewBox="0 0 24.02 28" fill="none" className="-scale-y-100">
      <path
        d="M12.01 3.5L10.2425 5.2675L17.455 12.5H3.01V15.5H17.455L10.2425 22.7325L12.01 24.5L23.01 13.5L12.01 3.5Z"
        fill="#1C180D"
      />
    </svg>
  );
}

function StatusBadge({ status, error }: { status: string; error?: string }) {
  const styles =
    status === "parsed"
      ? "bg-[#f0fdf4] text-[#16a34a]"
      : status === "error"
      ? "bg-[#fef2f2] text-[#dc2626]"
      : "bg-[#fefce8] text-[#a16207]";

  return (
    <span
      className={`rounded-full px-2.5 py-1 font-['Inter',sans-serif] text-[11px] font-semibold ${styles}`}
      title={error}
    >
      {status === "parsed"
        ? "Parsed"
        : status === "error"
        ? "Needs attention"
        : status === "parsing"
        ? "Parsing..."
        : "Queued"}
    </span>
  );
}

function StepCard({
  number,
  title,
  description,
  highlighted = false,
}: {
  number: number;
  title: string;
  description: string;
  highlighted?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div
        className={`flex size-10 items-center justify-center rounded-full ${
          highlighted ? "bg-[rgba(241,200,75,0.2)]" : "bg-[#f3f4f6]"
        }`}
      >
        <span className="font-['Inter',sans-serif] text-base font-semibold text-[#1b180d]">
          {number}
        </span>
      </div>
      <div className="space-y-0.5">
        <h3 className="font-['Inter',sans-serif] text-base font-bold text-[#1b180d]">
          {title}
        </h3>
        <p className="font-['Inter',sans-serif] text-sm font-normal text-[#645f52]">
          {description}
        </p>
      </div>
    </div>
  );
}

export default function UploadPage() {
  const navigate = useNavigate();
  const { openHowItWorks } = useOutletContext<{ openHowItWorks: () => void }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { uploads, courses, isParsing, addFiles, removeUpload } = useAppContext();
  const [isDragging, setIsDragging] = useState(false);
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };
  }, []);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    setIsScrolledToBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 8);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  };

  const parsedUploads = uploads.filter((upload) => upload.status === "parsed").length;
  const failedUploads = uploads.filter((upload) => upload.status === "error").length;
  const canContinue = courses.length > 0 && !isParsing;
  const hasOverflow = uploads.length > 4;
  const helperText = useMemo(() => {
    if (uploads.length === 0) return "HTML Files Only · Multiple files supported";
    if (isParsing) return "Extracting dates, schedules, and assessments from your outlines";
    if (courses.length > 0) {
      return `${courses.length} course${courses.length === 1 ? "" : "s"} parsed and ready for section selection`;
    }
    return "Upload at least one valid outline to continue";
  }, [courses.length, isParsing, uploads.length]);

  const steps = [
    {
      number: 1,
      title: "Upload Course Outlines",
      description: "Drop in one or more Waterloo outline HTML files.",
    },
    {
      number: 2,
      title: "Review and Fix Anything Missing",
      description:
        "Choose sections, edit detected events, add missing ones, and make sure everything looks right.",
    },
    {
      number: 3,
      title: "Export Your Calendar",
      description: "Send everything to Google Calendar or download a ready-to-import .ics file.",
    },
  ];

  return (
    <div
      className="relative flex h-[calc(100vh-64px)] flex-col overflow-hidden font-['Inter',sans-serif]"
      style={{
        backgroundImage:
          "linear-gradient(90deg, rgb(248, 248, 246) 0%, rgb(248, 248, 246) 100%)",
      }}
    >
      <div className="pointer-events-none absolute inset-0 hidden overflow-hidden xl:block">
        <div className="absolute left-[3%] top-[30%] h-[210px] w-[200px] -rotate-6 rounded-2xl border border-[#e5e7eb] bg-white/90 p-5 shadow-md backdrop-blur-sm xl:left-[7%] xl:w-[220px]">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-lg">📄</span>
            <span className="font-['Inter',sans-serif] text-sm font-bold text-[#1b180d]">
              Your Outlines
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2.5 rounded-lg border border-[#e5e7eb] bg-[#f8f8f6] px-3 py-2.5">
              <div className="h-2 w-2 shrink-0 rounded-full bg-[#f1c84b]" />
              <span className="truncate text-[11px] text-[#1b180d]">
                CS 246 — Object-Oriented
              </span>
            </div>
            <div className="flex items-center gap-2.5 rounded-lg border border-[#e5e7eb] bg-[#f8f8f6] px-3 py-2.5">
              <div className="h-2 w-2 shrink-0 rounded-full bg-[#B38F1D]" />
              <span className="truncate text-[11px] text-[#1b180d]">
                MATH 239 — Combinatorics
              </span>
            </div>
            <div className="flex items-center gap-2.5 rounded-lg border border-[#e5e7eb] bg-[#f8f8f6] px-3 py-2.5">
              <div className="h-2 w-2 shrink-0 rounded-full bg-[#d4a93a]" />
              <span className="truncate text-[11px] text-[#1b180d]">
                STAT 230 — Probability
              </span>
            </div>
          </div>
        </div>

        <div className="absolute right-[3%] top-[28%] h-[210px] w-[200px] rotate-6 rounded-2xl border border-[#e5e7eb] bg-white/90 p-5 shadow-md backdrop-blur-sm xl:right-[7%] xl:w-[220px]">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-lg">📅</span>
            <span className="font-['Inter',sans-serif] text-sm font-bold text-[#1b180d]">
              Your Calendar
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => (
              <span key={day} className="text-center text-[9px] text-[#645f52]">
                {day}
              </span>
            ))}
            <div className="h-[14px] rounded bg-[#f1c84b]/40" />
            <div className="h-[14px]" />
            <div className="h-[14px] rounded bg-[#f1c84b]/40" />
            <div className="h-[14px]" />
            <div className="h-[14px] rounded bg-[#f1c84b]/40" />
            <div className="h-[14px]" />
            <div className="h-[14px] rounded bg-[#B38F1D]/30" />
            <div className="h-[14px]" />
            <div className="h-[14px] rounded bg-[#B38F1D]/30" />
            <div className="h-[14px]" />
            <div className="h-[14px] rounded bg-[#d4a93a]/30" />
            <div className="h-[14px] rounded bg-[#d4a93a]/30" />
            <div className="h-[14px]" />
            <div className="h-[14px]" />
            <div className="h-[14px] rounded bg-[#d4a93a]/30" />
            <div className="h-[14px]" />
            <div className="h-[14px] rounded bg-[#f1c84b]/30" />
            <div className="h-[14px] rounded bg-[#B38F1D]/25" />
            <div className="h-[14px]" />
            <div className="h-[14px] rounded bg-[#f1c84b]/30" />
            <div className="h-[14px] rounded bg-[#B38F1D]/25" />
            <div className="h-[14px]" />
            <div className="h-[14px] rounded bg-[#d4a93a]/30" />
            <div className="h-[14px] rounded bg-[#f1c84b]/30" />
            <div className="h-[14px]" />
          </div>
        </div>
      </div>

      <main className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pb-4 pt-6 sm:pt-12">
        <div className="h-[20px] shrink-0 sm:h-[40px]" />

        <div className="relative mb-2">
          <div className="absolute bottom-[2px] right-0 h-[10px] w-[155px] sm:h-[12px] sm:w-[257px]">
            <div className="h-full w-full rounded-[2px] bg-[rgba(241,200,75,0.4)]" />
          </div>
          <div className="relative flex items-center gap-0">
            <img
              src={img920081}
              alt=""
              className="relative -top-[4px] mr-1 h-[41px] w-[41px] object-cover"
            />
            <h1 className="text-center font-['Inter',sans-serif] text-[36px] font-bold leading-[36px] tracking-[-1.5px] text-[#1b180d] sm:text-[60px] sm:leading-[60px]">
              gooseCalendar
            </h1>
          </div>
        </div>

        {uploads.length === 0 && (
          <div className="mb-6 mt-1 max-w-[576px] text-center">
            <p className="font-['Lexend',sans-serif] text-[18px] font-normal leading-[28px] text-[#78716c]">
              Upload your{" "}
              <span className="font-medium text-[#645f52] underline decoration-[#d4c99a] underline-offset-2">
                UWaterloo course outlines
              </span>{" "}
              and
              <br />
              get an exportable calendar in seconds.
            </p>
          </div>
        )}

        <div className={`flex w-full max-w-[576px] flex-col gap-4 ${uploads.length > 0 ? "mt-8" : ""}`}>
          {uploads.length === 0 ? (
            <div
              className={`cursor-pointer rounded-3xl border-2 border-dashed bg-white transition-colors ${
                isDragging
                  ? "border-[#f1c84b] bg-[rgba(241,200,75,0.05)]"
                  : "border-[#d1d5db] hover:border-[#e0d5a8]"
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center gap-6 p-8">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(241,200,75,0.2)]">
                  <UploadCloudIcon />
                </div>

                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="flex min-w-[200px] cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#f1c84b] px-8 py-3.5 shadow-[0px_10px_15px_-3px_rgba(0,0,0,0.1),0px_4px_6px_-4px_rgba(0,0,0,0.1)] transition-all hover:brightness-[1.03]"
                >
                  <span className="font-['Inter',sans-serif] text-base font-bold text-[#1b180d]">
                    Upload course outlines
                  </span>
                  <UploadArrowIcon />
                </button>

                <div className="flex flex-col items-center gap-1">
                  <span className="font-['Inter',sans-serif] text-sm font-medium text-[#1b180d]">
                    or drag and drop files here
                  </span>
                  <span className="font-['Inter',sans-serif] text-xs font-normal text-[#645f52]">
                    {helperText}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <div>
                  <span className="font-['Inter',sans-serif] text-sm font-bold text-[#1b180d]">
                    {uploads.length} file{uploads.length !== 1 ? "s" : ""} uploaded
                  </span>
                  <p className="mt-1 font-['Inter',sans-serif] text-[11px] text-[#78716c]">
                    {parsedUploads} parsed, {failedUploads} need attention
                  </p>
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-[rgba(241,200,75,0.15)] px-3 py-1.5 transition-colors hover:bg-[rgba(241,200,75,0.3)]"
                >
                  <span className="font-['Inter',sans-serif] text-xs font-semibold text-[#B38F1D]">
                    + Upload more
                  </span>
                </button>
              </div>
              <div className="relative">
                <div
                  ref={scrollRef}
                  className="flex max-h-[232px] flex-col gap-2 overflow-y-auto pr-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#d4c99a] [&::-webkit-scrollbar-thumb]:hover:bg-[#b8a96e] [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-[#f0ece0] [&::-webkit-scrollbar]:w-[6px]"
                  onScroll={handleScroll}
                >
                  {uploads.map((upload) => (
                    <div
                      key={upload.id}
                      className="flex items-center justify-between rounded-xl border border-[#e5e7eb] bg-white px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-3">
                          <FileIcon />
                          <span className="truncate font-['Inter',sans-serif] text-sm font-medium text-[#1b180d]">
                            {upload.name}
                          </span>
                        </div>
                        <div className="mt-2 pl-7">
                          <p className="font-['Inter',sans-serif] text-[11px] text-[#78716c]">
                            {upload.status === "error"
                              ? upload.error || "This outline could not be parsed"
                              : upload.status === "parsed"
                              ? `${upload.courseIds.length} course${upload.courseIds.length === 1 ? "" : "s"} detected`
                              : "Reading dates, schedules, and assessments from the file"}
                          </p>
                        </div>
                      </div>
                      <div className="ml-4 flex items-center gap-3">
                        <StatusBadge status={upload.status} error={upload.error} />
                        <button
                          onClick={() => removeUpload(upload.id)}
                          className="shrink-0 rounded-full p-1 transition-colors hover:bg-[#f3f4f6]"
                        >
                          <XIcon />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {hasOverflow && !isScrolledToBottom && (
                  <div className="pointer-events-none absolute bottom-0 left-0 right-[7px] h-12 rounded-b-xl bg-gradient-to-t from-[#f8f8f6] to-transparent transition-opacity duration-200" />
                )}
                {hasOverflow && !isScrolledToBottom && (
                  <div className="pointer-events-none absolute bottom-1.5 left-1/2 -translate-x-1/2 animate-bounce">
                    <div className="flex items-center gap-1 rounded-full border border-[#e0d5a8] bg-white/90 px-2.5 py-0.5 shadow-sm">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 3.5L5 6.5L8 3.5" stroke="#B38F1D" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".html,.htm"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = "";
            }}
          />

          {uploads.length > 0 && (
            <button
              onClick={() => navigate("/sections")}
              disabled={!canContinue}
              className={`flex w-full items-center justify-center gap-2 rounded-2xl px-8 py-3.5 shadow-[0px_10px_15px_-3px_rgba(0,0,0,0.1),0px_4px_6px_-4px_rgba(0,0,0,0.1)] transition-all ${
                canContinue
                  ? "cursor-pointer bg-[#f1c84b] hover:brightness-[1.03]"
                  : "cursor-not-allowed bg-[#ece7db]"
              }`}
            >
              <span
                className={`font-['Inter',sans-serif] text-base font-bold ${
                  canContinue ? "text-[#1b180d]" : "text-[#8b8170]"
                }`}
              >
                {isParsing ? "Parsing outlines..." : "Next: Select Sections"}
              </span>
              {canContinue && <ArrowRightIcon />}
            </button>
          )}

          <div className="group mt-2 flex cursor-pointer items-center justify-center gap-2">
            <button
              type="button"
              onClick={openHowItWorks}
              className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full px-3 py-2 transition-colors hover:bg-[rgba(241,200,75,0.08)]"
            >
              <VideoIcon />
              <span className="font-['Inter',sans-serif] text-sm font-normal text-[#645f52] transition-colors group-hover:underline">
                Watch a video to see how it works
              </span>
            </button>
          </div>
        </div>

        <section className="hidden w-full max-w-[768px] border-t border-[#f3f4f6] pt-12 min-[1800px]:mt-4 min-[1800px]:grid min-[1800px]:grid-cols-3 min-[1800px]:gap-8">
          {steps.map((step) => (
            <StepCard
              key={step.number}
              number={step.number}
              title={step.title}
              description={step.description}
              highlighted={step.number === 3}
            />
          ))}
        </section>
      </main>

      <footer className="shrink-0 border-t border-[#e5e7eb] bg-white px-4 py-2 sm:px-20 sm:py-3">
        <div className="mx-auto flex max-w-[1280px] items-center justify-center">
          <span className="font-['Inter',sans-serif] text-xs font-normal text-[#645f52] sm:text-sm">
            Made by Keeret Mahi · 2026
          </span>
        </div>
      </footer>
    </div>
  );
}
