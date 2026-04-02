import { JSDOM } from "jsdom";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { MemoryRouter, Route, Routes } from "react-router";
import ReviewClassesPage from "../src/app/components/ReviewClassesPage";
import { AppContext } from "../src/app/components/AppContext";
import type {
  CourseSelection,
  EventCandidate,
  ExportConfig,
  ParsedCourse,
  UploadedOutline,
} from "../src/app/lib/types";
import { ensurePaletteColorCount } from "../src/app/lib/palettes";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost/review",
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLButtonElement: dom.window.HTMLButtonElement,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
});

Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});

const upload: UploadedOutline = {
  id: "u1",
  name: "test.html",
  file: new File([""], "test.html", { type: "text/html" }),
  status: "parsed",
  courseIds: ["course-1"],
};

const course: ParsedCourse = {
  id: "course-1",
  outlineId: "outline-1",
  outlineName: "test.html",
  courseCode: "ECE 109",
  courseName: "Principles of Electronic Materials for Engineering",
  term: "Winter 2026",
  sectionOptions: [
    {
      id: "sec-1",
      kind: "LEC",
      number: "001",
      label: "LEC 001",
      defaultSelected: true,
      instructorName: "Prof Test",
      instructorEmail: "test@uwaterloo.ca",
      location: "E7 4043",
    },
  ],
  eventIds: ["event-1"],
  officeHourEventIds: [],
  warnings: [],
};

const event: EventCandidate = {
  id: "event-1",
  outlineId: "outline-1",
  courseId: "course-1",
  courseCode: "ECE 109",
  courseName: course.courseName,
  label: "Lecture LEC 001",
  title: "ECE 109 (LEC)",
  location: "E7 4043",
  eventType: "Lecture",
  eventGroup: "Lecture",
  sectionOptionIds: ["sec-1"],
  extractedSectionLabels: ["LEC 001"],
  instructorName: "Prof Test",
  instructorEmail: "test@uwaterloo.ca",
  notes: [],
  confidence: "high",
  reviewNeeded: false,
  include: true,
  timing: {
    kind: "recurring",
    startDate: "2026-01-05",
    endDate: "2026-04-06",
    startTime: "08:30",
    endTime: "09:20",
    byDay: ["MO"],
    exDates: [],
    occurrenceNotes: {},
    occurrenceOverrides: {},
  },
  provenance: [],
};

const selection: CourseSelection = {
  selectedSectionOptionIds: ["sec-1"],
  includedGroups: ["Lecture", "Assignments", "Assessments", "Tutorial", "Lab", "Other"],
  selectedOfficeHourEventIds: [],
};

const exportConfig: ExportConfig = {
  paletteId: "",
  customColors: ensurePaletteColorCount([
    "#e74c3c",
    "#3498db",
    "#2ecc71",
    "#f1c40f",
    "#9b59b6",
  ]),
};

let events = [event];

const contextValue = {
  uploads: [upload],
  courses: [course],
  events,
  selections: { [course.id]: selection },
  exportConfig,
  isParsing: false,
  addFiles: () => {},
  removeUpload: () => {},
  clearFiles: () => {},
  updateSelection: () => {},
  updateEvent: (eventId: string, updater: (current: EventCandidate) => EventCandidate) => {
    events = events.map((item) => (item.id === eventId ? updater(item) : item));
    contextValue.events = events;
    rerender();
  },
  createDraftEvent: (_courseId: string, eventType: EventCandidate["eventType"]) => ({
    id: "draft-1",
    outlineId: "outline-1",
    courseId: "course-1",
    courseCode: "ECE 109",
    courseName: course.courseName,
    label: eventType,
    title: `ECE 109 ${eventType}`,
    location: "",
    eventType,
    eventGroup:
      eventType === "Lecture"
        ? "Lecture"
        : eventType === "Tutorial"
          ? "Tutorial"
          : eventType === "Lab"
            ? "Lab"
            : eventType === "OfficeHours"
              ? "Office Hours"
              : eventType === "Assignment"
                ? "Assignments"
                : eventType === "Assessment"
                  ? "Assessments"
                  : "Other",
    sectionOptionIds: [],
    extractedSectionLabels: [],
    instructorName: undefined,
    instructorEmail: undefined,
    notes: [],
    confidence: "high",
    reviewNeeded: true,
    include: true,
    timing:
      eventType === "Lecture" || eventType === "Tutorial" || eventType === "Lab" || eventType === "OfficeHours"
        ? {
            kind: "recurring" as const,
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
            kind: "single" as const,
            date: undefined,
            endDate: undefined,
            startTime: undefined,
            endTime: undefined,
            allDay: false,
          },
    provenance: [],
  }),
  addEvent: (draft: EventCandidate) => {
    events = [...events, draft];
    contextValue.events = events;
    rerender();
    return draft.id;
  },
  setPaletteId: () => {},
  setCustomColors: () => {},
  exportValidationIssues: [],
  downloadCalendar: () => {},
  googleCalendarConfigured: false,
  exportToGoogleCalendar: async () => ({ calendars: [], eventsCreated: 0, eventsUpdated: 0 }),
};

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing root");
}

const root = createRoot(container);

function renderApp() {
  root.render(
    <AppContext.Provider value={contextValue as never}>
      <MemoryRouter initialEntries={["/review"]}>
        <Routes>
          <Route path="/review" element={<ReviewClassesPage />} />
        </Routes>
      </MemoryRouter>
    </AppContext.Provider>
  );
}

function rerender() {
  act(() => {
    renderApp();
  });
}

rerender();

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const addButton = Array.from(document.querySelectorAll("button")).find((button) =>
  button.textContent?.includes("Add Event")
);

if (!addButton) {
  throw new Error("Could not find Add Event button");
}

await act(async () => {
  addButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(0);
});

const assignmentTypeButton = Array.from(document.querySelectorAll("button")).find((button) =>
  button.textContent?.trim() === "Assignment"
);

if (!assignmentTypeButton) {
  throw new Error("Could not find Assignment type button");
}

await act(async () => {
  assignmentTypeButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(0);
});

await wait(0);

const foundModalHeading = Array.from(document.querySelectorAll("*")).some((node) =>
  node.textContent?.includes("Enter the event details, then add it to this course.")
);

console.log(
  JSON.stringify(
    {
      foundModalHeading,
      bodyText: document.body.textContent?.replace(/\s+/g, " ").trim(),
    },
    null,
    2
  )
);
