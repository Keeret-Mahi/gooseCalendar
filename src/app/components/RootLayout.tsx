import { Outlet, useLocation } from "react-router";
import { NavBar } from "./NavBar";

function getNavBarProps(pathname: string): { currentStep: number; showProgress: boolean } {
  switch (pathname) {
    case "/":
      return { currentStep: 1, showProgress: false };
    case "/sections":
      return { currentStep: 2, showProgress: true };
    case "/review":
      return { currentStep: 3, showProgress: true };
    case "/export":
      return { currentStep: 4, showProgress: true };
    default:
      return { currentStep: 1, showProgress: false };
  }
}

export default function RootLayout() {
  const { pathname } = useLocation();
  const navProps = getNavBarProps(pathname);

  return (
    <>
      <NavBar currentStep={navProps.currentStep} showProgress={navProps.showProgress} />
      <Outlet />
    </>
  );
}
