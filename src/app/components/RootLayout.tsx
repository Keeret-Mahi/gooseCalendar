import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { HowItWorksModal } from "./HowItWorksModal";
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
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  useEffect(() => {
    if (!showHowItWorks) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowHowItWorks(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showHowItWorks]);

  return (
    <>
      <NavBar
        currentStep={navProps.currentStep}
        showProgress={navProps.showProgress}
        onHowItWorksClick={() => setShowHowItWorks(true)}
      />
      <Outlet context={{ openHowItWorks: () => setShowHowItWorks(true) }} />
      <HowItWorksModal open={showHowItWorks} onClose={() => setShowHowItWorks(false)} />
    </>
  );
}
