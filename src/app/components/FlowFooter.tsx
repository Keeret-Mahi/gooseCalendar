import React from "react";
import type { ReactNode } from "react";

function BackIcon() {
  return (
    <svg width="18" height="22" viewBox="0 0 18 22" fill="none">
      <path
        d="M5.86875 10.25L10.0688 6.05L9 5L3 11L9 17L10.0688 15.95L5.86875 11.75H15V10.25H5.86875Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ForwardIcon() {
  return (
    <svg width="18" height="22" viewBox="0 0 24.02 28" fill="none" className="-scale-y-100">
      <path
        d="M12.01 3.5L10.24 5.27L17.45 12.5H3.01V15.5H17.45L10.24 22.73L12.01 24.5L23.01 13.5L12.01 3.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

interface FlowFooterProps {
  backLabel: string;
  helperText?: string;
  onBack: () => void;
  onAction?: () => void;
  actionLabel?: string;
  actionDisabled?: boolean;
  actionIcon?: ReactNode;
  maxWidthClassName?: string;
  topContent?: ReactNode;
}

export function FlowFooter({
  backLabel,
  helperText,
  onBack,
  onAction,
  actionLabel,
  actionDisabled = false,
  actionIcon,
  maxWidthClassName = "max-w-[960px]",
  topContent,
}: FlowFooterProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-[#e8e2ce] bg-white">
      {topContent && (
        <div className={`mx-auto ${maxWidthClassName} px-4 pt-3 sm:px-6`}>
          {topContent}
        </div>
      )}

      <div
        className={`mx-auto grid min-h-[80px] ${maxWidthClassName} grid-cols-[auto_1fr_auto] items-center gap-4 px-4 py-4 sm:px-6`}
      >
        <button
          onClick={onBack}
          className="flex cursor-pointer items-center gap-2 text-[#6b7280] transition-opacity hover:opacity-80"
        >
          <BackIcon />
          <span className="font-['Lexend',sans-serif] text-base font-medium">
            {backLabel}
          </span>
        </button>

        <div className="hidden px-4 text-center sm:block">
          {helperText ? (
            <span className="font-['Lexend',sans-serif] text-sm font-normal italic text-[#9c8749]">
              {helperText}
            </span>
          ) : null}
        </div>

        {actionLabel && onAction ? (
          <button
            onClick={onAction}
            disabled={actionDisabled}
            className={`flex items-center gap-2 rounded-xl px-6 py-3 transition-all ${
              actionDisabled
                ? "cursor-not-allowed bg-[#ede9dd] text-[#a8a29e]"
                : "cursor-pointer bg-[#f2b90d] text-[#1c180d] shadow-[0px_0px_0px_3px_rgba(242,185,13,0.2)] hover:brightness-[1.02] hover:shadow-[0px_0px_0px_4px_rgba(242,185,13,0.3)]"
            }`}
          >
            <span className="font-['Lexend',sans-serif] text-base font-bold whitespace-nowrap">
              {actionLabel}
            </span>
            <div className={actionDisabled ? "text-[#a8a29e]" : "text-[#1c180d]"}>
              {actionIcon ?? <ForwardIcon />}
            </div>
          </button>
        ) : (
          <div className="hidden min-w-[180px] sm:block" />
        )}
      </div>
    </div>
  );
}
