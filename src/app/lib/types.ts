export type UploadStatus = "pending" | "parsing" | "parsed" | "error";

export type EventType =
  | "Lecture"
  | "Tutorial"
  | "Lab"
  | "OfficeHours"
  | "Assessment"
  | "Assignment"
  | "Other";

export type EventGroup =
  | "Lecture"
  | "Tutorial"
  | "Lab"
  | "Office Hours"
  | "Assessments"
  | "Assignments"
  | "Other";

export type EventConfidence = "high" | "medium" | "low";

export type WeekdayCode = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export interface EventProvenance {
  sectionId: string;
  sectionTitle: string;
  sourceKind: "schedule" | "table" | "prose" | "topic";
  snippet: string;
}

export interface UploadedOutline {
  id: string;
  name: string;
  file: File;
  status: UploadStatus;
  error?: string;
  courseIds: string[];
}

export interface ParsedSectionOption {
  id: string;
  kind: string;
  number: string;
  label: string;
  scheduleSummary?: string;
  location?: string;
  instructorName?: string;
  instructorEmail?: string;
  defaultSelected: boolean;
}

export interface ParsedCourse {
  id: string;
  outlineId: string;
  outlineName: string;
  courseCode: string;
  courseName: string;
  term: string;
  sectionOptions: ParsedSectionOption[];
  eventIds: string[];
  officeHourEventIds: string[];
  warnings: string[];
  summary?: string;
}

export interface RecurringTiming {
  kind: "recurring";
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  byDay: WeekdayCode[];
  exDates: string[];
  occurrenceNotes: Record<string, string[]>;
  occurrenceOverrides: Record<
    string,
    {
      startTime?: string;
      endTime?: string;
      location?: string;
    }
  >;
}

export interface SingleTiming {
  kind: "single";
  date?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  allDay: boolean;
}

export type EventTiming = RecurringTiming | SingleTiming;

export interface EventCandidate {
  id: string;
  outlineId: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  label: string;
  title: string;
  location: string;
  eventType: EventType;
  eventGroup: EventGroup;
  sectionOptionIds: string[];
  extractedSectionLabels: string[];
  instructorName?: string;
  instructorEmail?: string;
  notes: string[];
  confidence: EventConfidence;
  reviewNeeded: boolean;
  include: boolean;
  timing: EventTiming;
  provenance: EventProvenance[];
}

export interface CourseSelection {
  selectedSectionOptionIds: string[];
  includedGroups: EventGroup[];
  selectedOfficeHourEventIds: string[];
}

export type ExportColorStrategy = "eventGroup" | "course";

export type ExportNotificationSetting =
  | "default"
  | "none"
  | "atTime"
  | "10m"
  | "30m"
  | "1h"
  | "1d";

export interface ExportConfig {
  paletteId: string;
  customColors: string[];
  colorStrategy: ExportColorStrategy;
  notificationSettings: Record<EventGroup, ExportNotificationSetting>;
}

export interface OutlineParseResult {
  course: ParsedCourse;
  events: EventCandidate[];
}

export interface ExportValidationIssue {
  eventId: string;
  courseId: string;
  eventLabel: string;
  message: string;
}
