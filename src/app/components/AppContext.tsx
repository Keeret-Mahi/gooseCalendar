import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type {
  CourseSelection,
  EventCandidate,
  EventGroup,
  EventType,
  ExportConfig,
  ExportColorStrategy,
  ExportNotificationSetting,
  GoogleCalendarMode,
  GoogleEventColorMode,
  ParsedCourse,
  ParsedSectionOption,
  UploadedOutline,
} from "../lib/types";
import {
  buildCalendarIcs,
  createDefaultCourseSelection,
  downloadIcsFile,
  getExportValidationIssues,
  validateEventForExport,
} from "../lib/calendar";
import {
  DEFAULT_GOOGLE_EVENT_COLOR_PALETTE_ID,
  ensurePaletteColorCount,
} from "../lib/palettes";
import {
  exportEventsToGoogleCalendar,
  isGoogleCalendarConfigured,
  type GoogleCalendarExportProgress,
  type GoogleCalendarExportResult,
} from "../lib/googleCalendar";
import { trackAnalyticsEvent } from "../lib/analytics";
import { parseOutlineHtmlWithAi } from "../lib/parser";

interface AppContextType {
  uploads: UploadedOutline[];
  courses: ParsedCourse[];
  events: EventCandidate[];
  selections: Record<string, CourseSelection>;
  exportConfig: ExportConfig;
  isParsing: boolean;
  adminModeEnabled: boolean;
  setAdminModeEnabled: (enabled: boolean) => void;
  addFiles: (newFiles: FileList | File[]) => void;
  removeUpload: (uploadId: string) => void;
  clearFiles: () => void;
  updateSelection: (
    courseId: string,
    updater: (current: CourseSelection) => CourseSelection
  ) => void;
  updateEvent: (
    eventId: string,
    updater: (current: EventCandidate) => EventCandidate
  ) => void;
  createDraftEvent: (courseId: string, eventType: EventType) => EventCandidate | null;
  addEvent: (event: EventCandidate) => string | null;
  setPaletteId: (paletteId: string) => void;
  setCustomColors: (colors: string[]) => void;
  setColorStrategy: (colorStrategy: ExportColorStrategy) => void;
  setGoogleCalendarMode: (mode: GoogleCalendarMode) => void;
  setGoogleEventColorMode: (mode: GoogleEventColorMode) => void;
  setGoogleUniformColorId: (colorId: string) => void;
  setNotificationSetting: (
    eventGroup: EventGroup,
    notificationSetting: ExportNotificationSetting
  ) => void;
  setCustomNotificationMinutes: (eventGroup: EventGroup, minutes: number) => void;
  exportValidationIssues: ReturnType<typeof getExportValidationIssues>;
  googleCalendarConfigured: boolean;
  exportToGoogleCalendar: (
    onProgress?: (progress: GoogleCalendarExportProgress) => void
  ) => Promise<GoogleCalendarExportResult>;
  downloadCalendar: () => void;
}

export const AppContext = createContext<AppContextType | null>(null);

function buildStableId(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

const defaultExportConfig: ExportConfig = {
  paletteId: DEFAULT_GOOGLE_EVENT_COLOR_PALETTE_ID,
  customColors: ensurePaletteColorCount([
    "#e74c3c",
    "#3498db",
    "#2ecc71",
    "#f1c40f",
    "#9b59b6",
  ]),
  colorStrategy: "eventGroup",
  googleCalendarMode: "single",
  googleEventColorMode: "uniform",
  googleUniformColorId: "5",
  notificationSettings: {
    Lecture: "default",
    Tutorial: "default",
    Lab: "default",
    "Office Hours": "default",
    Assessments: "default",
    Assignments: "default",
    Other: "default",
  },
  customNotificationMinutes: {
    Lecture: 15,
    Tutorial: 15,
    Lab: 15,
    "Office Hours": 15,
    Assessments: 15,
    Assignments: 15,
    Other: 15,
  },
};

const ADMIN_MODE_STORAGE_KEY = "goosecalendar:admin-mode";

function readStoredAdminMode() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ADMIN_MODE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function eventGroupForType(eventType: EventType): EventGroup {
  switch (eventType) {
    case "Lecture":
      return "Lecture";
    case "Tutorial":
      return "Tutorial";
    case "Lab":
      return "Lab";
    case "OfficeHours":
      return "Office Hours";
    case "Assessment":
      return "Assessments";
    case "Assignment":
      return "Assignments";
    default:
      return "Other";
  }
}

function meetingCodeForType(eventType: Extract<EventType, "Lecture" | "Tutorial" | "Lab">) {
  switch (eventType) {
    case "Lecture":
      return "LEC";
    case "Tutorial":
      return "TUT";
    case "Lab":
      return "LAB";
  }
}

function sectionMatchesEventType(section: ParsedSectionOption, eventType: EventType) {
  const normalizedKind = section.kind.toUpperCase();
  if (eventType === "Lab") return normalizedKind.includes("LAB");
  if (eventType === "Tutorial") return normalizedKind.includes("TUT");
  if (eventType === "Lecture") {
    return !normalizedKind.includes("LAB") && !normalizedKind.includes("TUT");
  }
  return false;
}

function fallbackInstructorSection(
  course: ParsedCourse,
  selection: CourseSelection | undefined
) {
  const selectedSections = course.sectionOptions.filter((section) =>
    selection?.selectedSectionOptionIds.includes(section.id)
  );

  return (
    selectedSections.find((section) => section.instructorName || section.instructorEmail) ??
    course.sectionOptions.find((section) => section.instructorName || section.instructorEmail)
  );
}

function buildManualEventDraft(
  course: ParsedCourse,
  selection: CourseSelection,
  allEvents: EventCandidate[],
  eventType: EventType
) {
  const matchingSection =
    course.sectionOptions.find(
      (section) =>
        selection.selectedSectionOptionIds.includes(section.id) &&
        sectionMatchesEventType(section, eventType)
    ) ??
    course.sectionOptions.find((section) => sectionMatchesEventType(section, eventType));
  const instructorSection = fallbackInstructorSection(course, selection);
  const eventId = buildStableId(`${course.id}:${eventType}:${Date.now()}:${allEvents.length}`);
  const eventGroup = eventGroupForType(eventType);

  const baseLabel = (() => {
    if (eventType === "Lecture" || eventType === "Tutorial" || eventType === "Lab") {
      return matchingSection?.label ? `${eventType} ${matchingSection.label}` : eventType;
    }
    if (eventType === "OfficeHours") {
      return instructorSection?.instructorName
        ? `Office Hours with ${instructorSection.instructorName}`
        : "Office Hours";
    }
    if (eventType === "Assessment") return "Assessment";
    if (eventType === "Assignment") return "Assignment";
    return "Other Event";
  })();

  const title = (() => {
    if (eventType === "Lecture" || eventType === "Tutorial" || eventType === "Lab") {
      return `${course.courseCode} (${meetingCodeForType(eventType)})`;
    }
    if (eventType === "OfficeHours") {
      return `${course.courseCode} Office Hours`;
    }
    if (eventType === "Assessment") return `${course.courseCode} Assessment`;
    if (eventType === "Assignment") return `${course.courseCode} Assignment`;
    return `${course.courseCode} Event`;
  })();

  const draftEvent: EventCandidate = {
    id: eventId,
    outlineId: course.outlineId,
    courseId: course.id,
    courseCode: course.courseCode,
    courseName: course.courseName,
    label: baseLabel,
    title,
    location:
      eventType === "Lecture" || eventType === "Tutorial" || eventType === "Lab"
        ? matchingSection?.location ?? ""
        : "",
    eventType,
    eventGroup,
    sectionOptionIds:
      matchingSection && (eventType === "Lecture" || eventType === "Tutorial" || eventType === "Lab")
        ? [matchingSection.id]
        : [],
    extractedSectionLabels: matchingSection?.label ? [matchingSection.label] : [],
    instructorName: instructorSection?.instructorName,
    instructorEmail: instructorSection?.instructorEmail,
    notes: [],
    confidence: "high",
    reviewNeeded: true,
    include: true,
    timing:
      eventType === "Lecture" ||
      eventType === "Tutorial" ||
      eventType === "Lab" ||
      eventType === "OfficeHours"
        ? {
            kind: "recurring",
            startDate: undefined,
            endDate: undefined,
            startTime: undefined,
            endTime: undefined,
            byDay: [],
            exDates: [],
            occurrenceNotes: {},
            occurrenceOverrides: {},
          }
        : {
            kind: "single",
            date: undefined,
            endDate: undefined,
            startTime: undefined,
            endTime: undefined,
            allDay: false,
          },
    provenance: [],
  };

  draftEvent.reviewNeeded = !!validateEventForExport(draftEvent);

  return draftEvent;
}

function normalizeNoteText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function removeResolvedDateNotes(event: EventCandidate) {
  if (event.timing.kind !== "single" || !event.timing.date) {
    return event;
  }

  const notes = event.notes.filter((note) => {
    const normalized = normalizeNoteText(note);
    return !/^(?:date unresolved|due date unresolved)\b/i.test(normalized);
  });

  return notes.length === event.notes.length ? event : { ...event, notes };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [uploads, setUploads] = useState<UploadedOutline[]>([]);
  const [courses, setCourses] = useState<ParsedCourse[]>([]);
  const [events, setEvents] = useState<EventCandidate[]>([]);
  const [selections, setSelections] = useState<Record<string, CourseSelection>>({});
  const [exportConfig, setExportConfig] = useState<ExportConfig>(defaultExportConfig);
  const [adminModeEnabled, setAdminModeEnabledState] = useState(readStoredAdminMode);
  const parsingIdsRef = useRef<Set<string>>(new Set());
  const removedUploadIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setExportConfig((current) => ({
      paletteId: current.paletteId ?? defaultExportConfig.paletteId,
      customColors: ensurePaletteColorCount(
        current.customColors?.length ? current.customColors : defaultExportConfig.customColors
      ),
      colorStrategy: current.colorStrategy ?? defaultExportConfig.colorStrategy,
      googleCalendarMode:
        current.googleCalendarMode ?? defaultExportConfig.googleCalendarMode,
      googleEventColorMode:
        current.googleEventColorMode ?? defaultExportConfig.googleEventColorMode,
      googleUniformColorId:
        current.googleUniformColorId ?? defaultExportConfig.googleUniformColorId,
      notificationSettings: {
        ...defaultExportConfig.notificationSettings,
        ...(current.notificationSettings ?? {}),
      },
      customNotificationMinutes: {
        ...defaultExportConfig.customNotificationMinutes,
        ...(current.customNotificationMinutes ?? {}),
      },
    }));
  }, []);

  const setAdminModeEnabled = (enabled: boolean) => {
    setAdminModeEnabledState(enabled);
    if (typeof window === "undefined") return;
    try {
      if (enabled) {
        window.localStorage.setItem(ADMIN_MODE_STORAGE_KEY, "true");
        return;
      }
      window.localStorage.removeItem(ADMIN_MODE_STORAGE_KEY);
    } catch {
      // Admin mode still works for the current session if storage is unavailable.
    }
  };

  useEffect(() => {
    uploads
      .filter((upload) => upload.status === "pending")
      .forEach((upload) => {
        if (parsingIdsRef.current.has(upload.id)) return;
        parsingIdsRef.current.add(upload.id);

        setUploads((current) =>
          current.map((item) =>
            item.id === upload.id ? { ...item, status: "parsing", error: undefined } : item
          )
        );

        upload.file
          .text()
          .then(async (html) => {
            if (removedUploadIdsRef.current.has(upload.id)) return;
            const result = await parseOutlineHtmlWithAi(html, upload.name);

            setCourses((current) => [
              ...current.filter((course) => course.id !== result.course.id),
              result.course,
            ]);
            setEvents((current) => [
              ...current.filter((event) => event.courseId !== result.course.id),
              ...result.events.map(removeResolvedDateNotes),
            ]);
            setSelections((current) => ({
              ...current,
              [result.course.id]: current[result.course.id] ?? createDefaultCourseSelection(result.course),
            }));
            setUploads((current) =>
              current.map((item) =>
                item.id === upload.id
                  ? {
                      ...item,
                      status: "parsed",
                      courseIds: [result.course.id],
                    }
                  : item
              )
            );
          })
          .catch((error) => {
            if (removedUploadIdsRef.current.has(upload.id)) return;
            setUploads((current) =>
              current.map((item) =>
                item.id === upload.id
                  ? {
                      ...item,
                      status: "error",
                      error:
                        error instanceof Error
                          ? error.message
                          : "The outline could not be parsed.",
                    }
                  : item
              )
            );
          })
          .finally(() => {
            parsingIdsRef.current.delete(upload.id);
          });
      });
  }, [uploads]);

  const addFiles = (newFiles: FileList | File[]) => {
    const incomingFiles = Array.from(newFiles);
    const htmlFiles = Array.from(newFiles).filter(
      (file) => file.name.endsWith(".html") || file.name.endsWith(".htm")
    );

    const uploadKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
    const incomingKeys = new Set(htmlFiles.map(uploadKey));
    const duplicateUploads = uploads.filter((upload) => incomingKeys.has(uploadKey(upload.file)));
    const duplicateCourseIds = duplicateUploads.flatMap((upload) => upload.courseIds);

    void trackAnalyticsEvent("outline_upload_attempted", {
      file_count: incomingFiles.length,
      html_file_count: htmlFiles.length,
      rejected_file_count: incomingFiles.length - htmlFiles.length,
      duplicate_file_count: duplicateUploads.length,
    });

    if (htmlFiles.length > 0) {
      void trackAnalyticsEvent("outline_upload_accepted", {
        html_file_count: htmlFiles.length,
        duplicate_file_count: duplicateUploads.length,
      });
    }

    if (duplicateUploads.length > 0) {
      duplicateUploads.forEach((upload) => removedUploadIdsRef.current.add(upload.id));
      if (duplicateCourseIds.length > 0) {
        setCourses((current) => current.filter((course) => !duplicateCourseIds.includes(course.id)));
        setEvents((current) => current.filter((event) => !duplicateCourseIds.includes(event.courseId)));
        setSelections((current) => {
          const next = { ...current };
          duplicateCourseIds.forEach((courseId) => {
            delete next[courseId];
          });
          return next;
        });
      }
    }

    setUploads((current) => {
      const nextExisting = current.filter((upload) => !incomingKeys.has(uploadKey(upload.file)));
      const timestamp = Date.now();
      const nextUploads = htmlFiles.map((file, index) => ({
        id: buildStableId(`${uploadKey(file)}:${timestamp}:${index}`),
        name: file.name,
        file,
        status: "pending" as const,
        courseIds: [],
      }));

      return [...nextExisting, ...nextUploads];
    });
  };

  const removeUpload = (uploadId: string) => {
    removedUploadIdsRef.current.add(uploadId);
    const upload = uploads.find((item) => item.id === uploadId);
    const courseIds = upload?.courseIds ?? [];

    setUploads((current) => current.filter((item) => item.id !== uploadId));
    if (courseIds.length > 0) {
      setCourses((current) => current.filter((course) => !courseIds.includes(course.id)));
      setEvents((current) => current.filter((event) => !courseIds.includes(event.courseId)));
      setSelections((current) => {
        const next = { ...current };
        courseIds.forEach((courseId) => {
          delete next[courseId];
        });
        return next;
      });
    }
  };

  const clearFiles = () => {
    removedUploadIdsRef.current = new Set(uploads.map((upload) => upload.id));
    setUploads([]);
    setCourses([]);
    setEvents([]);
    setSelections({});
  };

  const updateSelection = (
    courseId: string,
    updater: (current: CourseSelection) => CourseSelection
  ) => {
    setSelections((current) => ({
      ...current,
      [courseId]: updater(
        current[courseId] ?? {
          selectedSectionOptionIds: [],
          includedGroups: [],
          selectedOfficeHourEventIds: [],
        }
      ),
    }));
  };

  const updateEvent = (
    eventId: string,
    updater: (current: EventCandidate) => EventCandidate
  ) => {
    setEvents((current) =>
      current.map((event) =>
        event.id === eventId ? removeResolvedDateNotes(updater(event)) : event
      )
    );
  };

  const createDraftEvent = (courseId: string, eventType: EventType) => {
    const course = courses.find((item) => item.id === courseId);
    if (!course) return null;
    const selection = selections[courseId] ?? createDefaultCourseSelection(course);
    return buildManualEventDraft(course, selection, events, eventType);
  };

  const addEvent = (event: EventCandidate) => {
    const course = courses.find((item) => item.id === event.courseId);
    if (!course) return null;
    const eventGroup = eventGroupForType(event.eventType);
    const cleanedEvent = removeResolvedDateNotes({
      ...event,
      eventGroup,
    });
    const reviewNeeded = !!validateEventForExport(cleanedEvent);
    const newEvent = {
      ...cleanedEvent,
      reviewNeeded,
    };

    setEvents((current) => [...current, newEvent]);
    setCourses((current) =>
      current.map((item) =>
        item.id === event.courseId
          ? {
              ...item,
              eventIds: item.eventIds.includes(newEvent.id)
                ? item.eventIds
                : [...item.eventIds, newEvent.id],
              officeHourEventIds:
                newEvent.eventType === "OfficeHours"
                  ? item.officeHourEventIds.includes(newEvent.id)
                    ? item.officeHourEventIds
                    : [...item.officeHourEventIds, newEvent.id]
                  : item.officeHourEventIds,
            }
          : item
      )
    );
    setSelections((current) => {
      const courseSelection = current[event.courseId] ?? createDefaultCourseSelection(course);
      const selectedMeetingSectionIds = newEvent.sectionOptionIds.filter((sectionId) =>
        course.sectionOptions.some((section) => section.id === sectionId)
      );
      return {
        ...current,
        [event.courseId]: {
          ...courseSelection,
          includedGroups: courseSelection.includedGroups.includes(eventGroup)
            ? courseSelection.includedGroups
            : [...courseSelection.includedGroups, eventGroup],
          selectedOfficeHourEventIds:
            newEvent.eventType === "OfficeHours"
              ? courseSelection.selectedOfficeHourEventIds.includes(newEvent.id)
                ? courseSelection.selectedOfficeHourEventIds
                : [...courseSelection.selectedOfficeHourEventIds, newEvent.id]
              : courseSelection.selectedOfficeHourEventIds,
          selectedSectionOptionIds:
            selectedMeetingSectionIds.length > 0
              ? Array.from(
                  new Set([
                    ...courseSelection.selectedSectionOptionIds,
                    ...selectedMeetingSectionIds,
                  ])
                )
              : courseSelection.selectedSectionOptionIds,
        },
      };
    });

    return newEvent.id;
  };

  const setPaletteId = (paletteId: string) => {
    setExportConfig((current) => ({ ...current, paletteId }));
  };

  const setCustomColors = (colors: string[]) => {
    setExportConfig((current) => ({
      ...current,
      customColors: ensurePaletteColorCount(colors),
    }));
  };

  const setColorStrategy = (colorStrategy: ExportColorStrategy) => {
    setExportConfig((current) => ({ ...current, colorStrategy }));
  };

  const setGoogleCalendarMode = (googleCalendarMode: GoogleCalendarMode) => {
    setExportConfig((current) => ({ ...current, googleCalendarMode }));
  };

  const setGoogleEventColorMode = (googleEventColorMode: GoogleEventColorMode) => {
    setExportConfig((current) => ({ ...current, googleEventColorMode }));
  };

  const setGoogleUniformColorId = (googleUniformColorId: string) => {
    setExportConfig((current) => ({ ...current, googleUniformColorId }));
  };

  const setNotificationSetting = (
    eventGroup: EventGroup,
    notificationSetting: ExportNotificationSetting
  ) => {
    setExportConfig((current) => ({
      ...current,
      notificationSettings: {
        ...current.notificationSettings,
        [eventGroup]: notificationSetting,
      },
    }));
  };

  const setCustomNotificationMinutes = (eventGroup: EventGroup, minutes: number) => {
    setExportConfig((current) => ({
      ...current,
      customNotificationMinutes: {
        ...current.customNotificationMinutes,
        [eventGroup]: minutes,
      },
    }));
  };

  const exportValidationIssues = useMemo(
    () => getExportValidationIssues(courses, events, selections),
    [courses, events, selections]
  );

  const downloadCalendar = () => {
    const content = buildCalendarIcs(courses, events, selections, exportConfig);
    downloadIcsFile(content);
  };

  const exportToGoogleCalendar = (
    onProgress?: (progress: GoogleCalendarExportProgress) => void
  ) => exportEventsToGoogleCalendar(courses, events, selections, exportConfig, onProgress);

  const isParsing = uploads.some((upload) => upload.status === "pending" || upload.status === "parsing");

  return (
    <AppContext.Provider
      value={{
        uploads,
        courses,
        events,
        selections,
        exportConfig,
        isParsing,
        adminModeEnabled,
        setAdminModeEnabled,
        addFiles,
        removeUpload,
        clearFiles,
        updateSelection,
        updateEvent,
        createDraftEvent,
        addEvent,
        setPaletteId,
        setCustomColors,
        setColorStrategy,
        setGoogleCalendarMode,
        setGoogleEventColorMode,
        setGoogleUniformColorId,
        setNotificationSetting,
        setCustomNotificationMinutes,
        exportValidationIssues,
        googleCalendarConfigured: isGoogleCalendarConfigured(),
        exportToGoogleCalendar,
        downloadCalendar,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppContext must be used within AppProvider");
  return context;
}
