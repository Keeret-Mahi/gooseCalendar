import svgPaths from "./svg-de43c060dr";
import imgImageBorder from "figma:asset/b710050e4db0ea00f74b219f1c90b2c06f654d80.png";

function Icon() {
  return (
    <div className="h-[28px] relative w-[24.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 24.02 28">
        <g id="Icon">
          <path d={svgPaths.p211e1480} fill="var(--fill-0, #1E1E1E)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container3() {
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

function Background() {
  return (
    <div className="bg-[#f2b90d] content-stretch flex items-center justify-center relative rounded-[8px] shrink-0 size-[32px]" data-name="Background">
      <Container3 />
    </div>
  );
}

function Heading1() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Heading 2">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#0f172a] text-[18px] tracking-[-0.27px] whitespace-nowrap">
        <p className="leading-[22.5px]">Outline</p>
      </div>
    </div>
  );
}

function Container2() {
  return (
    <div className="relative shrink-0" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex gap-[16px] items-center relative">
        <Background />
        <Heading1 />
      </div>
    </div>
  );
}

function Link() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Link">
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#334155] text-[14px] whitespace-nowrap">
        <p className="leading-[21px]">Calendar</p>
      </div>
    </div>
  );
}

function Link1() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Link">
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#334155] text-[14px] whitespace-nowrap">
        <p className="leading-[21px]">Courses</p>
      </div>
    </div>
  );
}

function Link2() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Link">
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#334155] text-[14px] whitespace-nowrap">
        <p className="leading-[21px]">Settings</p>
      </div>
    </div>
  );
}

function Container5() {
  return (
    <div className="content-stretch flex gap-[36px] items-center relative self-stretch shrink-0" data-name="Container">
      <Link />
      <Link1 />
      <Link2 />
    </div>
  );
}

function Icon1() {
  return (
    <div className="h-[28px] relative w-[24.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 24.02 28">
        <g id="Icon">
          <path d={svgPaths.p3420e600} fill="var(--fill-0, #334155)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container7() {
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
    <div className="bg-[#f1f5f9] content-stretch flex items-center justify-center relative rounded-[8px] shrink-0 size-[40px]" data-name="Button">
      <Container7 />
    </div>
  );
}

function Icon2() {
  return (
    <div className="h-[28px] relative w-[24.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 24.02 28">
        <g id="Icon">
          <path d={svgPaths.p21feae20} fill="var(--fill-0, #334155)" id="Vector" />
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
          <Icon2 />
        </div>
      </div>
    </div>
  );
}

function Button1() {
  return (
    <div className="bg-[#f1f5f9] content-stretch flex items-center justify-center relative rounded-[8px] shrink-0 size-[40px]" data-name="Button">
      <Container8 />
    </div>
  );
}

function Container6() {
  return (
    <div className="content-stretch flex gap-[8px] items-start relative self-stretch shrink-0" data-name="Container">
      <Button />
      <Button1 />
    </div>
  );
}

function Container4() {
  return (
    <div className="flex-[1_0_0] min-h-px min-w-px relative" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex gap-[32px] items-start justify-end relative w-full">
        <Container5 />
        <Container6 />
        <div className="pointer-events-none relative rounded-[9999px] shrink-0 size-[40px]" data-name="Image+Border">
          <div className="absolute inset-0 overflow-hidden rounded-[9999px]">
            <img alt="" className="absolute left-[5%] max-w-none size-[90%] top-[5%]" src={imgImageBorder} />
          </div>
          <div aria-hidden="true" className="absolute border-2 border-[#f2b90d] border-solid inset-0 rounded-[9999px]" />
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="bg-white relative shrink-0 w-full" data-name="Header">
      <div aria-hidden="true" className="absolute border-[#e2e8f0] border-b border-solid inset-0 pointer-events-none" />
      <div className="flex flex-row items-center size-full">
        <div className="content-stretch flex items-center justify-between pb-[13px] pt-[12px] px-[40px] relative w-full">
          <Container2 />
          <Container4 />
        </div>
      </div>
    </div>
  );
}

function Link3() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Link">
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#64748b] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Outline</p>
      </div>
    </div>
  );
}

function Icon3() {
  return (
    <div className="h-[16px] relative w-[14.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14.02 16">
        <g id="Icon">
          <path d={svgPaths.p28a24e80} fill="var(--fill-0, #94A3B8)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container12() {
  return (
    <div className="content-stretch flex items-start py-[2px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon3 />
        </div>
      </div>
    </div>
  );
}

function Container11() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <Container12 />
    </div>
  );
}

function Link4() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Link">
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#64748b] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Calendar</p>
      </div>
    </div>
  );
}

function Icon4() {
  return (
    <div className="h-[15.989px] relative w-[14.01px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14.01 15.9886">
        <g id="Icon">
          <path d={svgPaths.p19834400} fill="var(--fill-0, #94A3B8)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container14() {
  return (
    <div className="content-stretch flex items-start py-[2px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon4 />
        </div>
      </div>
    </div>
  );
}

function Container13() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <Container14 />
    </div>
  );
}

function Container15() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Lexend:SemiBold',sans-serif] font-semibold justify-center leading-[0] relative shrink-0 text-[#0f172a] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Review Classes</p>
      </div>
    </div>
  );
}

function Container10() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0 w-full" data-name="Container">
      <Link3 />
      <Container11 />
      <Link4 />
      <Container13 />
      <Container15 />
    </div>
  );
}

function Margin() {
  return (
    <div className="content-stretch flex flex-col items-start pb-[32px] relative shrink-0 w-full" data-name="Margin">
      <Container10 />
    </div>
  );
}

function Icon5() {
  return (
    <div className="h-[16px] relative w-[14.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14.02 16">
        <g id="Icon">
          <path d={svgPaths.p2727a000} fill="var(--fill-0, white)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container19() {
  return (
    <div className="content-stretch flex flex-col items-start py-[2px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon5 />
        </div>
      </div>
    </div>
  );
}

function Background1() {
  return (
    <div className="bg-[#10b981] content-stretch flex items-center justify-center p-[4px] relative rounded-[9999px] shrink-0" data-name="Background">
      <Container19 />
    </div>
  );
}

function Container18() {
  return (
    <div className="content-stretch flex flex-col items-center relative shrink-0" data-name="Container">
      <Background1 />
    </div>
  );
}

function Container21() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#94a3b8] text-[12px] tracking-[0.6px] uppercase whitespace-nowrap">
        <p className="leading-[16px]">Step 1</p>
      </div>
    </div>
  );
}

function Container22() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-col font-['Lexend:SemiBold',sans-serif] font-semibold justify-center leading-[0] relative shrink-0 text-[#0f172a] text-[16px] whitespace-nowrap">
        <p className="leading-[24px]">Upload</p>
      </div>
    </div>
  );
}

function Container20() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-[58px]" data-name="Container">
      <Container21 />
      <Container22 />
    </div>
  );
}

function Container17() {
  return (
    <div className="content-stretch flex gap-[16px] items-center relative shrink-0 w-[169.2px]" data-name="Container">
      <Container18 />
      <Container20 />
    </div>
  );
}

function Margin2() {
  return (
    <div className="content-stretch flex flex-col h-px items-start px-[16px] relative shrink-0 w-[201.2px]" data-name="Margin">
      <div className="bg-[#e2e8f0] h-px shrink-0 w-full" data-name="Horizontal Divider" />
    </div>
  );
}

function Icon6() {
  return (
    <div className="h-[15.989px] relative w-[14.01px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14.01 15.9886">
        <g id="Icon">
          <path d={svgPaths.p2afe2ff0} fill="var(--fill-0, white)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container25() {
  return (
    <div className="content-stretch flex flex-col items-start py-[2px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon6 />
        </div>
      </div>
    </div>
  );
}

function Background2() {
  return (
    <div className="bg-[#10b981] content-stretch flex items-center justify-center p-[4px] relative rounded-[9999px] shrink-0" data-name="Background">
      <Container25 />
    </div>
  );
}

function Container24() {
  return (
    <div className="content-stretch flex flex-col items-center relative shrink-0" data-name="Container">
      <Background2 />
    </div>
  );
}

function Container27() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#94a3b8] text-[12px] tracking-[0.6px] uppercase whitespace-nowrap">
        <p className="leading-[16px]">Step 2</p>
      </div>
    </div>
  );
}

function Container28() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-col font-['Lexend:SemiBold',sans-serif] font-semibold justify-center leading-[0] relative shrink-0 text-[#0f172a] text-[16px] whitespace-nowrap">
        <p className="leading-[24px]">Select Sections</p>
      </div>
    </div>
  );
}

function Container26() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-[121px]" data-name="Container">
      <Container27 />
      <Container28 />
    </div>
  );
}

function Container23() {
  return (
    <div className="content-stretch flex gap-[15.99px] items-center relative shrink-0 w-[169.2px]" data-name="Container">
      <Container24 />
      <Container26 />
    </div>
  );
}

function Margin3() {
  return (
    <div className="content-stretch flex flex-col h-px items-start px-[16px] relative shrink-0 w-[201.2px]" data-name="Margin">
      <div className="bg-[#e2e8f0] h-px shrink-0 w-full" data-name="Horizontal Divider" />
    </div>
  );
}

function Icon7() {
  return (
    <div className="h-[16px] relative w-[14.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14.02 16">
        <g id="Icon">
          <path d={svgPaths.pf9d9800} fill="var(--fill-0, #1E1E1E)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container31() {
  return (
    <div className="content-stretch flex flex-col items-start py-[2px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon7 />
        </div>
      </div>
    </div>
  );
}

function Background3() {
  return (
    <div className="bg-[#f2b90d] content-stretch flex items-center justify-center p-[4px] relative rounded-[9999px] shrink-0" data-name="Background">
      <div className="absolute bg-[rgba(255,255,255,0)] inset-0 rounded-[9999px] shadow-[0px_0px_0px_4px_rgba(242,185,13,0.2)]" data-name="Overlay+Shadow" />
      <Container31 />
    </div>
  );
}

function Container30() {
  return (
    <div className="content-stretch flex flex-col items-center relative shrink-0" data-name="Container">
      <Background3 />
    </div>
  );
}

function Container33() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#f2b90d] text-[12px] tracking-[0.6px] uppercase whitespace-nowrap">
        <p className="leading-[16px]">Active Step</p>
      </div>
    </div>
  );
}

function Container34() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#0f172a] text-[16px] whitespace-nowrap">
        <p className="leading-[24px]">Review Classes</p>
      </div>
    </div>
  );
}

function Container32() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-[123px]" data-name="Container">
      <Container33 />
      <Container34 />
    </div>
  );
}

function Container29() {
  return (
    <div className="content-stretch flex gap-[16px] items-center relative shrink-0 w-[169.2px]" data-name="Container">
      <Container30 />
      <Container32 />
    </div>
  );
}

function Container16() {
  return (
    <div className="relative shrink-0 w-full" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-center justify-between relative w-full">
        <Container17 />
        <Margin2 />
        <Container23 />
        <Margin3 />
        <Container29 />
      </div>
    </div>
  );
}

function BackgroundBorderShadow() {
  return (
    <div className="bg-white relative rounded-[12px] shrink-0 w-full" data-name="Background+Border+Shadow">
      <div aria-hidden="true" className="absolute border border-[#e2e8f0] border-solid inset-0 pointer-events-none rounded-[12px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]" />
      <div className="content-stretch flex flex-col items-start p-[25px] relative w-full">
        <Container16 />
      </div>
    </div>
  );
}

function Margin1() {
  return (
    <div className="content-stretch flex flex-col items-start pb-[32px] relative shrink-0 w-full" data-name="Margin">
      <BackgroundBorderShadow />
    </div>
  );
}

function Heading() {
  return (
    <div className="relative shrink-0 w-full" data-name="Heading 1">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col items-start relative w-full">
        <div className="flex flex-col font-['Lexend:Black',sans-serif] font-black justify-center leading-[0] relative shrink-0 text-[#0f172a] text-[30px] tracking-[-0.75px] w-full">
          <p className="leading-[37.5px]">Review Classes Overview</p>
        </div>
      </div>
    </div>
  );
}

function Container35() {
  return (
    <div className="relative shrink-0 w-full" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col items-start relative w-full">
        <div className="flex flex-col font-['Lexend:Regular',sans-serif] font-normal justify-center leading-[0] relative shrink-0 text-[#64748b] text-[18px] w-full">
          <p className="leading-[28px]">Confirm the detected lecture, tutorial, and lab times before exporting.</p>
        </div>
      </div>
    </div>
  );
}

function HorizontalBorder() {
  return (
    <div className="relative shrink-0 w-full" data-name="HorizontalBorder">
      <div aria-hidden="true" className="absolute border-[#f1f5f9] border-b border-solid inset-0 pointer-events-none" />
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col gap-[8px] items-start pb-[33px] pt-[31px] px-[32px] relative w-full">
        <Heading />
        <Container35 />
      </div>
    </div>
  );
}

function Heading2() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Heading 3">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#0f172a] text-[20px] whitespace-nowrap">
        <p className="leading-[28px]">BIOL110 - Introductory Biology</p>
      </div>
    </div>
  );
}

function Container40() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-col font-['Lexend:Regular',sans-serif] font-normal justify-center leading-[0] relative shrink-0 text-[#64748b] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">3 events detected (Lecture, Lab)</p>
      </div>
    </div>
  );
}

function Container39() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-start relative shrink-0 w-[328px]" data-name="Container">
      <Heading2 />
      <Container40 />
    </div>
  );
}

function Container38() {
  return (
    <div className="content-stretch flex gap-[16px] items-center relative shrink-0" data-name="Container">
      <div className="bg-[#8fb394] rounded-[9999px] shrink-0 size-[16px]" data-name="Background" />
      <Container39 />
    </div>
  );
}

function Icon8() {
  return (
    <div className="h-[16px] relative w-[14.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14.02 16">
        <g id="Icon">
          <path d={svgPaths.p13573380} fill="var(--fill-0, #10B981)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container43() {
  return (
    <div className="content-stretch flex flex-col items-start py-[2px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon8 />
        </div>
      </div>
    </div>
  );
}

function Container44() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#059669] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Ready to Export</p>
      </div>
    </div>
  );
}

function Container42() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0" data-name="Container">
      <Container43 />
      <Container44 />
    </div>
  );
}

function Background4() {
  return (
    <div className="bg-[#f1f5f9] content-stretch flex flex-col h-[8px] items-start justify-center overflow-clip relative rounded-[9999px] shrink-0 w-[128px]" data-name="Background">
      <div className="bg-[#10b981] flex-[1_0_0] min-h-px min-w-px rounded-[9999px] w-full" data-name="Background" />
    </div>
  );
}

function Icon9() {
  return (
    <div className="h-[28px] relative w-[24.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 24.02 28">
        <g id="Icon">
          <path d={svgPaths.p3ab1f380} fill="var(--fill-0, #94A3B8)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container45() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon9 />
        </div>
      </div>
    </div>
  );
}

function Container41() {
  return (
    <div className="content-stretch flex gap-[24px] items-center relative shrink-0" data-name="Container">
      <Container42 />
      <Background4 />
      <Container45 />
    </div>
  );
}

function Container37() {
  return (
    <div className="relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-row items-center size-full">
        <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-center justify-between p-[24px] relative w-full">
          <Container38 />
          <Container41 />
        </div>
      </div>
    </div>
  );
}

function BackgroundBorder() {
  return (
    <div className="bg-white relative rounded-[8px] shrink-0 w-full" data-name="Background+Border">
      <div className="content-stretch flex flex-col items-start overflow-clip p-px relative rounded-[inherit] w-full">
        <Container37 />
      </div>
      <div aria-hidden="true" className="absolute border border-[#e2e8f0] border-solid inset-0 pointer-events-none rounded-[8px]" />
    </div>
  );
}

function Heading3() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Heading 3">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#0f172a] text-[20px] whitespace-nowrap">
        <p className="leading-[28px]">CS135 - Elementary Algorithm Design</p>
      </div>
    </div>
  );
}

function Container49() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-col font-['Lexend:Regular',sans-serif] font-normal justify-center leading-[0] relative shrink-0 text-[#64748b] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">4 events detected (Lecture, Tutorial)</p>
      </div>
    </div>
  );
}

function Container48() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-start relative shrink-0 w-[384px]" data-name="Container">
      <Heading3 />
      <Container49 />
    </div>
  );
}

function Container47() {
  return (
    <div className="content-stretch flex gap-[16px] items-center relative shrink-0" data-name="Container">
      <div className="bg-[#f2b90d] rounded-[9999px] shrink-0 size-[16px]" data-name="Background" />
      <Container48 />
    </div>
  );
}

function Icon10() {
  return (
    <div className="h-[16px] relative w-[14.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14.02 16">
        <g id="Icon">
          <path d={svgPaths.p13573380} fill="var(--fill-0, #10B981)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container52() {
  return (
    <div className="content-stretch flex flex-col items-start py-[2px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon10 />
        </div>
      </div>
    </div>
  );
}

function Container53() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#059669] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Ready to Export</p>
      </div>
    </div>
  );
}

function Container51() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0" data-name="Container">
      <Container52 />
      <Container53 />
    </div>
  );
}

function Background5() {
  return (
    <div className="bg-[#f1f5f9] content-stretch flex flex-col h-[8px] items-start justify-center overflow-clip relative rounded-[9999px] shrink-0 w-[128px]" data-name="Background">
      <div className="bg-[#10b981] flex-[1_0_0] min-h-px min-w-px rounded-[9999px] w-full" data-name="Background" />
    </div>
  );
}

function Icon11() {
  return (
    <div className="h-[28px] relative w-[24.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 24.02 28">
        <g id="Icon">
          <path d={svgPaths.p3ab1f380} fill="var(--fill-0, #94A3B8)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container54() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon11 />
        </div>
      </div>
    </div>
  );
}

function Container50() {
  return (
    <div className="content-stretch flex gap-[24px] items-center relative shrink-0" data-name="Container">
      <Container51 />
      <Background5 />
      <Container54 />
    </div>
  );
}

function Container46() {
  return (
    <div className="relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-row items-center size-full">
        <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-center justify-between p-[24px] relative w-full">
          <Container47 />
          <Container50 />
        </div>
      </div>
    </div>
  );
}

function BackgroundBorder1() {
  return (
    <div className="bg-white relative rounded-[8px] shrink-0 w-full" data-name="Background+Border">
      <div className="content-stretch flex flex-col items-start overflow-clip p-px relative rounded-[inherit] w-full">
        <Container46 />
      </div>
      <div aria-hidden="true" className="absolute border border-[#e2e8f0] border-solid inset-0 pointer-events-none rounded-[8px]" />
    </div>
  );
}

function Heading4() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Heading 3">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#0f172a] text-[20px] whitespace-nowrap">
        <p className="leading-[28px]">PHYS121L - Mechanics Lab</p>
      </div>
    </div>
  );
}

function Container58() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-col font-['Lexend:Regular',sans-serif] font-normal justify-center leading-[0] relative shrink-0 text-[#64748b] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">1 event detected (Lab)</p>
      </div>
    </div>
  );
}

function Container57() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-start relative shrink-0 w-[273px]" data-name="Container">
      <Heading4 />
      <Container58 />
    </div>
  );
}

function Container56() {
  return (
    <div className="content-stretch flex gap-[16px] items-center relative shrink-0" data-name="Container">
      <div className="bg-[#60a5fa] rounded-[9999px] shrink-0 size-[16px]" data-name="Background" />
      <Container57 />
    </div>
  );
}

function Icon12() {
  return (
    <div className="h-[16px] relative w-[14.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14.02 16">
        <g id="Icon">
          <path d={svgPaths.p13573380} fill="var(--fill-0, #10B981)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container61() {
  return (
    <div className="content-stretch flex flex-col items-start py-[2px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon12 />
        </div>
      </div>
    </div>
  );
}

function Container62() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#059669] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Ready to Export</p>
      </div>
    </div>
  );
}

function Container60() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0" data-name="Container">
      <Container61 />
      <Container62 />
    </div>
  );
}

function Background6() {
  return (
    <div className="bg-[#f1f5f9] content-stretch flex flex-col h-[8px] items-start justify-center overflow-clip relative rounded-[9999px] shrink-0 w-[128px]" data-name="Background">
      <div className="bg-[#10b981] flex-[1_0_0] min-h-px min-w-px rounded-[9999px] w-full" data-name="Background" />
    </div>
  );
}

function Icon13() {
  return (
    <div className="h-[28px] relative w-[24.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 24.02 28">
        <g id="Icon">
          <path d={svgPaths.p3ab1f380} fill="var(--fill-0, #94A3B8)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container63() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon13 />
        </div>
      </div>
    </div>
  );
}

function Container59() {
  return (
    <div className="content-stretch flex gap-[24px] items-center relative shrink-0" data-name="Container">
      <Container60 />
      <Background6 />
      <Container63 />
    </div>
  );
}

function Container55() {
  return (
    <div className="relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-row items-center size-full">
        <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-center justify-between p-[24px] relative w-full">
          <Container56 />
          <Container59 />
        </div>
      </div>
    </div>
  );
}

function BackgroundBorder2() {
  return (
    <div className="bg-white relative rounded-[8px] shrink-0 w-full" data-name="Background+Border">
      <div className="content-stretch flex flex-col items-start overflow-clip p-px relative rounded-[inherit] w-full">
        <Container55 />
      </div>
      <div aria-hidden="true" className="absolute border border-[#e2e8f0] border-solid inset-0 pointer-events-none rounded-[8px]" />
    </div>
  );
}

function Heading5() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Heading 3">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#0f172a] text-[20px] whitespace-nowrap">
        <p className="leading-[28px]">MATH135 - Algebra for Honours Math</p>
      </div>
    </div>
  );
}

function Container66() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-col font-['Lexend:Regular',sans-serif] font-normal justify-center leading-[0] relative shrink-0 text-[#64748b] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">2 events detected (Lecture, Tutorial)</p>
      </div>
    </div>
  );
}

function Container65() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-start relative shrink-0 w-[382px]" data-name="Container">
      <Heading5 />
      <Container66 />
    </div>
  );
}

function Container64() {
  return (
    <div className="relative shrink-0" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex gap-[16px] items-center relative">
        <div className="bg-[#c084fc] rounded-[9999px] shrink-0 size-[16px]" data-name="Background" />
        <Container65 />
      </div>
    </div>
  );
}

function Icon14() {
  return (
    <div className="h-[16px] relative w-[14.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14.02 16">
        <g id="Icon">
          <path d={svgPaths.p13573380} fill="var(--fill-0, #10B981)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container69() {
  return (
    <div className="content-stretch flex flex-col items-start py-[2px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon14 />
        </div>
      </div>
    </div>
  );
}

function Container70() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#059669] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Ready to Export</p>
      </div>
    </div>
  );
}

function Container68() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0" data-name="Container">
      <Container69 />
      <Container70 />
    </div>
  );
}

function Background7() {
  return (
    <div className="bg-[#f1f5f9] content-stretch flex flex-col h-[8px] items-start justify-center overflow-clip relative rounded-[9999px] shrink-0 w-[128px]" data-name="Background">
      <div className="bg-[#10b981] flex-[1_0_0] min-h-px min-w-px rounded-[9999px] w-full" data-name="Background" />
    </div>
  );
}

function Icon15() {
  return (
    <div className="h-[28px] relative w-[24.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 24.02 28">
        <g id="Icon">
          <path d={svgPaths.p3d5db680} fill="var(--fill-0, #F2B90D)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container71() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon15 />
        </div>
      </div>
    </div>
  );
}

function Container67() {
  return (
    <div className="relative shrink-0" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex gap-[24px] items-center relative">
        <Container68 />
        <Background7 />
        <Container71 />
      </div>
    </div>
  );
}

function HorizontalBorder1() {
  return (
    <div className="relative shrink-0 w-full" data-name="HorizontalBorder">
      <div aria-hidden="true" className="absolute border-[#f1f5f9] border-b border-solid inset-0 pointer-events-none" />
      <div className="flex flex-row items-center size-full">
        <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-center justify-between pb-[25px] pt-[24px] px-[24px] relative w-full">
          <Container64 />
          <Container67 />
        </div>
      </div>
    </div>
  );
}

function Overlay1() {
  return (
    <div className="bg-[rgba(242,185,13,0.1)] content-stretch flex flex-col items-start px-[8px] py-[2px] relative rounded-[9999px] shrink-0" data-name="Overlay">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#f2b90d] text-[10px] uppercase whitespace-nowrap">
        <p className="leading-[15px]">Lecture</p>
      </div>
    </div>
  );
}

function Container73() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#0f172a] text-[16px] whitespace-nowrap">
        <p className="leading-[24px]">Section 001</p>
      </div>
    </div>
  );
}

function Icon16() {
  return (
    <div className="h-[15.989px] relative w-[14.01px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14.01 15.9886">
        <g id="Icon">
          <path d={svgPaths.p3df5a180} fill="var(--fill-0, #64748B)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container75() {
  return (
    <div className="content-stretch flex flex-col items-start py-[2px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon16 />
        </div>
      </div>
    </div>
  );
}

function Margin4() {
  return (
    <div className="content-stretch flex flex-col items-start mr-[-0.01px] pr-[4px] relative shrink-0" data-name="Margin">
      <Container75 />
    </div>
  );
}

function Container74() {
  return (
    <div className="content-stretch flex items-center pr-[0.01px] relative shrink-0" data-name="Container">
      <Margin4 />
      <div className="flex flex-col font-['Lexend:Regular','Noto_Sans_Symbols:Regular',sans-serif] font-normal justify-center leading-[0] mr-[-0.01px] relative shrink-0 text-[#64748b] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Mon, Wed, Fri, 9:30 a.m. → 10:20 a.m.</p>
      </div>
    </div>
  );
}

function Container72() {
  return (
    <div className="relative shrink-0" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex gap-[16px] items-center relative">
        <Overlay1 />
        <Container73 />
        <Container74 />
      </div>
    </div>
  );
}

function Button2() {
  return (
    <div className="relative shrink-0" data-name="Button">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-center justify-center relative">
        <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#94a3b8] text-[14px] text-center whitespace-nowrap">
          <p className="leading-[20px]">Exclude</p>
        </div>
      </div>
    </div>
  );
}

function BackgroundBorder3() {
  return (
    <div className="bg-white relative rounded-[4px] shrink-0 w-full" data-name="Background+Border">
      <div aria-hidden="true" className="absolute border border-[#e2e8f0] border-solid inset-0 pointer-events-none rounded-[4px]" />
      <div className="flex flex-row items-center size-full">
        <div className="content-stretch flex items-center justify-between p-[13px] relative w-full">
          <Container72 />
          <Button2 />
        </div>
      </div>
    </div>
  );
}

function Background8() {
  return (
    <div className="bg-[#f3e8ff] content-stretch flex flex-col items-start px-[8px] py-[2px] relative rounded-[9999px] shrink-0" data-name="Background">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#9333ea] text-[10px] uppercase whitespace-nowrap">
        <p className="leading-[15px]">Tutorial</p>
      </div>
    </div>
  );
}

function Container77() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#0f172a] text-[16px] whitespace-nowrap">
        <p className="leading-[24px]">Section 201</p>
      </div>
    </div>
  );
}

function Icon17() {
  return (
    <div className="h-[15.989px] relative w-[14.01px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14.01 15.9886">
        <g id="Icon">
          <path d={svgPaths.p3df5a180} fill="var(--fill-0, #64748B)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container79() {
  return (
    <div className="content-stretch flex flex-col items-start py-[2px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon17 />
        </div>
      </div>
    </div>
  );
}

function Margin5() {
  return (
    <div className="content-stretch flex flex-col items-start mr-[-0.01px] pr-[4px] relative shrink-0" data-name="Margin">
      <Container79 />
    </div>
  );
}

function Container78() {
  return (
    <div className="content-stretch flex items-center pr-[0.01px] relative shrink-0" data-name="Container">
      <Margin5 />
      <div className="flex flex-col font-['Lexend:Regular','Noto_Sans_Symbols:Regular',sans-serif] font-normal justify-center leading-[0] mr-[-0.01px] relative shrink-0 text-[#64748b] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Thu, Sep 15, 8:30 a.m. → 9:20 a.m.</p>
      </div>
    </div>
  );
}

function Container76() {
  return (
    <div className="relative shrink-0" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex gap-[16px] items-center relative">
        <Background8 />
        <Container77 />
        <Container78 />
      </div>
    </div>
  );
}

function Button3() {
  return (
    <div className="relative shrink-0" data-name="Button">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-center justify-center relative">
        <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#94a3b8] text-[14px] text-center whitespace-nowrap">
          <p className="leading-[20px]">Exclude</p>
        </div>
      </div>
    </div>
  );
}

function BackgroundBorder4() {
  return (
    <div className="bg-white relative rounded-[4px] shrink-0 w-full" data-name="Background+Border">
      <div aria-hidden="true" className="absolute border border-[#e2e8f0] border-solid inset-0 pointer-events-none rounded-[4px]" />
      <div className="flex flex-row items-center size-full">
        <div className="content-stretch flex items-center justify-between p-[13px] relative w-full">
          <Container76 />
          <Button3 />
        </div>
      </div>
    </div>
  );
}

function Overlay() {
  return (
    <div className="bg-[rgba(248,250,252,0.5)] relative shrink-0 w-full" data-name="Overlay">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col gap-[12px] items-start p-[24px] relative w-full">
        <BackgroundBorder3 />
        <BackgroundBorder4 />
      </div>
    </div>
  );
}

function BackgroundBorderShadow2() {
  return (
    <div className="bg-white relative rounded-[8px] shrink-0 w-full" data-name="Background+Border+Shadow">
      <div className="content-stretch flex flex-col items-start overflow-clip p-[2px] relative rounded-[inherit] w-full">
        <HorizontalBorder1 />
        <Overlay />
      </div>
      <div aria-hidden="true" className="absolute border-2 border-[#f2b90d] border-solid inset-0 pointer-events-none rounded-[8px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]" />
    </div>
  );
}

function Container36() {
  return (
    <div className="relative shrink-0 w-full" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col gap-[16px] items-start p-[16px] relative w-full">
        <BackgroundBorder />
        <BackgroundBorder1 />
        <BackgroundBorder2 />
        <BackgroundBorderShadow2 />
      </div>
    </div>
  );
}

function Icon18() {
  return (
    <div className="h-[28px] relative w-[24.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 24.02 28">
        <g id="Icon">
          <path d={svgPaths.p3449c830} fill="var(--fill-0, #475569)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container80() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon18 />
        </div>
      </div>
    </div>
  );
}

function Link5() {
  return (
    <div className="relative shrink-0" data-name="Link">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex gap-[8px] items-center relative">
        <Container80 />
        <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#475569] text-[16px] whitespace-nowrap">
          <p className="leading-[24px]">Back to Sections</p>
        </div>
      </div>
    </div>
  );
}

function Icon19() {
  return (
    <div className="h-[28px] relative w-[24.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 24.02 28">
        <g id="Icon">
          <path d={svgPaths.pf423700} fill="var(--fill-0, #1E1E1E)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container81() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon19 />
        </div>
      </div>
    </div>
  );
}

function Button4() {
  return (
    <div className="bg-[#f2b90d] relative rounded-[8px] shrink-0" data-name="Button">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex gap-[7.99px] items-center px-[32px] py-[10px] relative">
        <div className="absolute bg-[rgba(255,255,255,0)] inset-0 rounded-[8px] shadow-[0px_4px_6px_-1px_rgba(242,185,13,0.2),0px_2px_4px_-2px_rgba(242,185,13,0.2)]" data-name="Button:shadow" />
        <div className="flex flex-col font-['Lexend:Black',sans-serif] font-black justify-center leading-[0] relative shrink-0 text-[#1e1e1e] text-[16px] text-center whitespace-nowrap">
          <p className="leading-[24px]">Next: Export Calendar</p>
        </div>
        <Container81 />
      </div>
    </div>
  );
}

function BackgroundHorizontalBorder() {
  return (
    <div className="bg-[#f8fafc] relative shrink-0 w-full" data-name="Background+HorizontalBorder">
      <div aria-hidden="true" className="absolute border-[#e2e8f0] border-solid border-t inset-0 pointer-events-none" />
      <div className="flex flex-row items-center size-full">
        <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-center justify-between pb-[32px] pl-[32px] pr-[31.99px] pt-[33px] relative w-full">
          <Link5 />
          <Button4 />
        </div>
      </div>
    </div>
  );
}

function BackgroundBorderShadow1() {
  return (
    <div className="bg-white relative rounded-[12px] shrink-0 w-full" data-name="Background+Border+Shadow">
      <div className="content-stretch flex flex-col items-start overflow-clip p-px relative rounded-[inherit] w-full">
        <HorizontalBorder />
        <Container36 />
        <BackgroundHorizontalBorder />
      </div>
      <div aria-hidden="true" className="absolute border border-[#e2e8f0] border-solid inset-0 pointer-events-none rounded-[12px] shadow-[0px_10px_15px_-3px_rgba(0,0,0,0.1),0px_4px_6px_-4px_rgba(0,0,0,0.1)]" />
    </div>
  );
}

function Icon20() {
  return (
    <div className="h-[28px] relative w-[24.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 24.02 28">
        <g id="Icon">
          <path d={svgPaths.p161ceef0} fill="var(--fill-0, #F2B90D)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container82() {
  return (
    <div className="h-full relative shrink-0" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col h-full items-start relative">
        <div className="flex items-center justify-center relative shrink-0">
          <div className="-scale-y-100 flex-none">
            <Icon20 />
          </div>
        </div>
      </div>
    </div>
  );
}

function Container83() {
  return (
    <div className="h-[46.125px] relative shrink-0" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col h-full items-start pr-[3.09px] relative">
        <div className="flex flex-col font-['Lexend:Regular',sans-serif] font-normal justify-center leading-[0] relative shrink-0 text-[#475569] text-[14px] whitespace-nowrap">
          <p className="mb-0">
            <span className="leading-[22.75px]">{`Assignments and exams are excluded by default in this view. To include them, please toggle the `}</span>
            <span className="font-['Lexend:Bold',sans-serif] font-bold leading-[22.75px]">Academic Deadlines</span>
            <span className="leading-[22.75px]">{` setting in the`}</span>
          </p>
          <p className="leading-[22.75px]">main menu.</p>
        </div>
      </div>
    </div>
  );
}

function OverlayBorder() {
  return (
    <div className="bg-[rgba(242,185,13,0.05)] relative rounded-[8px] shrink-0 w-full" data-name="Overlay+Border">
      <div aria-hidden="true" className="absolute border border-[rgba(242,185,13,0.2)] border-solid inset-0 pointer-events-none rounded-[8px]" />
      <div className="flex flex-row items-end size-full">
        <div className="content-stretch flex gap-[12px] items-end pb-[17px] pt-[15px] px-[17px] relative w-full">
          <div className="flex flex-row items-end self-stretch">
            <Container82 />
          </div>
          <Container83 />
        </div>
      </div>
    </div>
  );
}

function Margin6() {
  return (
    <div className="content-stretch flex flex-col items-start pt-[32px] relative shrink-0 w-full" data-name="Margin">
      <OverlayBorder />
    </div>
  );
}

function Container9() {
  return (
    <div className="content-stretch flex flex-col items-start max-w-[960px] relative self-stretch shrink-0 w-[960px]" data-name="Container">
      <Margin />
      <Margin1 />
      <BackgroundBorderShadow1 />
      <Margin6 />
    </div>
  );
}

function Main() {
  return (
    <div className="h-[1268.125px] relative shrink-0 w-full" data-name="Main">
      <div className="flex flex-row justify-center size-full">
        <div className="content-stretch flex items-start justify-center px-[24px] py-[40px] relative size-full">
          <Container9 />
        </div>
      </div>
    </div>
  );
}

function Container1() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Container">
      <Header />
      <Main />
    </div>
  );
}

function Container() {
  return (
    <div className="content-stretch flex flex-col items-start justify-center min-h-[900px] relative shrink-0 w-full" data-name="Container">
      <Container1 />
    </div>
  );
}

export default function Frame() {
  return (
    <div className="content-stretch flex flex-col items-start relative size-full" data-name="Frame" style={{ backgroundImage: "linear-gradient(90deg, rgb(248, 248, 245) 0%, rgb(248, 248, 245) 100%), linear-gradient(90deg, rgb(255, 255, 255) 0%, rgb(255, 255, 255) 100%)" }}>
      <Container />
    </div>
  );
}