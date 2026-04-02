import { useNavigate } from "react-router";
import gooseImg from "figma:asset/b92fc544a736117e881173174fe48bce3b51e1e8.png";

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div
      className="min-h-screen flex flex-col font-['Lexend',sans-serif]"
      style={{
        backgroundImage:
          "linear-gradient(90deg, rgb(248, 248, 245) 0%, rgb(248, 248, 245) 100%)",
      }}
    >
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
        {/* Big 404 */}
        <div className="relative mb-6">
          <span className="font-['Inter',sans-serif] font-black text-[120px] sm:text-[180px] leading-none tracking-[-6px] text-[#f0ece0] select-none">
            404
          </span>
          <div className="absolute inset-0 flex items-center justify-center">
            <img src={gooseImg} alt="Goose" className="w-[56px] h-[56px] sm:w-[72px] sm:h-[72px] object-cover opacity-60" />
          </div>
        </div>

        {/* Text */}
        <h1 className="font-['Inter',sans-serif] font-black text-[#1c180d] text-[28px] sm:text-[36px] tracking-[-0.9px] leading-[1.1] text-center mb-3">
          Page not found
        </h1>
        <p className="font-['Lexend',sans-serif] font-normal text-[#78716c] text-base text-center max-w-[400px] mb-8">
          This goose wandered off the path. Let's get you back to uploading your course outlines.
        </p>

        {/* Back to Home button */}
        <button
          onClick={() => navigate("/")}
          className="bg-[#f2b90d] rounded-xl px-8 py-3.5 flex items-center gap-2 shadow-[0px_0px_0px_3px_rgba(242,185,13,0.2)] hover:shadow-[0px_0px_0px_4px_rgba(242,185,13,0.3)] hover:brightness-[1.02] transition-all cursor-pointer"
        >
          <svg width="18" height="22" viewBox="0 0 18 22" fill="none">
            <path d="M5.86875 10.25L10.0688 6.05L9 5L3 11L9 17L10.0688 15.95L5.86875 11.75H15V10.25H5.86875Z" fill="#1C180D" />
          </svg>
          <span className="font-['Lexend',sans-serif] font-bold text-[#1c180d] text-base">
            Back to Home
          </span>
        </button>
      </main>
    </div>
  );
}