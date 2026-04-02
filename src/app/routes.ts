import { createBrowserRouter } from "react-router";
import RootLayout from "./components/RootLayout";
import UploadPage from "./components/UploadPage";
import SelectSectionsPage from "./components/SelectSectionsPage";
import ReviewClassesPage from "./components/ReviewClassesPage";
import ExportPage from "./components/ExportPage";
import NotFoundPage from "./components/NotFoundPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, Component: UploadPage },
      { path: "sections", Component: SelectSectionsPage },
      { path: "review", Component: ReviewClassesPage },
      { path: "export", Component: ExportPage },
      { path: "*", Component: NotFoundPage },
    ],
  },
]);