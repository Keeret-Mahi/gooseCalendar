import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { RouteGuard } from "./RouteGuard";
import { useAppContext } from "./AppContext";
import { FlowFooter } from "./FlowFooter";
import { courseNeedsSectionChoice } from "../lib/calendar";
import { normalizeCourseNameCapitalization } from "../lib/courseNames";
import {
  goosePageBackgroundStyle,
  goosePageContentClass,
  goosePageHeadingClass,
  goosePageMainClass,
  goosePageShellClass,
  goosePageSubheadingClass,
  goosePanelClass,
} from "../lib/designSystem";
import type { EventCandidate, EventGroup, ParsedCourse, ParsedSectionOption } from "../lib/types";
import svgPaths from "../../imports/svg-clq27tba6m";

const GROUP_ORDER: EventGroup[] = [
  "Lecture",
  "Tutorial",
  "Lab",
  "Assessments",
  "Assignments",
  "Other",
  "Office Hours",
];

const DEFAULT_INCLUDED_GROUPS = GROUP_ORDER.filter(
  (group) => group !== "Office Hours"
) as EventGroup[];

function ChevronDownIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className={className}>
      <path d={svgPaths.p27916f80} stroke="#6B7280" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="22" viewBox="0 0 18 22" fill="none" className="-scale-y-100">
      <path d={svgPaths.p36b6600} fill="currentColor" />
    </svg>
  );
}

function LectureIcon() {
  return (
    <svg width="18" height="22" viewBox="0 0 18 22" fill="none" className="-scale-y-100">
      <path d={svgPaths.p3991a80} fill="#9C8749" />
    </svg>
  );
}

function TutorialIcon() {
  return (
    <svg width="18" height="22" viewBox="0 0 18 22" fill="none" className="-scale-y-100">
      <path d={svgPaths.p57dd400} fill="#9C8749" />
    </svg>
  );
}

function LabIcon() {
  return (
    <svg width="18" height="22" viewBox="0 0 18 22" fill="none" className="-scale-y-100">
      <path d={svgPaths.p107c8a80} fill="#9C8749" />
    </svg>
  );
}

function OutlineParsedBadge() {
  return (
    <div className="shrink-0 rounded-full bg-[#f0fdf4] px-3 py-1.5">
      <div className="flex items-center gap-2">
        <svg width="14" height="16" viewBox="0 0 14.01 15.9886" fill="none" className="-scale-y-100">
          <path d={svgPaths.pfced100} fill="#16A34A" />
        </svg>
        <span className="font-['Lexend',sans-serif] text-xs font-bold text-[#16a34a]">
          Outline Parsed
        </span>
      </div>
    </div>
  );
}

function CircleCheckIcon() {
  return (
    <svg width="20" height="24" viewBox="0 0 24.02 28" fill="none" className="-scale-y-100">
      <path d={svgPaths.p3301ef80} fill="#F4C025" />
    </svg>
  );
}

function SelectField({
  icon,
  label,
  options,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  options: ParsedSectionOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-w-[180px] flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-['Lexend',sans-serif] text-sm font-medium text-[#1c180d]">
          {label}
        </span>
      </div>
      <div
        className={`relative flex h-[50px] items-center rounded-lg px-4 ${
          disabled
            ? "cursor-not-allowed border border-[#e8e2ce] bg-[#f3f4f6] opacity-50"
            : "cursor-pointer border border-[#e8e2ce] bg-[#f8f8f5]"
        }`}
      >
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        >
          <option value="">{placeholder || "Select..."}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
              {option.scheduleSummary ? ` (${option.scheduleSummary})` : ""}
            </option>
          ))}
        </select>
        <span
          className={`pointer-events-none pr-8 font-['Lexend',sans-serif] text-base font-normal ${
            !value ? "text-[#6b7280]" : "text-[#1c180d]"
          }`}
        >
          {value
            ? options.find((option) => option.id === value)?.label ?? value
            : placeholder || "Select..."}
        </span>
        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
          <ChevronDownIcon />
        </div>
      </div>
    </div>
  );
}

function TogglePill({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-full border px-4 py-2 transition-all ${
        selected
          ? "border-[#1c180d] bg-[#1c180d] text-white"
          : "border-[#e5e7eb] bg-white text-[#374151]"
      }`}
    >
      <span className="font-['Lexend',sans-serif] text-[15px] font-medium whitespace-nowrap">
        {label}
      </span>
      {selected && <CheckIcon />}
    </button>
  );
}

function PersonCard({
  event,
  selected,
  onClick,
}: {
  event: EventCandidate;
  selected: boolean;
  onClick: () => void;
}) {
  const timingSummary =
    event.timing.kind === "recurring"
      ? `${event.timing.byDay.join("/")} ${[
          event.timing.startTime,
          event.timing.endTime,
        ]
          .filter(Boolean)
          .join("-")}`.trim()
      : event.timing.date ?? "TBD";

  return (
    <button
      onClick={onClick}
      className={`relative flex min-w-[220px] flex-1 cursor-pointer items-center gap-4 rounded-[32px] p-4 transition-all ${
        selected
          ? "border border-[#f4c025] bg-[rgba(244,192,37,0.1)]"
          : "border border-[#e5e7eb] bg-white opacity-70 hover:opacity-90"
      }`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
          selected ? "border border-[rgba(244,192,37,0.2)] bg-white" : "bg-[#f3f4f6]"
        }`}
      >
        <span
          className={`font-['Lexend',sans-serif] text-lg font-bold ${
            selected ? "text-[#f4c025]" : "text-[#9ca3af]"
          }`}
        >
          {(event.instructorName ?? event.label).slice(0, 1).toUpperCase()}
        </span>
      </div>
      <div className="flex flex-col items-start">
        <span
          className={`font-['Lexend',sans-serif] text-base ${
            selected ? "font-bold text-[#1c180d]" : "font-medium text-[#374151]"
          }`}
        >
          {event.instructorName ?? event.label}
        </span>
        <span
          className={`font-['Lexend',sans-serif] text-xs ${
            selected ? "text-[#9c8749]" : "text-[#6b7280]"
          }`}
        >
          {event.location || "Office Hours"} &bull; {timingSummary}
        </span>
      </div>
      {selected && (
        <div className="absolute right-4 top-1/2 -translate-y-1/2">
          <CircleCheckIcon />
        </div>
      )}
    </button>
  );
}

function kindIcon(kind: string) {
  if (kind.includes("LAB")) return <LabIcon />;
  if (kind.includes("TUT")) return <TutorialIcon />;
  return <LectureIcon />;
}

function kindLabel(kind: string) {
  if (kind.includes("LAB")) return "Lab Section";
  if (kind.includes("TUT")) return "Tutorial Section";
  if (kind.includes("LEC")) return "Lecture Section";
  return `${kind} Section`;
}

function orderedSectionGroups(course: ParsedCourse) {
  const byKind = new Map<string, ParsedSectionOption[]>();
  course.sectionOptions.forEach((option) => {
    const current = byKind.get(option.kind) ?? [];
    byKind.set(option.kind, [...current, option]);
  });

  const orderedKinds = ["LEC", "TUT", "LAB"];
  const groups: Array<{ kind: string; options: ParsedSectionOption[] }> = [];

  orderedKinds.forEach((kind) => {
    groups.push({
      kind,
      options: byKind.get(kind) ?? [],
    });
    byKind.delete(kind);
  });

  Array.from(byKind.entries()).forEach(([kind, options]) => {
    groups.push({ kind, options });
  });

  return groups;
}

function CourseCard({
  course,
  courseEvents,
  includedGroups,
  selectedSectionIds,
  selectedOfficeHourEventIds,
  onSelectSection,
  onToggleGroup,
  onToggleOfficeHour,
}: {
  course: ParsedCourse;
  courseEvents: EventCandidate[];
  includedGroups: EventGroup[];
  selectedSectionIds: string[];
  selectedOfficeHourEventIds: string[];
  onSelectSection: (kind: string, sectionId: string) => void;
  onToggleGroup: (group: EventGroup) => void;
  onToggleOfficeHour: (eventId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const sectionGroups = orderedSectionGroups(course);
  const availableGroups = GROUP_ORDER.filter((group) =>
    courseEvents.some((event) => event.eventGroup === group)
  );
  const officeHourEvents = courseEvents.filter((event) => event.eventGroup === "Office Hours");
  const showOfficeHours =
    includedGroups.includes("Office Hours") && officeHourEvents.length > 0;

  return (
    <div className={goosePanelClass}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8e2ce] px-6 py-5">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <span className="rounded bg-[rgba(242,185,13,0.2)] px-2 py-0.5 font-['Lexend',sans-serif] text-xs font-bold uppercase tracking-[0.6px] text-[#854d0e]">
              {course.courseCode}
            </span>
            <span className="font-['Lexend',sans-serif] text-sm font-medium text-[#6b7280]">
              {course.term}
            </span>
          </div>
          <h3 className="font-['Inter',sans-serif] text-xl font-bold text-[#1c180d]">
            {normalizeCourseNameCapitalization(course.courseName)}
          </h3>
        </div>
        <OutlineParsedBadge />
      </div>

      <div className="flex flex-wrap gap-6 px-6 py-5">
        {sectionGroups.map(({ kind, options }) => {
          const selectedId = selectedSectionIds.find((sectionId) =>
            options.some((option) => option.id === sectionId)
          );
          return (
            <SelectField
              key={kind}
              icon={kindIcon(kind)}
              label={kindLabel(kind)}
              options={options}
              value={selectedId ?? ""}
              onChange={(value) => onSelectSection(kind, value)}
              placeholder={options.length > 0 ? "Select Section" : `No ${kindLabel(kind).toLowerCase()} detected`}
              disabled={options.length === 0}
            />
          );
        })}
      </div>

      <div className="border-t border-[#f3f4f6]">
        <button
          onClick={() => setExpanded((current) => !current)}
          className="flex w-full cursor-pointer items-center gap-2 px-6 py-3 transition-colors duration-200 hover:bg-[rgba(0,0,0,0.01)]"
        >
          <span className="font-['Lexend',sans-serif] text-xs font-bold uppercase tracking-[0.6px] text-[#9ca3af]">
            Select Date Types to Add
          </span>
          <svg
            width="18"
            height="22"
            viewBox="0 0 18 22"
            fill="none"
            className={`-scale-y-100 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${expanded ? "rotate-180" : ""}`}
          >
            <path d={svgPaths.p27916f80} stroke="#9CA3AF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div
          className={`grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden">
            <div
              className={`flex flex-col gap-4 px-6 ${showOfficeHours ? "pb-4" : "pb-2"} transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                expanded ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
              }`}
            >
              <div className="-mx-1 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                <div className="flex w-max gap-3 px-1">
                  {availableGroups.map((group) => (
                    <TogglePill
                      key={group}
                      label={group}
                      selected={includedGroups.includes(group)}
                      onClick={() => onToggleGroup(group)}
                    />
                  ))}
                </div>
              </div>

              <div
                className={`grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  showOfficeHours ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <div
                    className={`flex flex-col gap-3 pt-1 transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      showOfficeHours ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-['Lexend',sans-serif] text-xs font-bold uppercase tracking-[0.6px] text-[#9ca3af]">
                        Office Hours
                      </span>
                      <span className="font-['Lexend',sans-serif] text-xs font-normal italic text-[#9c8749]">
                        Toggle which office hours should be added.
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-4">
                      {officeHourEvents.map((event) => (
                        <PersonCard
                          key={event.id}
                          event={event}
                          selected={selectedOfficeHourEventIds.includes(event.id)}
                          onClick={() => onToggleOfficeHour(event.id)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SelectSectionsPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addFiles, courses, events, selections, updateSelection } = useAppContext();
  const [errorMessage, setErrorMessage] = useState("");

  const invalidCourses = useMemo(
    () =>
      courses.filter((course) => {
        const selection = selections[course.id];
        if (!selection) return false;
        if (
          !selection.includedGroups.includes("Lecture") &&
          !selection.includedGroups.includes("Tutorial") &&
          !selection.includedGroups.includes("Lab")
        ) {
          return false;
        }
        return courseNeedsSectionChoice(course, selection);
      }),
    [courses, selections]
  );

  const handleNext = () => {
    if (invalidCourses.length > 0) {
      const names = invalidCourses.map((course) => course.courseCode).join(", ");
      setErrorMessage(
        `Please select the required lecture, tutorial, or lab sections for ${names} before continuing.`
      );
      return;
    }
    setErrorMessage("");
    navigate("/review");
  };

  return (
    <RouteGuard>
      <div
        className={goosePageShellClass}
        style={goosePageBackgroundStyle}
      >
        <main className={goosePageMainClass}>
          <div className={goosePageContentClass}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className={goosePageHeadingClass}>
                  Review Detected Courses
                </h1>
                <p className={goosePageSubheadingClass}>
                  Found lecture, tutorial, lab, and deadline details for {courses.length} courses.
                </p>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-1 flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[#e8e2ce] bg-white px-3.5 py-2 text-[#6b7280] transition-all hover:border-[#d4c99a] hover:text-[#1c180d]"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <span className="font-['Lexend',sans-serif] text-sm font-medium">Add Files</span>
              </button>
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
            </div>

            {courses.map((course) => {
              const selection = selections[course.id] ?? {
                selectedSectionOptionIds: [],
                includedGroups: DEFAULT_INCLUDED_GROUPS,
                selectedOfficeHourEventIds: [],
              };
              const courseEvents = events.filter((event) => event.courseId === course.id);

              return (
                <CourseCard
                  key={course.id}
                  course={course}
                  courseEvents={courseEvents}
                  includedGroups={selection.includedGroups}
                  selectedSectionIds={selection.selectedSectionOptionIds}
                  selectedOfficeHourEventIds={selection.selectedOfficeHourEventIds}
                  onSelectSection={(kind, sectionId) => {
                    updateSelection(course.id, (current) => {
                      const siblingIds = course.sectionOptions
                        .filter((option) => option.kind === kind)
                        .map((option) => option.id);
                      return {
                        ...current,
                        selectedSectionOptionIds: [
                          ...current.selectedSectionOptionIds.filter((id) => !siblingIds.includes(id)),
                          ...(sectionId ? [sectionId] : []),
                        ],
                      };
                    });
                  }}
                  onToggleGroup={(group) => {
                    updateSelection(course.id, (current) => ({
                      ...current,
                      includedGroups: current.includedGroups.includes(group)
                        ? current.includedGroups.filter((item) => item !== group)
                        : [...current.includedGroups, group],
                    }));
                  }}
                  onToggleOfficeHour={(eventId) => {
                    updateSelection(course.id, (current) => ({
                      ...current,
                      selectedOfficeHourEventIds: current.selectedOfficeHourEventIds.includes(eventId)
                        ? current.selectedOfficeHourEventIds.filter((id) => id !== eventId)
                        : [...current.selectedOfficeHourEventIds, eventId],
                    }));
                  }}
                />
              );
            })}
          </div>
        </main>

        <FlowFooter
          backLabel="Back"
          helperText="Only the selected events will be added to your calendar."
          onBack={() => navigate("/")}
          onAction={handleNext}
          actionLabel="Next: Review Classes"
          topContent={
            errorMessage ? (
              <div className="flex items-center gap-2 rounded-lg border border-[#fecaca] bg-[#fef2f2] px-4 py-2.5">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
                  <circle cx="8" cy="8" r="7" stroke="#EF4444" strokeWidth="1.5" />
                  <path d="M8 4.5v4M8 10.5v.5" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="font-['Lexend',sans-serif] text-sm font-medium text-[#DC2626]">
                  {errorMessage}
                </span>
              </div>
            ) : null
          }
        />
      </div>
    </RouteGuard>
  );
}
