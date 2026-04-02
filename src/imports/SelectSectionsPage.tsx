import svgPaths from "./svg-3i7h8lbbf7";

function Icon() {
  return (
    <div className="h-[28px] relative w-[24.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 24.02 28">
        <g id="Icon">
          <path d={svgPaths.pae53af0} fill="var(--fill-0, #221E10)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container2() {
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

function BackgroundShadow() {
  return (
    <div className="bg-[#f2b90d] content-stretch flex items-center justify-center relative rounded-[8px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] shrink-0 size-[32px]" data-name="Background+Shadow">
      <Container2 />
    </div>
  );
}

function Heading1() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Heading 2">
      <div className="flex flex-col font-['Lexend:Bold','Noto_Sans:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#1c180d] text-[20px] tracking-[-0.5px] whitespace-nowrap">
        <p className="leading-[28px]">Outline → Calendar</p>
      </div>
    </div>
  );
}

function Container1() {
  return (
    <div className="content-stretch flex gap-[12px] items-center relative shrink-0" data-name="Container">
      <BackgroundShadow />
      <Heading1 />
    </div>
  );
}

function Link() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Link">
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#1c180d] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">How it works</p>
      </div>
    </div>
  );
}

function Icon1() {
  return (
    <div className="h-[22px] relative w-[18px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 18 22">
        <g id="Icon">
          <path d={svgPaths.p3eff7480} fill="var(--fill-0, #9C8749)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container3() {
  return (
    <div className="content-stretch flex flex-col items-start py-[3px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon1 />
        </div>
      </div>
    </div>
  );
}

function Background() {
  return (
    <div className="bg-[#e8e2ce] content-stretch flex items-center justify-center relative rounded-[9999px] shrink-0 size-[32px]" data-name="Background">
      <Container3 />
    </div>
  );
}

function Nav() {
  return (
    <div className="content-stretch flex gap-[23.99px] items-center relative shrink-0" data-name="Nav">
      <Link />
      <Background />
    </div>
  );
}

function Container() {
  return (
    <div className="max-w-[1200px] relative shrink-0 w-full" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-center justify-between max-w-[inherit] relative w-full">
        <Container1 />
        <Nav />
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="backdrop-blur-[2px] bg-[rgba(248,248,245,0.95)] shrink-0 sticky top-0 w-full z-[2]" data-name="Header">
      <div aria-hidden="true" className="absolute border-[#e8e2ce] border-b border-solid inset-0 pointer-events-none" />
      <div className="content-stretch flex flex-col items-start pb-[17px] pt-[16px] px-[120px] relative w-full">
        <Container />
      </div>
    </div>
  );
}

function Icon2() {
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

function Container7() {
  return (
    <div className="content-stretch flex flex-col items-start py-[2px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon2 />
        </div>
      </div>
    </div>
  );
}

function Background1() {
  return (
    <div className="bg-[#16a34a] content-stretch flex items-center justify-center relative rounded-[9999px] shrink-0 size-[24px]" data-name="Background">
      <Container7 />
    </div>
  );
}

function Container8() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#15803d] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Upload</p>
      </div>
    </div>
  );
}

function ItemLink() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0" data-name="Item → Link">
      <Background1 />
      <Container8 />
    </div>
  );
}

function Icon3() {
  return (
    <div className="h-[22px] relative w-[18px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 18 22">
        <g id="Icon">
          <path d={svgPaths.p3b221f70} fill="var(--fill-0, #E8E2CE)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Item() {
  return (
    <div className="content-stretch flex items-start py-[3px] relative shrink-0" data-name="Item">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon3 />
        </div>
      </div>
    </div>
  );
}

function ItemMargin() {
  return (
    <div className="content-stretch flex flex-col items-start pb-px pl-[16px] relative shrink-0" data-name="Item:margin">
      <Item />
    </div>
  );
}

function Container10() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#221e10] text-[12px] whitespace-nowrap">
        <p className="leading-[16px]">2</p>
      </div>
    </div>
  );
}

function BackgroundShadow1() {
  return (
    <div className="bg-[#f2b90d] content-stretch flex items-center justify-center relative rounded-[9999px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] shrink-0 size-[24px]" data-name="Background+Shadow">
      <Container10 />
    </div>
  );
}

function Container11() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#f2b90d] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Select Sections</p>
      </div>
    </div>
  );
}

function Container9() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0" data-name="Container">
      <BackgroundShadow1 />
      <Container11 />
    </div>
  );
}

function Item1() {
  return (
    <div className="content-stretch flex items-center relative shrink-0" data-name="Item">
      <Container9 />
    </div>
  );
}

function ItemMargin1() {
  return (
    <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0" data-name="Item:margin">
      <Item1 />
    </div>
  );
}

function Icon4() {
  return (
    <div className="h-[22px] relative w-[18px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 18 22">
        <g id="Icon">
          <path d={svgPaths.p3b221f70} fill="var(--fill-0, #E8E2CE)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Item2() {
  return (
    <div className="content-stretch flex items-start py-[3px] relative shrink-0" data-name="Item">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon4 />
        </div>
      </div>
    </div>
  );
}

function ItemMargin2() {
  return (
    <div className="content-stretch flex flex-col items-start pb-px pl-[16px] relative shrink-0" data-name="Item:margin">
      <Item2 />
    </div>
  );
}

function Container13() {
  return (
    <div className="relative shrink-0" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col items-start relative">
        <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#9ca3af] text-[12px] whitespace-nowrap">
          <p className="leading-[16px]">3</p>
        </div>
      </div>
    </div>
  );
}

function Border() {
  return (
    <div className="content-stretch flex items-center justify-center p-[2px] relative rounded-[9999px] shrink-0 size-[24px]" data-name="Border">
      <div aria-hidden="true" className="absolute border-2 border-[#e8e2ce] border-solid inset-0 pointer-events-none rounded-[9999px]" />
      <Container13 />
    </div>
  );
}

function Container14() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#9ca3af] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Review Events</p>
      </div>
    </div>
  );
}

function Container12() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0" data-name="Container">
      <Border />
      <Container14 />
    </div>
  );
}

function Item3() {
  return (
    <div className="content-stretch flex items-center relative shrink-0" data-name="Item">
      <Container12 />
    </div>
  );
}

function ItemMargin3() {
  return (
    <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0" data-name="Item:margin">
      <Item3 />
    </div>
  );
}

function Icon5() {
  return (
    <div className="h-[22px] relative w-[18px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 18 22">
        <g id="Icon">
          <path d={svgPaths.p3b221f70} fill="var(--fill-0, #E8E2CE)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Item4() {
  return (
    <div className="content-stretch flex items-start py-[3px] relative shrink-0" data-name="Item">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon5 />
        </div>
      </div>
    </div>
  );
}

function ItemMargin4() {
  return (
    <div className="content-stretch flex flex-col items-start pb-px pl-[16px] relative shrink-0" data-name="Item:margin">
      <Item4 />
    </div>
  );
}

function Container16() {
  return (
    <div className="relative shrink-0" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col items-start relative">
        <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#9ca3af] text-[12px] whitespace-nowrap">
          <p className="leading-[16px]">4</p>
        </div>
      </div>
    </div>
  );
}

function Border1() {
  return (
    <div className="content-stretch flex items-center justify-center p-[2px] relative rounded-[9999px] shrink-0 size-[24px]" data-name="Border">
      <div aria-hidden="true" className="absolute border-2 border-[#e8e2ce] border-solid inset-0 pointer-events-none rounded-[9999px]" />
      <Container16 />
    </div>
  );
}

function Container17() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#9ca3af] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Export</p>
      </div>
    </div>
  );
}

function Container15() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0" data-name="Container">
      <Border1 />
      <Container17 />
    </div>
  );
}

function Item5() {
  return (
    <div className="content-stretch flex items-center relative shrink-0" data-name="Item">
      <Container15 />
    </div>
  );
}

function ItemMargin5() {
  return (
    <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0" data-name="Item:margin">
      <Item5 />
    </div>
  );
}

function List() {
  return (
    <div className="content-stretch flex items-center relative shrink-0" data-name="List">
      <ItemLink />
      <ItemMargin />
      <ItemMargin1 />
      <ItemMargin2 />
      <ItemMargin3 />
      <ItemMargin4 />
      <ItemMargin5 />
    </div>
  );
}

function NavProgress() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Nav - Progress">
      <List />
    </div>
  );
}

function Container6() {
  return (
    <div className="content-stretch flex items-center relative shrink-0 w-full" data-name="Container">
      <NavProgress />
    </div>
  );
}

function Container5() {
  return (
    <div className="absolute content-stretch flex flex-col items-start left-0 pb-[8px] right-0 top-0" data-name="Container">
      <Container6 />
    </div>
  );
}

function Heading() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Heading 1">
      <div className="flex flex-col font-['Inter:Black',sans-serif] font-black justify-center leading-[0] not-italic relative shrink-0 text-[#1c180d] text-[36px] tracking-[-0.9px] w-full">
        <p className="leading-[40px]">Review Detected Courses</p>
      </div>
    </div>
  );
}

function Container19() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Container">
      <div className="flex flex-col font-['Lexend:Regular',sans-serif] font-normal justify-center leading-[0] relative shrink-0 text-[#9c8749] text-[18px] w-full">
        <p className="leading-[28px]">Found weekly meetings and assessment dates for 2 courses.</p>
      </div>
    </div>
  );
}

function Container18() {
  return (
    <div className="absolute content-stretch flex flex-col gap-[8px] items-start left-0 right-0 top-[77px]" data-name="Container">
      <Heading />
      <Container19 />
    </div>
  );
}

function Overlay() {
  return (
    <div className="bg-[rgba(242,185,13,0.2)] content-stretch flex flex-col items-start px-[8px] py-[2px] relative rounded-[4px] shrink-0" data-name="Overlay">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#854d0e] text-[12px] tracking-[0.6px] uppercase whitespace-nowrap">
        <p className="leading-[16px]">CS 135</p>
      </div>
    </div>
  );
}

function Container23() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#6b7280] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Fall 2025</p>
      </div>
    </div>
  );
}

function Container22() {
  return (
    <div className="content-stretch flex gap-[12px] items-center relative shrink-0 w-full" data-name="Container">
      <Overlay />
      <Container23 />
    </div>
  );
}

function Heading2() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Heading 3">
      <div className="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative shrink-0 text-[#1c180d] text-[20px] whitespace-nowrap">
        <p className="leading-[25px]">Designing Functional Programs</p>
      </div>
    </div>
  );
}

function Container21() {
  return (
    <div className="relative shrink-0 w-[306px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col gap-[4px] items-start relative w-full">
        <Container22 />
        <Heading2 />
      </div>
    </div>
  );
}

function Icon6() {
  return (
    <div className="h-[15.989px] relative w-[14.01px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14.01 15.9886">
        <g id="Icon">
          <path d={svgPaths.pfced100} fill="var(--fill-0, #16A34A)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container24() {
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

function Container25() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#16a34a] text-[12px] whitespace-nowrap">
        <p className="leading-[16px]">Outline Parsed</p>
      </div>
    </div>
  );
}

function Background2() {
  return (
    <div className="bg-[#f0fdf4] relative rounded-[9999px] shrink-0" data-name="Background">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex gap-[7.99px] items-center px-[12px] py-[6px] relative">
        <Container24 />
        <Container25 />
      </div>
    </div>
  );
}

function OverlayHorizontalBorder() {
  return (
    <div className="bg-[rgba(249,250,251,0.5)] relative shrink-0 w-[958px]" data-name="Overlay+HorizontalBorder">
      <div aria-hidden="true" className="absolute border-[#e8e2ce] border-b border-solid inset-0 pointer-events-none" />
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-center flex flex-wrap items-center justify-between pb-[25px] pt-[24px] px-[24px] relative w-full">
        <Container21 />
        <Background2 />
      </div>
    </div>
  );
}

function Icon7() {
  return (
    <div className="h-[22px] relative w-[18px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 18 22">
        <g id="Icon">
          <path d={svgPaths.p3991a80} fill="var(--fill-0, #9C8749)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container28() {
  return (
    <div className="content-stretch flex flex-col items-start py-[3px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon7 />
        </div>
      </div>
    </div>
  );
}

function Label() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0 w-full" data-name="Label">
      <Container28 />
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#1c180d] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Lecture Section</p>
      </div>
    </div>
  );
}

function Image() {
  return (
    <div className="relative shrink-0 size-[24px]" data-name="image">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 24 24">
        <g id="image">
          <path d={svgPaths.p27916f80} id="Vector" stroke="var(--stroke-0, #6B7280)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </g>
      </svg>
    </div>
  );
}

function ImageFill() {
  return (
    <div className="absolute content-stretch flex flex-col h-[50px] items-end justify-center left-0 overflow-clip pl-[254.33px] pr-[9px] py-[13px] top-0 w-[287.33px]" data-name="image fill">
      <Image />
    </div>
  );
}

function Container29() {
  return (
    <div className="-translate-y-1/2 absolute content-stretch flex flex-col items-start left-[17px] overflow-clip right-[41px] top-1/2" data-name="Container">
      <div className="flex flex-col font-['Lexend:Regular',sans-serif] font-normal justify-center leading-[0] relative shrink-0 text-[#1c180d] text-[16px] whitespace-nowrap">
        <p className="leading-[24px]">LEC 001 (MWF 10:30)</p>
      </div>
    </div>
  );
}

function Options() {
  return (
    <div className="bg-[#f8f8f5] h-[50px] relative rounded-[8px] shrink-0 w-full" data-name="Options">
      <div aria-hidden="true" className="absolute border border-[#e8e2ce] border-solid inset-0 pointer-events-none rounded-[8px]" />
      <ImageFill />
      <Container29 />
    </div>
  );
}

function Container27() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative self-stretch shrink-0 w-[287.33px]" data-name="Container">
      <Label />
      <Options />
    </div>
  );
}

function Icon8() {
  return (
    <div className="h-[22px] relative w-[18px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 18 22">
        <g id="Icon">
          <path d={svgPaths.p57dd400} fill="var(--fill-0, #9C8749)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container31() {
  return (
    <div className="content-stretch flex flex-col items-start py-[3px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon8 />
        </div>
      </div>
    </div>
  );
}

function Label1() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0 w-full" data-name="Label">
      <Container31 />
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#1c180d] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Tutorial Section</p>
      </div>
    </div>
  );
}

function Image1() {
  return (
    <div className="relative shrink-0 size-[24px]" data-name="image">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 24 24">
        <g id="image">
          <path d={svgPaths.p27916f80} id="Vector" stroke="var(--stroke-0, #6B7280)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </g>
      </svg>
    </div>
  );
}

function ImageFill1() {
  return (
    <div className="absolute content-stretch flex flex-col h-[50px] items-end justify-center left-0 overflow-clip pl-[254.33px] pr-[9px] py-[13px] top-0 w-[287.33px]" data-name="image fill">
      <Image1 />
    </div>
  );
}

function Container32() {
  return (
    <div className="-translate-y-1/2 absolute content-stretch flex flex-col items-start left-[17px] overflow-clip right-[41px] top-1/2" data-name="Container">
      <div className="flex flex-col font-['Lexend:Regular',sans-serif] font-normal justify-center leading-[0] relative shrink-0 text-[#1c180d] text-[16px] whitespace-nowrap">
        <p className="leading-[24px]">Select Tutorial</p>
      </div>
    </div>
  );
}

function Options1() {
  return (
    <div className="bg-[#f8f8f5] h-[50px] relative rounded-[8px] shrink-0 w-full" data-name="Options">
      <div aria-hidden="true" className="absolute border border-[#e8e2ce] border-solid inset-0 pointer-events-none rounded-[8px]" />
      <ImageFill1 />
      <Container32 />
    </div>
  );
}

function Container30() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative self-stretch shrink-0 w-[287.33px]" data-name="Container">
      <Label1 />
      <Options1 />
    </div>
  );
}

function Icon9() {
  return (
    <div className="h-[22px] relative w-[18px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 18 22">
        <g id="Icon">
          <path d={svgPaths.p107c8a80} fill="var(--fill-0, #9C8749)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container34() {
  return (
    <div className="content-stretch flex flex-col items-start py-[3px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon9 />
        </div>
      </div>
    </div>
  );
}

function Label2() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0 w-full" data-name="Label">
      <Container34 />
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#1c180d] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Lab Section</p>
      </div>
    </div>
  );
}

function Image2() {
  return (
    <div className="relative shrink-0 size-[24px]" data-name="image">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 24 24">
        <g id="image">
          <path d="M7.2 9.6L12 14.4L16.8 9.6" id="Vector" stroke="var(--stroke-0, #6B7280)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </g>
      </svg>
    </div>
  );
}

function ImageFill2() {
  return (
    <div className="absolute content-stretch flex flex-col h-[50px] items-end justify-center left-0 overflow-clip pl-[254.34px] pr-[9px] py-[13px] top-0 w-[287.34px]" data-name="image fill">
      <Image2 />
    </div>
  );
}

function Container35() {
  return (
    <div className="-translate-y-1/2 absolute content-stretch flex flex-col items-start left-[17px] overflow-clip right-[41px] top-1/2" data-name="Container">
      <div className="flex flex-col font-['Lexend:Regular',sans-serif] font-normal justify-center leading-[0] relative shrink-0 text-[#1c180d] text-[16px] whitespace-nowrap">
        <p className="leading-[24px]">No Labs detected</p>
      </div>
    </div>
  );
}

function Options2() {
  return (
    <div className="bg-[#f3f4f6] h-[50px] opacity-50 relative rounded-[8px] shrink-0 w-full" data-name="Options">
      <div aria-hidden="true" className="absolute border border-[#e8e2ce] border-solid inset-0 pointer-events-none rounded-[8px]" />
      <ImageFill2 />
      <Container35 />
    </div>
  );
}

function Container33() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative self-stretch shrink-0 w-[287.34px]" data-name="Container">
      <Label2 />
      <Options2 />
    </div>
  );
}

function Container26() {
  return (
    <div className="h-[134px] relative shrink-0 w-[958px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex gap-[24px] items-start justify-center p-[24px] relative size-full">
        <Container27 />
        <Container30 />
        <Container33 />
      </div>
    </div>
  );
}

function BackgroundBorderShadow() {
  return (
    <div className="bg-white relative rounded-[12px] shrink-0 w-full" data-name="Background+Border+Shadow">
      <div className="content-stretch flex flex-col items-start overflow-clip p-px relative rounded-[inherit] w-full">
        <OverlayHorizontalBorder />
        <Container26 />
      </div>
      <div aria-hidden="true" className="absolute border border-[#e8e2ce] border-solid inset-0 pointer-events-none rounded-[12px] shadow-[0px_4px_20px_-2px_rgba(28,24,13,0.05)]" />
    </div>
  );
}

function Overlay1() {
  return (
    <div className="bg-[rgba(242,185,13,0.2)] content-stretch flex flex-col items-start px-[8px] py-[2px] relative rounded-[4px] shrink-0" data-name="Overlay">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#854d0e] text-[12px] tracking-[0.6px] uppercase whitespace-nowrap">
        <p className="leading-[16px]">MATH 137</p>
      </div>
    </div>
  );
}

function Container38() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#6b7280] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Fall 2025</p>
      </div>
    </div>
  );
}

function Container37() {
  return (
    <div className="content-stretch flex gap-[12px] items-center relative shrink-0 w-full" data-name="Container">
      <Overlay1 />
      <Container38 />
    </div>
  );
}

function Heading3() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="Heading 3">
      <div className="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative shrink-0 text-[#1c180d] text-[20px] whitespace-nowrap">
        <p className="leading-[25px]">Calculus 1 for Honours Mathematics</p>
      </div>
    </div>
  );
}

function Container36() {
  return (
    <div className="relative shrink-0 w-[354px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col gap-[4px] items-start relative w-full">
        <Container37 />
        <Heading3 />
      </div>
    </div>
  );
}

function Icon10() {
  return (
    <div className="h-[15.989px] relative w-[14.01px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14.01 15.9886">
        <g id="Icon">
          <path d={svgPaths.pfced100} fill="var(--fill-0, #16A34A)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container39() {
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

function Container40() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#16a34a] text-[12px] whitespace-nowrap">
        <p className="leading-[16px]">Outline Parsed</p>
      </div>
    </div>
  );
}

function Background3() {
  return (
    <div className="bg-[#f0fdf4] relative rounded-[9999px] shrink-0" data-name="Background">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex gap-[7.99px] items-center px-[12px] py-[6px] relative">
        <Container39 />
        <Container40 />
      </div>
    </div>
  );
}

function OverlayHorizontalBorder1() {
  return (
    <div className="bg-[rgba(249,250,251,0.5)] relative shrink-0 w-[958px]" data-name="Overlay+HorizontalBorder">
      <div aria-hidden="true" className="absolute border-[#e8e2ce] border-b border-solid inset-0 pointer-events-none" />
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-center flex flex-wrap items-center justify-between pb-[25px] pt-[24px] px-[24px] relative w-full">
        <Container36 />
        <Background3 />
      </div>
    </div>
  );
}

function Icon11() {
  return (
    <div className="h-[22px] relative w-[18px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 18 22">
        <g id="Icon">
          <path d={svgPaths.p3991a80} fill="var(--fill-0, #9C8749)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container43() {
  return (
    <div className="content-stretch flex flex-col items-start py-[3px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon11 />
        </div>
      </div>
    </div>
  );
}

function Label3() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0 w-full" data-name="Label">
      <Container43 />
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#1c180d] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Lecture Section</p>
      </div>
    </div>
  );
}

function Image3() {
  return (
    <div className="relative shrink-0 size-[24px]" data-name="image">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 24 24">
        <g id="image">
          <path d={svgPaths.p27916f80} id="Vector" stroke="var(--stroke-0, #6B7280)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </g>
      </svg>
    </div>
  );
}

function ImageFill3() {
  return (
    <div className="absolute content-stretch flex flex-col h-[50px] items-end justify-center left-0 overflow-clip pl-[254.33px] pr-[9px] py-[13px] top-0 w-[287.33px]" data-name="image fill">
      <Image3 />
    </div>
  );
}

function Container44() {
  return (
    <div className="-translate-y-1/2 absolute content-stretch flex flex-col items-start left-[17px] overflow-clip right-[41px] top-1/2" data-name="Container">
      <div className="flex flex-col font-['Lexend:Regular',sans-serif] font-normal justify-center leading-[0] relative shrink-0 text-[#1c180d] text-[16px] whitespace-nowrap">
        <p className="leading-[24px]">Select Lecture</p>
      </div>
    </div>
  );
}

function Options3() {
  return (
    <div className="bg-[#f8f8f5] h-[50px] relative rounded-[8px] shrink-0 w-full" data-name="Options">
      <div aria-hidden="true" className="absolute border border-[#e8e2ce] border-solid inset-0 pointer-events-none rounded-[8px]" />
      <ImageFill3 />
      <Container44 />
    </div>
  );
}

function Container42() {
  return (
    <div className="content-stretch flex flex-[1_0_0] flex-col gap-[8px] items-start min-h-px min-w-px relative self-stretch" data-name="Container">
      <Label3 />
      <Options3 />
    </div>
  );
}

function Icon12() {
  return (
    <div className="h-[22px] relative w-[18px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 18 22">
        <g id="Icon">
          <path d={svgPaths.p57dd400} fill="var(--fill-0, #9C8749)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container46() {
  return (
    <div className="content-stretch flex flex-col items-start py-[3px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon12 />
        </div>
      </div>
    </div>
  );
}

function Label4() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0 w-full" data-name="Label">
      <Container46 />
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#1c180d] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Tutorial Section</p>
      </div>
    </div>
  );
}

function Image4() {
  return (
    <div className="relative shrink-0 size-[24px]" data-name="image">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 24 24">
        <g id="image">
          <path d={svgPaths.p27916f80} id="Vector" stroke="var(--stroke-0, #6B7280)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </g>
      </svg>
    </div>
  );
}

function ImageFill4() {
  return (
    <div className="absolute content-stretch flex flex-col h-[50px] items-end justify-center left-0 overflow-clip pl-[254.33px] pr-[9px] py-[13px] top-0 w-[287.33px]" data-name="image fill">
      <Image4 />
    </div>
  );
}

function Container47() {
  return (
    <div className="-translate-y-1/2 absolute content-stretch flex flex-col items-start left-[17px] overflow-clip right-[41px] top-1/2" data-name="Container">
      <div className="flex flex-col font-['Lexend:Regular',sans-serif] font-normal justify-center leading-[0] relative shrink-0 text-[#1c180d] text-[16px] whitespace-nowrap">
        <p className="leading-[24px]">TUT 102 (Th 15:30)</p>
      </div>
    </div>
  );
}

function Options4() {
  return (
    <div className="bg-[#f8f8f5] h-[50px] relative rounded-[8px] shrink-0 w-full" data-name="Options">
      <div aria-hidden="true" className="absolute border border-[#e8e2ce] border-solid inset-0 pointer-events-none rounded-[8px]" />
      <ImageFill4 />
      <Container47 />
    </div>
  );
}

function Container45() {
  return (
    <div className="content-stretch flex flex-[1_0_0] flex-col gap-[8px] items-start min-h-px min-w-px relative self-stretch" data-name="Container">
      <Label4 />
      <Options4 />
    </div>
  );
}

function Container41() {
  return (
    <div className="h-[134px] relative shrink-0 w-[958px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex gap-[24px] items-start justify-center pl-[24px] pr-[335.34px] py-[24px] relative size-full">
        <Container42 />
        <Container45 />
      </div>
    </div>
  );
}

function BackgroundBorderShadow1() {
  return (
    <div className="bg-white relative rounded-[12px] shrink-0 w-full" data-name="Background+Border+Shadow">
      <div className="content-stretch flex flex-col items-start overflow-clip p-px relative rounded-[inherit] w-full">
        <OverlayHorizontalBorder1 />
        <Container41 />
      </div>
      <div aria-hidden="true" className="absolute border border-[#e8e2ce] border-solid inset-0 pointer-events-none rounded-[12px] shadow-[0px_4px_20px_-2px_rgba(28,24,13,0.05)]" />
    </div>
  );
}

function Icon13() {
  return (
    <div className="h-[28px] relative w-[24.02px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 24.02 28">
        <g id="Icon">
          <path d={svgPaths.p1f87ff00} fill="var(--fill-0, #9C8749)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container49() {
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

function Container50() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0" data-name="Container">
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#9c8749] text-[14px] whitespace-nowrap">
        <p className="leading-[20px]">Is a course missing?</p>
      </div>
    </div>
  );
}

function Container48() {
  return (
    <div className="relative shrink-0" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex gap-[12px] items-center relative">
        <Container49 />
        <Container50 />
      </div>
    </div>
  );
}

function Button() {
  return (
    <div className="relative shrink-0" data-name="Button">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col items-center justify-center relative">
        <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#9c8749] text-[14px] text-center whitespace-nowrap">
          <p className="leading-[20px]">Upload another outline</p>
        </div>
      </div>
    </div>
  );
}

function OverlayBorder() {
  return (
    <div className="bg-[rgba(156,135,73,0.05)] relative rounded-[8px] shrink-0 w-full" data-name="Overlay+Border">
      <div aria-hidden="true" className="absolute border border-[rgba(156,135,73,0.4)] border-dashed inset-0 pointer-events-none rounded-[8px]" />
      <div className="flex flex-row items-center size-full">
        <div className="content-stretch flex items-center justify-between px-[17px] py-[15px] relative w-full">
          <Container48 />
          <Button />
        </div>
      </div>
    </div>
  );
}

function Container20() {
  return (
    <div className="absolute content-stretch flex flex-col gap-[24px] items-start left-0 right-0 top-[175px]" data-name="Container">
      <BackgroundBorderShadow />
      <BackgroundBorderShadow1 />
      <OverlayBorder />
    </div>
  );
}

function Margin() {
  return <div className="h-[117px] pointer-events-auto sticky top-0" data-name="Margin" />;
}

function Icon14() {
  return (
    <div className="h-[22px] relative w-[18px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 18 22">
        <g id="Icon">
          <path d={svgPaths.p34920c00} fill="var(--fill-0, #1C180D)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container52() {
  return (
    <div className="content-stretch flex flex-col items-start py-[3px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon14 />
        </div>
      </div>
    </div>
  );
}

function Button1() {
  return (
    <div className="content-stretch flex gap-[8px] items-center justify-center px-[24px] py-[12px] relative rounded-[8px] shrink-0" data-name="Button">
      <Container52 />
      <div className="flex flex-col font-['Lexend:Medium',sans-serif] font-medium justify-center leading-[0] relative shrink-0 text-[#1c180d] text-[16px] text-center whitespace-nowrap">
        <p className="leading-[24px]">Back</p>
      </div>
    </div>
  );
}

function Icon15() {
  return (
    <div className="h-[22px] relative w-[18px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 18 22">
        <g id="Icon">
          <path d={svgPaths.p1fa1da80} fill="var(--fill-0, #1C180D)" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function Container53() {
  return (
    <div className="content-stretch flex flex-col items-start py-[3px] relative shrink-0" data-name="Container">
      <div className="flex items-center justify-center relative shrink-0">
        <div className="-scale-y-100 flex-none">
          <Icon15 />
        </div>
      </div>
    </div>
  );
}

function Button2() {
  return (
    <div className="bg-[#f2b90d] content-stretch flex gap-[8px] items-center justify-center overflow-clip px-[32px] py-[12px] relative rounded-[8px] shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.1)] shrink-0" data-name="Button">
      <div className="flex flex-col font-['Lexend:Bold',sans-serif] font-bold justify-center leading-[0] relative shrink-0 text-[#1c180d] text-[16px] text-center whitespace-nowrap">
        <p className="leading-[24px]">Next: Review Events</p>
      </div>
      <Container53 />
    </div>
  );
}

function Container51() {
  return (
    <div className="max-w-[960px] relative shrink-0 w-full" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-center justify-between max-w-[inherit] relative w-full">
        <Button1 />
        <Button2 />
      </div>
    </div>
  );
}

function BackgroundHorizontalBorderOverlayBlur() {
  return (
    <div className="backdrop-blur-[6px] bg-[rgba(248,248,245,0.95)] content-stretch flex flex-col items-start pb-[24px] pointer-events-auto pt-[25px] px-[24px] sticky top-0" data-name="Background+HorizontalBorder+OverlayBlur">
      <div aria-hidden="true" className="absolute border-[#e8e2ce] border-solid border-t inset-0 pointer-events-none" />
      <Container51 />
    </div>
  );
}

function Container4() {
  return (
    <div className="h-[924px] max-w-[960px] relative shrink-0 w-full" data-name="Container">
      <Container5 />
      <Container18 />
      <Container20 />
      <div className="absolute h-[260px] inset-[664px_0_0_0] pointer-events-none">
        <Margin />
      </div>
      <div className="absolute h-[156px] inset-[768px_-24px_0_-24px] pointer-events-none">
        <BackgroundHorizontalBorderOverlayBlur />
      </div>
    </div>
  );
}

function Main() {
  return (
    <div className="relative shrink-0 w-full z-[1]" data-name="Main">
      <div className="content-stretch flex flex-col items-start px-[240px] py-[32px] relative w-full">
        <Container4 />
      </div>
    </div>
  );
}

function Frame() {
  return (
    <div className="absolute content-stretch flex flex-col isolate items-start left-0 min-h-[900px] right-0 top-0" data-name="Frame" style={{ backgroundImage: "linear-gradient(90deg, rgb(248, 248, 245) 0%, rgb(248, 248, 245) 100%), linear-gradient(90deg, rgb(255, 255, 255) 0%, rgb(255, 255, 255) 100%)" }}>
      <Header />
      <Main />
    </div>
  );
}

export default function SelectSectionsPage() {
  return (
    <div className="bg-white overflow-clip relative rounded-[32px] size-full" data-name="Select Sections Page">
      <Frame />
    </div>
  );
}