import svgPaths from "../../imports/svg-muqjom28j6";
import progressSvg from "../../imports/svg-3i7h8lbbf7";
import gooseLogo from "../../assets/goosecalendar-mark.png";

function CalendarIcon() {
  return (
    <svg width="20" height="24" viewBox="0 0 20 24" fill="none">
      <path d={svgPaths.p224deb00} fill="#1C1917" />
    </svg>
  );
}

/* Small white checkmark for completed steps */
function StepCheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14.02 16" fill="none">
      <path d={progressSvg.p2727a000} fill="white" />
    </svg>
  );
}

/* Chevron separator between steps */
function ChevronSeparator() {
  return (
    <div className="px-2 flex items-center">
      <svg width="12" height="16" viewBox="0 0 18 22" fill="none" className="-scale-y-100">
        <path d={progressSvg.p3b221f70} fill="#E8E2CE" />
      </svg>
    </div>
  );
}

type StepStatus = "completed" | "active" | "upcoming";

interface StepDef {
  label: string;
  number: number;
  status: StepStatus;
}

interface NavBarProps {
  currentStep?: number; // 1=Upload, 2=Select Sections, 3=Review Events, 4=Export
  showProgress?: boolean; // whether to show progress steps or "How It Works" link
  onHowItWorksClick?: () => void;
}

function getSteps(currentStep: number): StepDef[] {
  const labels = ["Upload", "Select Sections", "Review Classes", "Export"];
  return labels.map((label, i) => {
    const num = i + 1;
    let status: StepStatus = "upcoming";
    if (num < currentStep) status = "completed";
    else if (num === currentStep) status = "active";
    return { label, number: num, status };
  });
}

function StepBadge({ step }: { step: StepDef }) {
  const isCompleted = step.status === "completed";
  const isActive = step.status === "active";

  return (
    <div
      className="flex items-center justify-center rounded-full size-6 shrink-0 transition-all duration-700 ease-in-out"
      style={{
        backgroundColor: isCompleted
          ? "#16a34a"
          : isActive
          ? "#f2b90d"
          : "transparent",
        borderWidth: !isCompleted && !isActive ? 2 : 0,
        borderColor: "#e8e2ce",
        borderStyle: "solid",
        boxShadow: isActive
          ? "0px 1px 2px 0px rgba(0,0,0,0.05)"
          : "none",
      }}
    >
      {/* Checkmark — fades in when completed */}
      <div
        className="-scale-y-100 absolute transition-opacity duration-700 ease-in-out"
        style={{
          opacity: isCompleted ? 1 : 0,
          pointerEvents: isCompleted ? "auto" : "none",
        }}
      >
        <StepCheckIcon />
      </div>
      {/* Number — fades out when completed */}
      <span
        className="font-['Lexend',sans-serif] font-bold text-xs transition-all duration-700 ease-in-out"
        style={{
          opacity: isCompleted ? 0 : 1,
          color: isActive ? "#221e10" : "#9ca3af",
        }}
      >
        {step.number}
      </span>
    </div>
  );
}

function StepLabel({ step }: { step: StepDef }) {
  return (
    <span
      className="font-['Lexend',sans-serif] text-sm whitespace-nowrap transition-colors duration-700 ease-in-out"
      style={{
        color:
          step.status === "completed"
            ? "#15803d"
            : step.status === "active"
            ? "#f2b90d"
            : "#9ca3af",
        fontWeight: step.status === "active" ? 700 : 500,
      }}
    >
      {step.label}
    </span>
  );
}

export function NavBar({
  currentStep = 4,
  showProgress = true,
  onHowItWorksClick,
}: NavBarProps) {
  const steps = getSteps(currentStep);
  return (
    <nav className="sticky top-0 z-20 w-full backdrop-blur-[2px] bg-[rgba(248,248,245,0.95)] border-b border-[#e8e2ce]">
      <div className="max-w-[1200px] mx-auto flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <div className="flex items-center gap-3 shrink-0">
          <img src={gooseLogo} alt="gooseCalendar" className="size-8 rounded-full object-cover" />
          <span className="font-['Lexend',sans-serif] font-bold text-[#1c180d] text-lg tracking-[-0.45px] whitespace-nowrap hidden sm:inline">
            gooseCalendar
          </span>
        </div>

        {showProgress ? (
          <>
            {/* Desktop Progress Steps */}
            <div className="hidden md:flex items-center">
              {steps.map((step, i) => (
                <div key={step.label} className="flex items-center">
                  {i > 0 && <ChevronSeparator />}
                  <div className="flex items-center gap-2">
                    <StepBadge step={step} />
                    <StepLabel step={step} />
                  </div>
                </div>
              ))}
            </div>

            {/* Mobile Progress — compact dots + label */}
            <div className="flex md:hidden items-center gap-3">
              <div className="flex items-center gap-1.5">
                {steps.map((step) => (
                  <div
                    key={step.number}
                    className="rounded-full transition-all duration-700 ease-in-out"
                    style={{
                      width: step.status === "active" ? 20 : 8,
                      height: 8,
                      backgroundColor:
                        step.status === "completed"
                          ? "#16a34a"
                          : step.status === "active"
                          ? "#f2b90d"
                          : "#e8e2ce",
                    }}
                  />
                ))}
              </div>
              <span className="font-['Lexend',sans-serif] font-medium text-[#78716c] text-xs whitespace-nowrap">
                Step {currentStep} of 4
              </span>
            </div>
          </>
        ) : (
          /* "How It Works" link */
          <button
            type="button"
            onClick={onHowItWorksClick}
            className="flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
          >
            <span className="font-['Lexend',sans-serif] font-medium text-[#645f52] text-sm">
              How It Works
            </span>
          </button>
        )}
      </div>
    </nav>
  );
}
