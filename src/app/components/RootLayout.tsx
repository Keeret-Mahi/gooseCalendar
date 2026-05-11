import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Outlet, useLocation } from "react-router";
import { useAppContext } from "./AppContext";
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

const ADMIN_KEY_SEQUENCE = "gooseadmin";

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

function AdminUnlockModal({
  onClose,
  onUnlock,
}: {
  onClose: () => void;
  onUnlock: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const configuredPassword =
    import.meta.env.VITE_GOOSECALENDAR_ADMIN_PASSWORD?.trim() ?? "";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!configuredPassword) {
      setError("Admin password is not configured.");
      return;
    }
    if (password !== configuredPassword) {
      setError("Incorrect password.");
      return;
    }
    setPassword("");
    setError("");
    onUnlock();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 px-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[380px] rounded-2xl border border-[#e8e2ce] bg-white p-6 shadow-[0px_22px_70px_-18px_rgba(28,24,13,0.35)]"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-['Inter',sans-serif] text-[22px] font-black tracking-[-0.4px] text-[#1c180d]">
              Admin Unlock
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-[#78716c]">
              Enter the password to enable full gooseCalendar controls.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-full p-2 text-[#a8a29e] transition-colors hover:bg-[#faf7ef] hover:text-[#57534e]"
            aria-label="Close admin unlock"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <label className="block">
          <span className="mb-2 block font-['Lexend',sans-serif] text-xs font-bold uppercase tracking-[0.12em] text-[#a8a29e]">
            Password
          </span>
          <input
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setError("");
            }}
            autoFocus
            className="h-12 w-full rounded-xl border border-[#e8e2ce] bg-[#fffdf9] px-4 font-['Inter',sans-serif] text-sm font-semibold text-[#1c180d] outline-none transition focus:border-[#f2b90d] focus:ring-2 focus:ring-[#f2b90d]/20"
          />
        </label>

        {error && (
          <p className="mt-3 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-sm font-medium text-[#b91c1c]">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-xl border border-[#e8e2ce] bg-white px-5 py-3 text-sm font-semibold text-[#78716c] transition-colors hover:bg-[#faf9f6]"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="cursor-pointer rounded-xl bg-[#f2b90d] px-5 py-3 text-sm font-bold text-[#1c180d] shadow-[0px_0px_0px_2px_rgba(242,185,13,0.18)] transition-all hover:brightness-[1.03]"
          >
            Unlock
          </button>
        </div>
      </form>
    </div>
  );
}

export default function RootLayout() {
  const { pathname } = useLocation();
  const { adminModeEnabled, setAdminModeEnabled } = useAppContext();
  const navProps = getNavBarProps(pathname);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showAdminUnlock, setShowAdminUnlock] = useState(false);

  useEffect(() => {
    if (!showHowItWorks) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowHowItWorks(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showHowItWorks]);

  useEffect(() => {
    let keyBuffer = "";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowAdminUnlock(false);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) {
        return;
      }
      if (isEditableTarget(event.target)) return;

      keyBuffer = `${keyBuffer}${event.key.toLowerCase()}`.slice(
        -ADMIN_KEY_SEQUENCE.length
      );
      if (keyBuffer === ADMIN_KEY_SEQUENCE) {
        setShowAdminUnlock(true);
        keyBuffer = "";
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <NavBar
        currentStep={navProps.currentStep}
        showProgress={navProps.showProgress}
        onHowItWorksClick={() => setShowHowItWorks(true)}
      />
      <Outlet context={{ openHowItWorks: () => setShowHowItWorks(true) }} />
      <HowItWorksModal open={showHowItWorks} onClose={() => setShowHowItWorks(false)} />
      {showAdminUnlock && (
        <AdminUnlockModal
          onClose={() => setShowAdminUnlock(false)}
          onUnlock={() => {
            setAdminModeEnabled(true);
            setShowAdminUnlock(false);
          }}
        />
      )}
      {adminModeEnabled && (
        <button
          onClick={() => setAdminModeEnabled(false)}
          className="fixed bottom-4 left-4 z-[70] cursor-pointer rounded-full border border-[#e8e2ce] bg-white/95 px-4 py-2 font-['Lexend',sans-serif] text-xs font-bold uppercase tracking-[0.12em] text-[#8f6a00] shadow-[0px_10px_30px_-18px_rgba(28,24,13,0.35)] backdrop-blur transition hover:bg-[#fff7df]"
        >
          Admin mode on
        </button>
      )}
    </>
  );
}
