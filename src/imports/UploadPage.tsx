import svgPaths from "./svg-up87mvwjbr";
import img920081 from "figma:asset/b92fc544a736117e881173174fe48bce3b51e1e8.png";

function Container() {
  return <div className="h-[60px] shrink-0 w-[257px]" data-name="Container" />;
}

function Heading() {
  return (
    <div className="h-[67px] relative shrink-0 w-full" data-name="Heading 1">
      <div className="absolute bottom-[12.76px] flex h-[12px] items-center justify-center left-[297px] right-[117.98px]">
        <div className="flex-none h-[12px] skew-x-[0.13deg] w-[256.99px]">
          <div className="bg-[rgba(241,200,75,0.4)] rounded-[2px] size-full" data-name="Overlay" />
        </div>
      </div>
      <div className="-translate-x-1/2 -translate-y-1/2 absolute flex flex-col font-['Inter:Bold',sans-serif] font-bold h-[60px] justify-center leading-[0] left-[calc(50%+0.43px)] not-italic text-[#1b180d] text-[60px] text-center top-[24px] tracking-[-1.5px] w-[476.866px]">
        <p className="leading-[60px]">gooseCalendar</p>
      </div>
      <div className="absolute left-[69px] size-[41px] top-[10px]" data-name="92008 1">
        <img alt="" className="absolute inset-0 max-w-none object-cover pointer-events-none size-full" src={img920081} />
      </div>
    </div>
  );
}

function Container3() {
  return (
    <div className="content-stretch flex flex-col h-[49px] items-center max-w-[576px] relative shrink-0 w-[576px]" data-name="Container">
      <div className="flex flex-col font-['Inter:Medium',sans-serif] font-medium justify-center leading-[0] not-italic relative shrink-0 text-[#645f52] text-[20px] text-center whitespace-nowrap">
        <p className="mb-0">
          <span className="leading-[28px]">{`Upload your `}</span>
          <span className="decoration-solid font-['Inter:Bold',sans-serif] font-bold leading-[28px] not-italic underline">UWaterloo course outlines</span>
          <span className="leading-[28px]">{` and`}</span>
        </p>
        <p className="leading-[28px]">get an exportable calendar in seconds.</p>
      </div>
    </div>
  );
}

function Container2() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-center max-w-[672px] min-w-[672px] relative shrink-0" data-name="Container">
      <Heading />
      <Container3 />
    </div>
  );
}

function Margin() {
  return (
    <div className="content-stretch flex flex-col items-start max-w-[672px] pt-[32px] relative shrink-0" data-name="Margin">
      <Container2 />
    </div>
  );
}

function Icon() {
  return (
    <div className="h-[38px] relative w-[32px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 32 38">
        <g id="Icon">
          <path d={svgPaths.p13b85700} fill="var(--fill-0, #B38F1D)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container6() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon />
        </div>
      </div>
    </div>
  );
}

function Overlay() {
  return (
    <div className="bg-[rgba(241,200,75,0.2)] content-stretch flex items-center justify-center relative rounded-[9999px] shrink-0 size-[64px]" data-name="Overlay">
      <Container6 />
    </div>
  );
}

function Container7() {
  return (
    <div className="content-stretch flex flex-col items-center relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative shrink-0 text-[#1b180d] text-[16px] text-center whitespace-nowrap">
        <p className="leading-[24px]">Upload course outlines</p>
      </div>
    </div>
  );
}

function Icon1() {
  return (
    <div className="h-[24px] relative w-[20px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 20 24">
        <g id="Icon">
          <path d={svgPaths.p2bf480} fill="var(--fill-0, #1B180D)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container8() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon1 />
        </div>
      </div>
    </div>
  );
}

function Button() {
  return (
    <div className="bg-[#f1c84b] content-stretch flex gap-[8.01px] items-center justify-center min-w-[200px] overflow-clip px-[32px] py-[14px] relative rounded-[16px] shadow-[0px_10px_15px_-3px_rgba(0,0,0,0.1),0px_4px_6px_-4px_rgba(0,0,0,0.1)] shrink-0" data-name="Button">
      <Container7 />
      <Container8 />
    </div>
  );
}

function Container10() {
  return (
    <div className="content-stretch flex flex-col items-center relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-col font-['Inter:Medium',sans-serif] font-medium justify-center leading-[0] not-italic relative shrink-0 text-[#1b180d] text-[14px] text-center whitespace-nowrap">
        <p className="leading-[20px]">or drag and drop files here</p>
      </div>
    </div>
  );
}

function Container11() {
  return (
    <div className="content-stretch flex flex-col items-center relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-col font-['Inter:Regular',sans-serif] font-normal justify-center leading-[0] not-italic relative shrink-0 text-[#645f52] text-[12px] text-center whitespace-nowrap">
        <p className="leading-[16px]">HTML Files Only · Multiple files supported</p>
      </div>
    </div>
  );
}

function Container9() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-start relative shrink-0 w-[236px]" data-name="Container">
      <Container10 />
      <Container11 />
    </div>
  );
}

function Container5() {
  return (
    <div className="relative shrink-0 w-[508px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col gap-[24px] items-center relative w-full">
        <Overlay />
        <Button />
        <Container9 />
      </div>
    </div>
  );
}

function BackgroundBorder() {
  return (
    <div className="bg-white relative rounded-[24px] shrink-0 w-full" data-name="Background+Border">
      <div aria-hidden="true" className="absolute border-2 border-[#d1d5db] border-dashed inset-0 pointer-events-none rounded-[24px]" />
      <div className="content-stretch flex flex-col items-start p-[34px] relative w-full">
        <Container5 />
      </div>
    </div>
  );
}

function Icon2() {
  return (
    <div className="h-[20px] relative w-[16px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 16 20">
        <g id="Icon">
          <path d={svgPaths.p3c2b3940} fill="var(--fill-0, #645F52)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container13() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon2 />
        </div>
      </div>
    </div>
  );
}

function Container14() {
  return (
    <div className="content-stretch flex flex-col items-center relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Inter:Regular',sans-serif] font-normal justify-center leading-[0] not-italic relative shrink-0 text-[#645f52] text-[14px] text-center whitespace-nowrap">
        <p className="leading-[20px]">Watch a video to see how it works</p>
      </div>
    </div>
  );
}

function Container12() {
  return (
    <div className="content-stretch flex gap-[8px] items-center justify-center relative shrink-0 w-full" data-name="Container">
      <Container13 />
      <Container14 />
    </div>
  );
}

function Container4() {
  return (
    <div className="content-stretch flex flex-col gap-[16px] items-start max-w-[576px] relative shrink-0 w-full" data-name="Container">
      <BackgroundBorder />
      <Container12 />
    </div>
  );
}

function Margin1() {
  return (
    <div className="content-stretch flex flex-col items-start max-w-[576px] pt-[32px] relative shrink-0 w-[576px]" data-name="Margin">
      <Container4 />
    </div>
  );
}

function Background() {
  return (
    <div className="bg-[#f3f4f6] content-stretch flex items-center justify-center relative rounded-[9999px] shrink-0 size-[40px]" data-name="Background">
      <div className="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] not-italic relative shrink-0 text-[#1b180d] text-[16px] text-center whitespace-nowrap">
        <p className="leading-[24px]">1</p>
      </div>
    </div>
  );
}

function Heading1() {
  return (
    <div className="content-stretch flex flex-col items-center relative shrink-0 w-full" data-name="Heading 3">
      <div className="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative shrink-0 text-[#1b180d] text-[16px] text-center whitespace-nowrap">
        <p className="leading-[24px]">Upload Course Outlines</p>
      </div>
    </div>
  );
}

function Container17() {
  return (
    <div className="content-stretch flex flex-col items-center relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-col font-['Inter:Regular',sans-serif] font-normal justify-center leading-[0] not-italic relative shrink-0 text-[#645f52] text-[14px] text-center whitespace-nowrap">
        <p className="leading-[20px]">Upload UWaterloo Course Outlines</p>
      </div>
    </div>
  );
}

function Container16() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-[230px]" data-name="Container">
      <Heading1 />
      <Container17 />
    </div>
  );
}

function Container15() {
  return (
    <div className="relative shrink-0 w-[234.66px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col gap-[12px] items-center relative w-full">
        <Background />
        <Container16 />
      </div>
    </div>
  );
}

function Background1() {
  return (
    <div className="bg-[#f3f4f6] content-stretch flex items-center justify-center relative rounded-[9999px] shrink-0 size-[40px]" data-name="Background">
      <div className="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] not-italic relative shrink-0 text-[#1b180d] text-[16px] text-center whitespace-nowrap">
        <p className="leading-[24px]">2</p>
      </div>
    </div>
  );
}

function Heading2() {
  return (
    <div className="content-stretch flex flex-col items-center relative shrink-0 w-full" data-name="Heading 3">
      <div className="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative shrink-0 text-[#1b180d] text-[16px] text-center whitespace-nowrap">
        <p className="leading-[24px]">Review Dates</p>
      </div>
    </div>
  );
}

function Container20() {
  return (
    <div className="content-stretch flex flex-col items-center relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-col font-['Inter:Regular',sans-serif] font-normal justify-center leading-[0] not-italic relative shrink-0 text-[#645f52] text-[14px] text-center whitespace-nowrap">
        <p className="leading-[20px]">Verify extracted deadlines</p>
      </div>
    </div>
  );
}

function Container19() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-[174px]" data-name="Container">
      <Heading2 />
      <Container20 />
    </div>
  );
}

function Container18() {
  return (
    <div className="relative shrink-0 w-[234.67px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col gap-[12px] items-center relative w-full">
        <Background1 />
        <Container19 />
      </div>
    </div>
  );
}

function Overlay1() {
  return (
    <div className="bg-[rgba(241,200,75,0.2)] content-stretch flex items-center justify-center relative rounded-[9999px] shrink-0 size-[40px]" data-name="Overlay">
      <div className="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] not-italic relative shrink-0 text-[#1b180d] text-[16px] text-center whitespace-nowrap">
        <p className="leading-[24px]">3</p>
      </div>
    </div>
  );
}

function Heading3() {
  return (
    <div className="content-stretch flex flex-col items-center relative shrink-0 w-full" data-name="Heading 3">
      <div className="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative shrink-0 text-[#1b180d] text-[16px] text-center whitespace-nowrap">
        <p className="leading-[24px]">Export Calendar</p>
      </div>
    </div>
  );
}

function Container23() {
  return (
    <div className="content-stretch flex flex-col items-center relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-col font-['Inter:Regular',sans-serif] font-normal justify-center leading-[0] not-italic relative shrink-0 text-[#645f52] text-[14px] text-center whitespace-nowrap">
        <p className="leading-[20px]">Sync directly to GCal or .ics</p>
      </div>
    </div>
  );
}

function Container22() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-[183px]" data-name="Container">
      <Heading3 />
      <Container23 />
    </div>
  );
}

function Container21() {
  return (
    <div className="relative shrink-0 w-[234.67px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col gap-[12px] items-center relative w-full">
        <Overlay1 />
        <Container22 />
      </div>
    </div>
  );
}

function HorizontalBorder() {
  return (
    <div className="content-stretch flex gap-[32px] items-start justify-center max-w-[768px] pt-[49px] relative shrink-0 w-full" data-name="HorizontalBorder">
      <div aria-hidden="true" className="absolute border-[#f3f4f6] border-solid border-t inset-0 pointer-events-none" />
      <Container15 />
      <Container18 />
      <Container21 />
    </div>
  );
}

function Margin2() {
  return (
    <div className="content-stretch flex flex-col items-start max-w-[768px] pt-[32px] relative shrink-0 w-[768px]" data-name="Margin">
      <HorizontalBorder />
    </div>
  );
}

function Container1() {
  return (
    <div className="content-stretch flex flex-col items-center max-w-[896px] relative shrink-0 w-[896px]" data-name="Container">
      <Margin />
      <Margin1 />
      <Margin2 />
    </div>
  );
}

function Main() {
  return (
    <div className="absolute content-stretch flex flex-col items-center left-0 pb-[96px] pt-[48px] px-[24px] right-0 top-[65px]" data-name="Main">
      <Container />
      <Container1 />
    </div>
  );
}

function Container25() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Inter:Regular',sans-serif] font-normal justify-center leading-[0] not-italic relative shrink-0 text-[#645f52] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">© 2024 Outline → Calendar. Inspired by academic excellence.</p>
      </div>
    </div>
  );
}

function Link() {
  return (
    <div className="content-stretch flex flex-col items-start relative self-stretch shrink-0" data-name="Link">
      <div className="flex flex-col font-['Inter:Regular',sans-serif] font-normal justify-center leading-[0] not-italic relative shrink-0 text-[#645f52] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Privacy</p>
      </div>
    </div>
  );
}

function Link1() {
  return (
    <div className="content-stretch flex flex-col items-start relative self-stretch shrink-0" data-name="Link">
      <div className="flex flex-col font-['Inter:Regular',sans-serif] font-normal justify-center leading-[0] not-italic relative shrink-0 text-[#645f52] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Terms</p>
      </div>
    </div>
  );
}

function Link2() {
  return (
    <div className="content-stretch flex flex-col items-start relative self-stretch shrink-0" data-name="Link">
      <div className="flex flex-col font-['Inter:Regular',sans-serif] font-normal justify-center leading-[0] not-italic relative shrink-0 text-[#645f52] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Contact</p>
      </div>
    </div>
  );
}

function Container26() {
  return (
    <div className="content-stretch flex gap-[24px] h-[20px] items-start relative shrink-0" data-name="Container">
      <Link />
      <Link1 />
      <Link2 />
    </div>
  );
}

function Container24() {
  return (
    <div className="max-w-[1280px] relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-row items-center max-w-[inherit] size-full">
        <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-center justify-between max-w-[inherit] px-[16px] relative w-full">
          <Container25 />
          <Container26 />
        </div>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div className="absolute bg-white content-stretch flex flex-col items-start left-0 pb-[32px] pt-[33px] px-[80px] right-0 top-[1598px]" data-name="Footer">
      <div aria-hidden="true" className="absolute border-[#e5e7eb] border-solid border-t inset-0 pointer-events-none" />
      <Container24 />
    </div>
  );
}

function Icon3() {
  return (
    <div className="h-[24px] relative w-[20px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 20 24">
        <g id="Icon">
          <path d={svgPaths.p3d056f00} fill="var(--fill-0, #1B180D)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container29() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon3 />
        </div>
      </div>
    </div>
  );
}

function Background2() {
  return (
    <div className="bg-[#f1c84b] content-stretch flex items-center justify-center relative rounded-[16px] shrink-0 size-[32px]" data-name="Background">
      <Container29 />
    </div>
  );
}

function Container30() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative shrink-0 text-[#1b180d] text-[18px] tracking-[-0.45px] whitespace-nowrap">
        <p className="leading-[28px]">gooseCalendar</p>
      </div>
    </div>
  );
}

function Container28() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0" data-name="Container">
      <Background2 />
      <Container30 />
    </div>
  );
}

function NavLink() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Nav → Link">
      <div className="flex flex-col font-['Inter:Medium',sans-serif] font-medium justify-center leading-[0] not-italic relative shrink-0 text-[#1b180d] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">How It Works</p>
      </div>
    </div>
  );
}

function Container27() {
  return (
    <div className="h-[64px] relative shrink-0 w-full" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-center justify-between relative size-full">
        <Container28 />
        <NavLink />
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="backdrop-blur-[6px] bg-[rgba(248,248,246,0.8)] content-stretch flex flex-col items-start pb-px pointer-events-auto px-[112px] sticky top-0" data-name="Header">
      <div aria-hidden="true" className="absolute border-[#e5e7eb] border-b border-solid inset-0 pointer-events-none" />
      <Container27 />
    </div>
  );
}

function Frame() {
  return (
    <div className="absolute h-[1683px] left-0 right-0 top-0" data-name="Frame" style={{ backgroundImage: "linear-gradient(90deg, rgb(248, 248, 246) 0%, rgb(248, 248, 246) 100%), linear-gradient(90deg, rgb(255, 255, 255) 0%, rgb(255, 255, 255) 100%)" }}>
      <Main />
      <Footer />
      <div className="absolute h-[1683px] inset-0 pointer-events-none">
        <Header />
      </div>
    </div>
  );
}

export default function UploadPage() {
  return (
    <div className="bg-white overflow-clip relative rounded-[32px] size-full" data-name="Upload Page">
      <Frame />
    </div>
  );
}