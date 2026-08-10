/**
 * 2026-08-10 사용자가 넘긴 세 파일(크롬 북마크 내보내기 · AC/VC/프로그램 CSV · AI 인사이트 메모)을
 * 대시보드에 반영하기 위한 **반입표**. `scripts/import-links.ts` 가 이 표대로 링크를 만들고 옮긴다.
 *
 * ## 무엇을 걸러 냈나
 *
 * 원본 합계는 약 360건이었지만 그대로 넣지 않았다.
 *
 * 1. **표 안의 중복** — CSV 의 `Program` 20건은 사실상 세 주소다(TIPS 6종이 전부
 *    `jointips.or.kr`, 패키지 6종이 전부 `kised.or.kr`, 나머지는 AC 항목과 같은 주소).
 *    `ai-insight-links.md` 는 북마크의 요약본이라 새 링크가 `paperclip.ing` 하나뿐이었다.
 * 2. **이미 있는 링크** — ChatGPT·Gemini·Behance·DBpia·RISS·KCI·구글학술·후커블·키위스냅·
 *    Awwwards·CSS Design Awards 등은 대시보드에 이미 있어 뺐다.
 * 3. **죽은 주소** — 후보 전수를 실제로 열어 봤다(HTTP 확인). CSV 의 AC/VC 주소는 추측으로 만든
 *    것이 많아 40%가 도메인조차 없었다. 살아 있는 정식 주소를 찾은 것만 고쳐 넣고(드림플러스
 *    `dreamplus.asia`, D2SF `d2startup.com`, 에이티넘 `atinum.com`, 알토스 `altos.vc`,
 *    한국부동산원 `reb.or.kr`, KB부동산 `kbland.kr` 등) 못 찾은 것은 버렸다.
 * 4. **인증서가 깨진 곳** — 마루180·홍합밸리·현대카드 스튜디오블랙 등은 브라우저가 경고를 띄운다.
 *    경고를 보여 주는 링크는 없는 것만 못해 뺐다.
 * 5. **일회성 URL** — 특정 공고 상세, 특정 기사, 개인 구글시트, Play Console 하위 화면 등은
 *    서비스 루트로 정규화하거나 뺐다.
 *
 * 뺀 것 중 사용자가 다시 넣고 싶어 할 만한 묶음은 리포트에 적어 두었다.
 *
 * ## 설명 길이 예산은 `enrich-data.ts` 와 같은 42자다
 *
 * 카드 설명 칸이 3줄이고 가장 좁은 칸에서 한 줄 11자이기 때문이다
 * (`components/card/geometry.ts`). 넘치면 `import-links.ts` 가 아무것도 쓰지 않고 멈춘다.
 */

export type ImportLink = {
  url: string;
  title: string;
  /** 한 문장 설명 — 42자 이내. */
  description: string;
  /** `'상위 > 하위'` 또는 `'상위'`. */
  category: string;
};

/**
 * 새로 만드는 분류와 근거. `import-links.ts` 는 **이 목록에 있는 이름만** 만든다 —
 * 분류명 오타가 조용히 링크 한 건짜리 유령 분류를 낳지 않게 하는 빗장이다(enrich 와 같은 규약).
 */
export const NEW_CATEGORIES: { path: string; why: string }[] = [
  {
    path: '투자·창업 지원',
    why: '액셀러레이터·VC·정부지원사업·특허가 통째로 새로 들어왔다(약 80건). 기존 어느 상위에도 붙지 않고, 회사가 실제로 매년 도는 업무 축이라 상위로 세운다.',
  },
  { path: '투자·창업 지원 > 액셀러레이터·창업공간', why: 'CSV 의 AC 묶음 + 창업공간·재단.' },
  { path: '투자·창업 지원 > 벤처캐피털', why: 'CSV 의 VC 묶음 중 주소가 살아 있는 것.' },
  { path: '투자·창업 지원 > 정부지원 공고', why: '공고를 찾아 신청하는 창구. 45건짜리 북마크 폴더를 공고/기관/특허/노무 넷으로 나눈 첫째다(하위 25건 규칙).' },
  { path: '투자·창업 지원 > 창업지원 기관', why: '공고를 내는 쪽 — 부처·진흥원·재단. 공고 창구와 섞이면 "어디서 신청하나"를 찾을 수 없다.' },
  { path: '투자·창업 지원 > 특허·인증', why: '특허 검색·상표 등록·기업부설연구소·벤처확인.' },
  { path: '투자·창업 지원 > 고용·노무', why: '4대보험·두루누리·내일채움공제 — 사람을 뽑고 유지하는 쪽 제도.' },
  {
    path: '금융·투자 정보',
    why: '주식·부동산·국가통계·기업신용·경제연구 약 55건. 우리가 만드는 MacroLens(주식 분석)와 사업계획서에 쓰는 근거 자료가 여기 모인다.',
  },
  { path: '금융·투자 정보 > 주식·시장', why: '시세·공모주·차트.' },
  { path: '금융·투자 정보 > 부동산', why: '청약·실거래가·공시가격·경매 등 공공 포털.' },
  { path: '금융·투자 정보 > 국가통계', why: 'KOSIS·지표누리·DART 등 1차 통계 출처.' },
  { path: '금융·투자 정보 > 기업정보·신용', why: '기업 신용·재무·공시를 조회하는 상용 서비스.' },
  { path: '금융·투자 정보 > 경제연구기관', why: '한국은행·KDI·민간 연구소의 리포트.' },
  {
    path: '뉴스·인사이트',
    why: 'AI·스타트업·프로덕트 소식 약 40건. **읽는 것**이라 도구(AI 도구 모음)와 섞으면 안 된다 — 그 상위는 "무엇으로 일하는가"이고 이쪽은 "무엇을 읽는가"다.',
  },
  { path: '뉴스·인사이트 > AI 뉴스', why: '국내외 AI 뉴스·뉴스레터·연구소 블로그.' },
  { path: '뉴스·인사이트 > 스타트업 뉴스', why: '국내 스타트업 미디어·투자 DB.' },
  { path: '뉴스·인사이트 > 프로덕트 레퍼런스', why: '해외 신제품·인디해커·벤치마킹.' },
  {
    path: '디자인 레퍼런스 > UI·웹 갤러리',
    why: '기존 직속 12건이 여기로 들어간다. 폰트·색상·아이콘·이미지가 새로 붙으면서 상위가 68건이 됐고, 직속과 하위가 섞이면 직속 항목이 "전체" 탭에서만 보인다.',
  },
  { path: '디자인 레퍼런스 > 웹디자인 참고', why: '국내외 웹사이트 벤치마킹·패턴 사전.' },
  { path: '디자인 레퍼런스 > 폰트', why: '무료 한글·영문 폰트를 찾는 곳.' },
  { path: '디자인 레퍼런스 > 색상', why: '팔레트·브랜드 컬러.' },
  { path: '디자인 레퍼런스 > 아이콘', why: '무료 아이콘 세트.' },
  { path: '디자인 레퍼런스 > 무료 이미지·영상', why: '저작권 걱정 없는 사진·영상·GIF·목업.' },
  { path: '업무 워크스페이스 > 결제·정산', why: '국내외 결제·정산 수단(PG·페이팔·페이오니아).' },
  { path: '업무 워크스페이스 > 제휴 마케팅', why: '워드프레스 계열 제휴 프로그램 정산 화면.' },
  { path: '강의·교육 > 워크숍·연수 장소', why: '기업 교육·워크숍을 여는 국내 연수 시설. 강의 사업의 실행 축이라 강의·교육 아래가 맞다.' },
];

/** 이미 있는 링크를 새 하위로 옮기는 것만 적는다(제목·설명은 건드리지 않는다). */
export const MOVES: { url: string; category: string }[] = [
  { url: 'https://wwit.design/#google_vignette', category: '디자인 레퍼런스 > UI·웹 갤러리' },
  { url: 'https://land-book.com/', category: '디자인 레퍼런스 > UI·웹 갤러리' },
  { url: 'https://uibowl.io/', category: '디자인 레퍼런스 > UI·웹 갤러리' },
  { url: 'https://mobbin.com/', category: '디자인 레퍼런스 > UI·웹 갤러리' },
  { url: 'https://scrnshts.club/', category: '디자인 레퍼런스 > UI·웹 갤러리' },
  { url: 'https://appshots.design/', category: '디자인 레퍼런스 > UI·웹 갤러리' },
  { url: 'https://www.lapa.ninja/', category: '디자인 레퍼런스 > UI·웹 갤러리' },
  { url: 'https://collectui.com/', category: '디자인 레퍼런스 > UI·웹 갤러리' },
  { url: 'https://designbase.co.kr/designer-bookmark/', category: '디자인 레퍼런스 > UI·웹 갤러리' },
  { url: 'https://www.cssdesignawards.com/', category: '디자인 레퍼런스 > UI·웹 갤러리' },
  { url: 'https://www.awwwards.com/', category: '디자인 레퍼런스 > UI·웹 갤러리' },
  { url: 'https://www.behance.net/', category: '디자인 레퍼런스 > UI·웹 갤러리' },
];

export const IMPORTS: ImportLink[] = [
  // ───────────────────────────── 투자·창업 지원 > 액셀러레이터·창업공간
  { url: 'https://primer.kr', title: '프라이머', description: '국내 1세대 액셀러레이터. 초기 창업팀에 투자하고 멘토링한다', category: '투자·창업 지원 > 액셀러레이터·창업공간' },
  { url: 'https://apply.primer.kr', title: '프라이머 스타트업랩', description: '프라이머가 여는 초기 창업 교육·지원 프로그램 신청 창구', category: '투자·창업 지원 > 액셀러레이터·창업공간' },
  { url: 'https://sparklabs.co.kr', title: '스파크랩', description: '데모데이로 유명한 글로벌 액셀러레이터의 한국 법인', category: '투자·창업 지원 > 액셀러레이터·창업공간' },
  { url: 'https://dcamp.kr', title: '디캠프', description: '은행권청년창업재단이 운영하는 창업 공간과 투자 프로그램', category: '투자·창업 지원 > 액셀러레이터·창업공간' },
  { url: 'https://dcamp.kr/event/official/dday', title: '디캠프 디데이', description: '매달 열리는 국내 대표 스타트업 데모데이. 참가 신청도 여기서', category: '투자·창업 지원 > 액셀러레이터·창업공간' },
  { url: 'https://futureplay.co', title: '퓨처플레이', description: '기술 창업에 집중하는 컴퍼니빌더형 액셀러레이터', category: '투자·창업 지원 > 액셀러레이터·창업공간' },
  { url: 'https://bonangels.com', title: '본엔젤스', description: '초기 단계 팀에 먼저 들어가는 국내 대표 엔젤 투자사', category: '투자·창업 지원 > 액셀러레이터·창업공간' },
  { url: 'https://bluepoint.ac', title: '블루포인트파트너스', description: '딥테크 창업을 발굴해 사업화까지 붙어 주는 액셀러레이터', category: '투자·창업 지원 > 액셀러레이터·창업공간' },
  { url: 'https://500.co', title: '500 Global', description: '전 세계 초기 스타트업에 투자하는 실리콘밸리 액셀러레이터', category: '투자·창업 지원 > 액셀러레이터·창업공간' },
  { url: 'https://startup.google.com/campus/seoul', title: 'Google for Startups', description: '구글이 여는 창업자 지원 프로그램과 서울 캠퍼스 소식', category: '투자·창업 지원 > 액셀러레이터·창업공간' },
  { url: 'https://dreamplus.asia', title: '드림플러스', description: '한화가 운영하는 스타트업 공간과 오픈이노베이션 프로그램', category: '투자·창업 지원 > 액셀러레이터·창업공간' },
  { url: 'https://d2startup.com', title: 'NAVER D2SF', description: '네이버의 기술 스타트업 투자·협업 조직', category: '투자·창업 지원 > 액셀러레이터·창업공간' },
  { url: 'https://n15.asia', title: 'N15', description: '제조·하드웨어 창업을 시제품부터 돕는 액셀러레이터', category: '투자·창업 지원 > 액셀러레이터·창업공간' },
  { url: 'https://yoonmin.org/', title: '윤민창의투자재단', description: '청년 창업팀에 무상으로 투자·공간을 지원하는 재단', category: '투자·창업 지원 > 액셀러레이터·창업공간' },
  { url: 'https://www.wework.com/labs', title: 'WeWork Labs', description: '위워크가 여는 초기 창업팀 멤버십 프로그램', category: '투자·창업 지원 > 액셀러레이터·창업공간' },

  // ───────────────────────────── 투자·창업 지원 > 벤처캐피털
  { url: 'https://kipvc.co.kr', title: '한국투자파트너스', description: '운용자산 기준 국내 최대급 벤처캐피털', category: '투자·창업 지원 > 벤처캐피털' },
  { url: 'https://imminvestment.com', title: 'IMM인베스트먼트', description: '벤처부터 그로스까지 폭넓게 투자하는 국내 대형 VC', category: '투자·창업 지원 > 벤처캐피털' },
  { url: 'https://www.stic.co.kr', title: '스틱인베스트먼트', description: '성장 단계 기업에 대규모로 투자하는 국내 대표 PE·VC', category: '투자·창업 지원 > 벤처캐피털' },
  { url: 'https://www.stonebridge.co.kr', title: '스톤브릿지벤처스', description: 'ICT·바이오 중심으로 초기~성장 단계에 투자하는 VC', category: '투자·창업 지원 > 벤처캐피털' },
  { url: 'https://lbinvestment.com', title: 'LB인베스트먼트', description: '기술 기업에 투자하는 국내 벤처캐피털', category: '투자·창업 지원 > 벤처캐피털' },
  { url: 'https://intervest.co.kr', title: '인터베스트', description: '반도체·소재 등 기술 분야에 강한 국내 벤처캐피털', category: '투자·창업 지원 > 벤처캐피털' },
  { url: 'https://www.atinum.com', title: '에이티넘인베스트먼트', description: '대형 벤처펀드를 운용하는 국내 오래된 VC', category: '투자·창업 지원 > 벤처캐피털' },
  { url: 'https://altos.vc', title: 'Altos Ventures', description: '토스·크래프톤에 투자한 한국계 실리콘밸리 VC', category: '투자·창업 지원 > 벤처캐피털' },
  { url: 'https://premierpartners.co.kr', title: '프리미어파트너스', description: '성장 단계 기술 기업에 투자하는 국내 벤처캐피털', category: '투자·창업 지원 > 벤처캐피털' },
  { url: 'https://www.tsinvestment.co.kr', title: '티에스인베스트먼트', description: '중소·벤처기업에 투자하는 코스닥 상장 창업투자회사', category: '투자·창업 지원 > 벤처캐피털' },
  { url: 'https://shinhanvc.com', title: '신한벤처투자', description: '신한금융그룹의 벤처캐피털', category: '투자·창업 지원 > 벤처캐피털' },

  // ───────────────────────────── 투자·창업 지원 > 정부지원 공고
  { url: 'https://www.k-startup.go.kr', title: 'K-Startup', description: '창업진흥원이 여는 창업지원사업 공고를 한곳에서 찾는다', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://www.bizinfo.go.kr/web/index.do', title: '기업마당', description: '부처·지자체 중소기업 지원사업을 모아 주는 정부 포털', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://www.kised.or.kr', title: '창업진흥원', description: '예비·초기창업패키지 등 창업지원사업을 운영하는 기관', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://www.jointips.or.kr', title: 'TIPS', description: '민간 투자와 정부 R&D를 묶어 주는 팁스 프로그램 공식 창구', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://portal.smes.go.kr', title: '중소벤처24', description: '중소기업 확인서·지원사업 신청을 한 곳에서 처리하는 창구', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://ols.semas.or.kr/ols/man/SMAN056M/page.do', title: '소상공인 정책자금', description: '소진공이 빌려주는 정책자금 신청 창구', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://pms.ripc.org/pms/biz/applicant/notice/list.do', title: 'RIPC IP 지원사업', description: '지역지식재산센터의 특허·브랜드 지원사업 공고와 신청', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://venture.g2b.go.kr', title: '벤처나라', description: '벤처·창업기업 제품을 공공기관에 파는 조달 전용 장터', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://www.gosims.go.kr/hh/hh001/retrieveTrgetSearchList.do', title: '보조금통합포털', description: '내가 받을 수 있는 국고보조금을 찾아보는 정부 포털', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://www.g2b.go.kr/index.jsp', title: '나라장터', description: '공공기관 입찰 공고와 계약이 오가는 국가종합전자조달', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://ppi.g2b.go.kr:8914/portal/intro.do', title: '혁신장터', description: '혁신제품을 공공에 파는 조달 창구. 지정 신청도 여기서', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://service.g2b.go.kr:8056/main.do', title: '이음장터', description: '조달청이 여는 서비스 분야 전용 계약 창구', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://www.ntis.go.kr/rndgate/eg/un/ra/mng.do', title: '국가R&D 통합공고', description: '부처별 국가 연구개발 사업 공고를 한 화면에 모은 곳', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://www.iris.go.kr/main.do', title: 'IRIS', description: '국가 R&D 과제를 신청하고 관리하는 범부처 통합 시스템', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://www.smtech.go.kr/', title: 'SMTECH', description: '중소기업 기술개발사업 공고·신청·정산을 다루는 시스템', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://www.kbid.co.kr/first/index_first.htm', title: '케이비드', description: '공공 입찰 공고를 모아 알려 주는 국내 입찰정보 서비스', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://www.cliwant.com', title: '클라이원트', description: '입찰 공고를 AI가 골라 주고 제안서까지 돕는 수주 도구', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://linkup.e-sang.net/', title: 'LINKUP', description: '중소기업 지원사업 신청과 서류를 처리하는 위탁 플랫폼', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://seoul.rnbd.kr/client/index.jsp', title: 'SBA 서울R&D지원센터', description: '서울시가 여는 기업 R&D 지원사업 공고와 신청 창구', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://start.kosmes.or.kr/yh_mai001_001.do', title: '청년창업사관학교', description: '중진공이 운영하는 청년 창업 집중 지원 과정', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://www.bizmoney.ai', title: 'BIZMONEY', description: '우리 회사에 맞는 정책자금을 찾아 주는 매칭 서비스', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://www.vcs.go.kr/web/portal/contents/M010501', title: '벤처투자종합포털', description: '벤처투자 통계와 조합·투자사 정보를 공개하는 정부 포털', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://www.cloudsup.or.kr/', title: '클라우드 지원포털', description: '중소기업 클라우드 도입 비용을 지원해 주는 사업 창구', category: '투자·창업 지원 > 정부지원 공고' },
  { url: 'https://startup-plus.kr/', title: '스타트업플러스', description: '서울시 창업 지원과 공간을 한곳에 모은 통합 플랫폼', category: '투자·창업 지원 > 정부지원 공고' },

  // ───────────────────────────── 투자·창업 지원 > 창업지원 기관
  { url: 'https://www.mss.go.kr/', title: '중소벤처기업부', description: '중소·벤처·소상공인 정책을 만드는 부처. 보도자료가 빠르다', category: '투자·창업 지원 > 창업지원 기관' },
  { url: 'https://www.kosmes.or.kr/intro/intro.html', title: '중소벤처기업진흥공단', description: '정책자금·수출·인력을 지원하는 중소기업 지원 기관', category: '투자·창업 지원 > 창업지원 기관' },
  { url: 'https://ccei.creativekorea.or.kr/', title: '창조경제혁신센터', description: '전국 시도별 창업 보육과 지원사업을 맡는 거점 기관', category: '투자·창업 지원 > 창업지원 기관' },
  { url: 'https://www.gsp.or.kr/', title: '경기스타트업플랫폼', description: '경기도 창업 지원사업과 공간을 모아 둔 통합 플랫폼', category: '투자·창업 지원 > 창업지원 기관' },
  { url: 'https://www.gjf.or.kr/main/main.do', title: '경기도일자리재단', description: '경기도의 취업·창업·직업훈련 사업을 운영하는 재단', category: '투자·창업 지원 > 창업지원 기관' },
  { url: 'https://www.kocca.kr/', title: '한국콘텐츠진흥원', description: '콘텐츠 분야 제작·창업 지원사업을 여는 기관', category: '투자·창업 지원 > 창업지원 기관' },
  { url: 'https://www.gcon.or.kr/', title: '경기콘텐츠진흥원', description: '경기도 콘텐츠 기업의 제작·마케팅을 지원하는 기관', category: '투자·창업 지원 > 창업지원 기관' },
  { url: 'https://www.kiat.or.kr/', title: 'KIAT', description: '산업기술 R&D와 기술사업화를 지원하는 진흥원', category: '투자·창업 지원 > 창업지원 기관' },
  { url: 'http://www.kotra.or.kr/', title: 'KOTRA 무역투자24', description: '해외 진출 상담·바이어 발굴을 지원하는 공공 창구', category: '투자·창업 지원 > 창업지원 기관' },
  { url: 'https://dream.kotra.or.kr', title: 'KOTRA 해외시장뉴스', description: '국가별 시장 동향과 진출 사례를 정리한 무료 리포트', category: '투자·창업 지원 > 창업지원 기관' },
  { url: 'http://www.kita.net/', title: '한국무역협회', description: '무역 통계·교육·상담을 제공하는 국내 최대 무역 단체', category: '투자·창업 지원 > 창업지원 기관' },
  { url: 'https://www.ntb.kr/', title: 'NTB 기술은행', description: '이전받을 수 있는 공공 기술과 시장 동향을 찾는 곳', category: '투자·창업 지원 > 창업지원 기관' },
  { url: 'https://www.seoulsbdc.or.kr/', title: '서울신용보증재단', description: '서울 소상공인 보증과 종합 지원을 맡는 재단', category: '투자·창업 지원 > 창업지원 기관' },
  { url: 'http://sminfo.mss.go.kr/cm/sv/CSV001R0.do', title: '중소기업현황정보시스템', description: '중소기업 확인서를 발급받고 현황을 조회하는 시스템', category: '투자·창업 지원 > 창업지원 기관' },
  { url: 'http://www.korea.kr/main.do', title: '대한민국 정책브리핑', description: '부처 정책과 보도자료를 한곳에 모아 주는 정부 채널', category: '투자·창업 지원 > 창업지원 기관' },
  { url: 'https://www.itfind.or.kr/', title: 'ITFIND', description: 'ICT 정책·기술 동향 보고서를 무료로 받아 보는 곳', category: '투자·창업 지원 > 창업지원 기관' },

  // ───────────────────────────── 투자·창업 지원 > 특허·인증
  { url: 'https://www.kipris.or.kr/', title: 'KIPRIS', description: '특허·상표·디자인을 무료로 검색하는 특허청 공식 서비스', category: '투자·창업 지원 > 특허·인증' },
  { url: 'https://markinfo.kr/', title: '마크인포', description: '상표를 온라인으로 조회하고 출원까지 맡기는 서비스', category: '투자·창업 지원 > 특허·인증' },
  { url: 'https://www.rnd.or.kr/user/main.do', title: '기업부설연구소 신고', description: '기업부설연구소·연구전담부서를 신고하고 관리하는 창구', category: '투자·창업 지원 > 특허·인증' },
  { url: 'https://kpeg.kipro.or.kr/', title: '한미 무료 특허검색', description: '한국과 미국 특허를 한 화면에서 찾아보는 무료 서비스', category: '투자·창업 지원 > 특허·인증' },
  { url: 'https://www.smes.go.kr/venturein/home/viewHome', title: '벤처확인시스템', description: '벤처기업 확인을 신청하고 유효기간을 관리하는 곳', category: '투자·창업 지원 > 특허·인증' },
  { url: 'https://www.ipacademy.net/main.do', title: '국가지식재산교육포털', description: '특허·상표 실무를 무료 온라인 과정으로 배우는 곳', category: '투자·창업 지원 > 특허·인증' },

  // ───────────────────────────── 투자·창업 지원 > 고용·노무
  { url: 'https://total.comwel.or.kr/', title: '고용·산재보험 토탈서비스', description: '근로복지공단의 4대보험 신고·조회를 처리하는 창구', category: '투자·창업 지원 > 고용·노무' },
  { url: 'http://insurancesupport.or.kr/', title: '두루누리', description: '소규모 사업장의 사회보험료를 지원받는 신청 창구', category: '투자·창업 지원 > 고용·노무' },
  { url: 'https://www.sbcplan.or.kr/', title: '내일채움공제', description: '중소기업 재직자의 목돈 마련을 돕는 공제 가입 창구', category: '투자·창업 지원 > 고용·노무' },

  // ───────────────────────────── 금융·투자 정보 > 주식·시장
  { url: 'http://www.paxnet.co.kr/', title: '팍스넷', description: '종목 토론과 시세를 함께 보는 국내 오래된 증권 커뮤니티', category: '금융·투자 정보 > 주식·시장' },
  { url: 'https://kr.tradingview.com/', title: 'TradingView', description: '전 세계 시세를 한 차트에서 보는 트레이딩 분석 도구', category: '금융·투자 정보 > 주식·시장' },
  { url: 'http://www.38.co.kr/', title: '38커뮤니케이션', description: '공모주 청약 일정과 장외주식 시세를 보는 곳', category: '금융·투자 정보 > 주식·시장' },
  { url: 'https://m.irgo.co.kr/', title: 'IRGO', description: '기업 IR 자료와 공모주 일정을 모아 주는 투자정보 앱', category: '금융·투자 정보 > 주식·시장' },
  { url: 'https://dramexchange.com/', title: 'DRAMeXchange', description: 'D램·낸드 현물가를 공개하는 반도체 시황 사이트', category: '금융·투자 정보 > 주식·시장' },

  // ───────────────────────────── 금융·투자 정보 > 부동산
  { url: 'https://www.applyhome.co.kr/', title: '청약홈', description: '아파트 청약을 신청하고 당첨자를 확인하는 공식 창구', category: '금융·투자 정보 > 부동산' },
  { url: 'https://apply.lh.or.kr/', title: 'LH 청약플러스', description: 'LH 임대·분양 공고를 확인하고 신청하는 창구', category: '금융·투자 정보 > 부동산' },
  { url: 'https://jeonse.lh.or.kr/', title: 'LH 전세임대포털', description: '전세임대 지원 대상과 절차를 확인하고 신청하는 곳', category: '금융·투자 정보 > 부동산' },
  { url: 'https://nhuf.molit.go.kr/', title: '주택도시기금', description: '버팀목·디딤돌 등 정부 주택 대출 조건을 확인하는 곳', category: '금융·투자 정보 > 부동산' },
  { url: 'https://enhuf.molit.go.kr/', title: '기금e든든', description: '주택도시기금 대출을 온라인으로 신청하는 창구', category: '금융·투자 정보 > 부동산' },
  { url: 'https://www.myhome.go.kr/', title: '마이홈포털', description: '내가 받을 수 있는 주거복지 지원을 찾아보는 정부 포털', category: '금융·투자 정보 > 부동산' },
  { url: 'https://housing.seoul.go.kr/', title: '서울주거포털', description: '서울시 임대주택과 주거 지원 정보를 모아 둔 곳', category: '금융·투자 정보 > 부동산' },
  { url: 'https://www.bunyangi.com/', title: '분양알리미', description: '신규 분양 일정과 단지 정보를 정리해 주는 민간 서비스', category: '금융·투자 정보 > 부동산' },
  { url: 'http://rt.molit.go.kr/', title: '실거래가 공개시스템', description: '아파트·주택 실제 거래 가격을 확인하는 국토부 시스템', category: '금융·투자 정보 > 부동산' },
  { url: 'https://www.realtyprice.kr:447/', title: '부동산공시가격 알리미', description: '공시지가와 주택 공시가격을 조회하는 공식 창구', category: '금융·투자 정보 > 부동산' },
  { url: 'https://kbland.kr', title: 'KB부동산', description: 'KB 시세와 실거래가·분양 정보를 함께 보는 서비스', category: '금융·투자 정보 > 부동산' },
  { url: 'https://www.reb.or.kr', title: '한국부동산원', description: '부동산 통계와 가격 동향을 발표하는 공공기관', category: '금융·투자 정보 > 부동산' },
  { url: 'https://www.courtauction.go.kr/', title: '법원경매정보', description: '전국 경매 물건과 일정을 조회하는 대법원 공식 시스템', category: '금융·투자 정보 > 부동산' },
  { url: 'https://seereal.lh.or.kr/', title: '씨:리얼(SEE:REAL)', description: 'LH가 여는 부동산 정보·통계 종합 포털', category: '금융·투자 정보 > 부동산' },
  { url: 'http://www.eum.go.kr/', title: '토지이음', description: '토지이용계획과 규제를 지번으로 확인하는 공식 서비스', category: '금융·투자 정보 > 부동산' },
  { url: 'https://kras.go.kr', title: '일사편리', description: '부동산 종합증명서를 한 번에 떼는 통합 민원 서비스', category: '금융·투자 정보 > 부동산' },
  { url: 'https://stat.molit.go.kr/', title: '국토교통 통계누리', description: '주택·교통·건설 통계를 원자료까지 받아 보는 곳', category: '금융·투자 정보 > 부동산' },
  { url: 'http://www.krihs.re.kr/', title: '국토연구원', description: '국토·주택 정책을 연구해 보고서로 내는 국책 연구기관', category: '금융·투자 정보 > 부동산' },
  { url: 'https://yeyak.seoul.go.kr/', title: '서울시 공공서비스예약', description: '서울시 시설·강좌·체험을 온라인으로 예약하는 창구', category: '금융·투자 정보 > 부동산' },

  // ───────────────────────────── 금융·투자 정보 > 국가통계
  { url: 'http://kosis.kr/', title: 'KOSIS 국가통계포털', description: '국내 모든 공식 통계를 찾아 표로 받아 보는 곳', category: '금융·투자 정보 > 국가통계' },
  { url: 'http://kostat.go.kr/', title: '국가데이터처', description: '옛 통계청. 인구·물가 등 국가 통계를 만들어 공표한다', category: '금융·투자 정보 > 국가통계' },
  { url: 'http://www.index.go.kr/', title: '지표누리', description: '정책 지표를 그래프로 한눈에 보여 주는 정부 사이트', category: '금융·투자 정보 > 국가통계' },
  { url: 'http://dart.fss.or.kr/', title: 'DART 전자공시', description: '상장·비상장 기업의 사업보고서와 공시를 보는 공식 창구', category: '금융·투자 정보 > 국가통계' },
  { url: 'http://ecos.bok.or.kr/', title: 'ECOS 경제통계시스템', description: '금리·환율·국민계정을 한국은행이 직접 공개하는 DB', category: '금융·투자 정보 > 국가통계' },
  { url: 'http://www.fss.or.kr/', title: '금융감독원', description: '금융회사 감독과 소비자 보호를 맡는 기관의 공식 홈', category: '금융·투자 정보 > 국가통계' },
  { url: 'http://fisis.fss.or.kr/', title: '금융통계정보시스템', description: '은행·보험·증권사의 재무 지표를 비교해 보는 곳', category: '금융·투자 정보 > 국가통계' },
  { url: 'http://finlife.fss.or.kr/', title: '금융상품한눈에', description: '예금·대출·보험 조건을 회사별로 견주는 공식 비교 공시', category: '금융·투자 정보 > 국가통계' },
  { url: 'http://laborstat.moel.go.kr/', title: '고용노동통계', description: '임금·근로시간·고용 통계를 고용노동부가 공개하는 곳', category: '금융·투자 정보 > 국가통계' },
  { url: 'http://freesis.kofia.or.kr/', title: '금융투자협회 통계', description: '펀드·채권·증권사 통계를 모아 공개하는 협회 포털', category: '금융·투자 정보 > 국가통계' },
  { url: 'http://www.kipf.re.kr/', title: '한국조세재정연구원', description: '세제와 재정 정책을 연구해 보고서로 내는 국책 기관', category: '금융·투자 정보 > 국가통계' },

  // ───────────────────────────── 금융·투자 정보 > 기업정보·신용
  { url: 'https://www.rm1.co.kr/', title: 'NICE BizLINE', description: '거래처 신용도와 재무를 조회하는 나이스 기업정보 서비스', category: '금융·투자 정보 > 기업정보·신용' },
  { url: 'https://www.kisreport.com/', title: '나이스비즈인포', description: '기업 신용분석보고서를 발급받는 유료 조회 서비스', category: '금융·투자 정보 > 기업정보·신용' },
  { url: 'http://www.cretop.com/', title: 'CRETOP', description: '한국기업데이터가 제공하는 기업 신용·재무 조회 서비스', category: '금융·투자 정보 > 기업정보·신용' },
  { url: 'https://www.kreport.co.kr/', title: '코리포트', description: '중소기업 재무와 신용을 간편히 조회하는 리포트 서비스', category: '금융·투자 정보 > 기업정보·신용' },
  { url: 'https://www.kisrating.com/', title: '한국신용평가', description: '회사채·기업 신용등급을 공시하는 3대 신용평가사', category: '금융·투자 정보 > 기업정보·신용' },
  { url: 'http://www.korearatings.com/', title: '한국기업평가', description: '기업·금융사의 신용등급과 평가 리포트를 내는 곳', category: '금융·투자 정보 > 기업정보·신용' },
  { url: 'https://www.catch.co.kr/', title: '캐치', description: '기업 분석과 채용 정보를 함께 보는 취업·기업 플랫폼', category: '금융·투자 정보 > 기업정보·신용' },
  { url: 'https://kind.krx.co.kr/', title: 'KIND 기업공시채널', description: '거래소가 운영하는 상장기업 공시 열람 채널', category: '금융·투자 정보 > 기업정보·신용' },
  { url: 'http://consensus.hankyung.com/', title: '한경 컨센서스', description: '증권사 리서치 리포트를 무료로 모아 보는 곳', category: '금융·투자 정보 > 기업정보·신용' },
  { url: 'https://istans.or.kr/', title: 'ISTANS 산업통계', description: '업종별 생산·수출 통계를 그래프로 분석하는 시스템', category: '금융·투자 정보 > 기업정보·신용' },

  // ───────────────────────────── 금융·투자 정보 > 경제연구기관
  { url: 'https://www.bok.or.kr/', title: '한국은행', description: '기준금리와 경제전망을 내놓는 중앙은행. 보고서가 많다', category: '금융·투자 정보 > 경제연구기관' },
  { url: 'http://www.kdi.re.kr/', title: 'KDI 한국개발연구원', description: '거시경제와 정책을 분석하는 대표 국책 연구기관', category: '금융·투자 정보 > 경제연구기관' },
  { url: 'https://www.kcif.or.kr/', title: '국제금융센터', description: '해외 금융시장 동향을 매일 정리해 주는 기관', category: '금융·투자 정보 > 경제연구기관' },
  { url: 'http://www.kif.re.kr/', title: '한국금융연구원', description: '금융 산업과 제도를 연구해 보고서로 내는 기관', category: '금융·투자 정보 > 경제연구기관' },
  { url: 'http://www.keri.org/', title: '한국경제연구원', description: '기업 관점의 경제 정책을 연구하는 민간 연구기관', category: '금융·투자 정보 > 경제연구기관' },
  { url: 'https://www.kbfg.com/kbresearch/main.do', title: 'KB경영연구소', description: '부동산·자영업 등 실물 주제 리포트가 두터운 연구소', category: '금융·투자 정보 > 경제연구기관' },
  { url: 'http://www.lgeri.com/', title: 'LG경영연구원', description: '산업·경영 트렌드를 짧은 리포트로 내는 민간 연구소', category: '금융·투자 정보 > 경제연구기관' },
  { url: 'http://research.ibk.co.kr/research', title: 'IBK경제연구소', description: '중소기업 경기와 업종 동향을 다루는 기업은행 연구소', category: '금융·투자 정보 > 경제연구기관' },
  { url: 'http://www.hanaif.re.kr/', title: '하나금융연구소', description: '금융·부동산 이슈를 정리한 리포트를 내는 연구소', category: '금융·투자 정보 > 경제연구기관' },
  { url: 'https://securities.miraeasset.com/', title: '미래에셋증권', description: '리서치 리포트와 시황을 받아 보는 증권사 홈', category: '금융·투자 정보 > 경제연구기관' },

  // ───────────────────────────── 뉴스·인사이트 > AI 뉴스
  { url: 'https://aitrends.kr/', title: 'AI Trends', description: '그날의 글로벌 AI 소식을 한국어로 추려 주는 뉴스 피드', category: '뉴스·인사이트 > AI 뉴스' },
  { url: 'https://news.hada.io/', title: 'GeekNews', description: '개발·기술·스타트업 소식을 한국어로 모아 주는 커뮤니티', category: '뉴스·인사이트 > AI 뉴스' },
  { url: 'https://www.aitimes.com/', title: 'AI타임스', description: '국내 AI 산업 소식을 다루는 전문 매체', category: '뉴스·인사이트 > AI 뉴스' },
  { url: 'https://www.aitimes.kr/', title: '인공지능신문', description: '국내외 AI 기술과 정책을 다루는 전문 매체', category: '뉴스·인사이트 > AI 뉴스' },
  { url: 'https://aimatters.co.kr/', title: 'AI매터스', description: '실무에서 쓰는 AI 활용 사례를 다루는 국내 매체', category: '뉴스·인사이트 > AI 뉴스' },
  { url: 'https://news.aikoreacommunity.com/', title: 'AI 코리아 커뮤니티', description: '생성형 AI 소식을 쉽게 풀어 주는 한국어 뉴스레터', category: '뉴스·인사이트 > AI 뉴스' },
  { url: 'https://www.gpters.org/newsletter', title: '지피터스 뉴스레터', description: 'GPT 실무 활용 노하우를 나누는 국내 커뮤니티 소식지', category: '뉴스·인사이트 > AI 뉴스' },
  { url: 'https://blog.secondbrush.co.kr/', title: 'Daily Prompt', description: 'AI 활용과 프롬프트 인사이트를 매일 내는 한국어 블로그', category: '뉴스·인사이트 > AI 뉴스' },
  { url: 'https://maily.so/', title: '메일리', description: '국내 뉴스레터를 발행하고 구독하는 플랫폼', category: '뉴스·인사이트 > AI 뉴스' },
  { url: 'https://yozm.wishket.com/magazine/', title: '요즘IT', description: '개발·기획·디자인 실무 칼럼을 싣는 국내 IT 매거진', category: '뉴스·인사이트 > AI 뉴스' },
  { url: 'https://www.anthropic.com/news', title: 'Anthropic Newsroom', description: 'Claude를 만드는 Anthropic의 공식 발표와 연구 소식', category: '뉴스·인사이트 > AI 뉴스' },
  { url: 'https://developers.openai.com/blog/', title: 'OpenAI Developers Blog', description: 'OpenAI가 개발자용 API·모델 변경을 알리는 공식 블로그', category: '뉴스·인사이트 > AI 뉴스' },
  { url: 'https://blog.google/technology/ai/', title: 'Google AI Blog', description: '구글의 AI 제품과 모델 발표를 모아 둔 공식 블로그', category: '뉴스·인사이트 > AI 뉴스' },
  { url: 'https://research.google/blog/', title: 'Google Research Blog', description: '구글 연구팀이 논문과 함께 성과를 푸는 공식 블로그', category: '뉴스·인사이트 > AI 뉴스' },

  // ───────────────────────────── 뉴스·인사이트 > 스타트업 뉴스
  { url: 'http://platum.kr/', title: '플래텀', description: '국내 스타트업 투자와 창업 소식을 다루는 대표 매체', category: '뉴스·인사이트 > 스타트업 뉴스' },
  { url: 'http://www.venturesquare.net/news', title: '벤처스퀘어', description: '스타트업 투자·행사 소식을 오래 다뤄 온 국내 매체', category: '뉴스·인사이트 > 스타트업 뉴스' },
  { url: 'https://besuccess.com/', title: 'beSUCCESS', description: '한국 스타트업 소식을 영문으로도 내보내는 매체', category: '뉴스·인사이트 > 스타트업 뉴스' },
  { url: 'https://outstanding.kr/', title: '아웃스탠딩', description: '업계 뒷이야기까지 짚어 주는 유료 IT 뉴스 매체', category: '뉴스·인사이트 > 스타트업 뉴스' },
  { url: 'https://www.mobiinside.co.kr/', title: '모비인사이드', description: '모바일·마케팅 실무 관점의 기고를 싣는 매체', category: '뉴스·인사이트 > 스타트업 뉴스' },
  { url: 'https://eopla.net/magazines', title: 'EO planet', description: '창업자 인터뷰와 경험담을 싣는 EO의 콘텐츠 플랫폼', category: '뉴스·인사이트 > 스타트업 뉴스' },
  { url: 'https://knowhow.ceo/', title: 'KNOWHOW', description: '창업자들이 실무 노하우를 나누는 국내 커뮤니티', category: '뉴스·인사이트 > 스타트업 뉴스' },
  { url: 'https://thevc.kr/', title: 'THE VC', description: '한국 스타트업의 투자 이력을 정리한 무료 데이터베이스', category: '뉴스·인사이트 > 스타트업 뉴스' },
  { url: 'https://www.innoforest.co.kr/', title: '혁신의숲', description: '스타트업의 매출·고용·투자 지표를 공개하는 분석 플랫폼', category: '뉴스·인사이트 > 스타트업 뉴스' },
  { url: 'https://www.nextunicorn.kr/', title: '넥스트유니콘', description: '스타트업과 전문 투자자를 잇는 국내 매칭 플랫폼', category: '뉴스·인사이트 > 스타트업 뉴스' },
  { url: 'https://startuprecipe.co.kr/', title: '스타트업레시피', description: '주간 투자 리포트를 뉴스레터로 보내 주는 매체', category: '뉴스·인사이트 > 스타트업 뉴스' },
  { url: 'http://www.demoday.co.kr/', title: '데모데이', description: '창업 지원사업·행사 정보를 모아 알려 주는 플랫폼', category: '뉴스·인사이트 > 스타트업 뉴스' },
  { url: 'http://startupall.kr/', title: '스타트업얼라이언스', description: '생태계 조사와 네트워킹 행사를 여는 민관 협력 단체', category: '뉴스·인사이트 > 스타트업 뉴스' },
  { url: 'http://www.wadiz.kr/', title: '와디즈', description: '제품을 미리 팔아 검증하는 국내 대표 크라우드펀딩', category: '뉴스·인사이트 > 스타트업 뉴스' },
  { url: 'https://disquiet.io/', title: 'Disquiet', description: '메이커들이 만든 제품을 올리고 피드백받는 국내 커뮤니티', category: '뉴스·인사이트 > 스타트업 뉴스' },
  { url: 'https://www.thinkwithgoogle.com/intl/ko-kr/', title: 'Think with Google', description: '구글이 내는 마케팅 리서치와 소비자 트렌드 자료', category: '뉴스·인사이트 > 스타트업 뉴스' },

  // ───────────────────────────── 뉴스·인사이트 > 프로덕트 레퍼런스
  { url: 'https://www.producthunt.com/', title: 'Product Hunt', description: '매일 새 제품이 올라오는 세계 최대 프로덕트 발견 플랫폼', category: '뉴스·인사이트 > 프로덕트 레퍼런스' },
  { url: 'https://www.indiehackers.com/products', title: 'Indie Hackers', description: '1인 창업자들이 매출과 성장 과정을 공개하는 커뮤니티', category: '뉴스·인사이트 > 프로덕트 레퍼런스' },
  { url: 'https://leanaileaderboard.com/', title: 'Lean AI Leaderboard', description: '적은 인원으로 높은 매출을 내는 AI 스타트업 순위표', category: '뉴스·인사이트 > 프로덕트 레퍼런스' },
  { url: 'https://techcrunch.com/', title: 'TechCrunch', description: '해외 스타트업 투자와 제품 출시를 다루는 대표 매체', category: '뉴스·인사이트 > 프로덕트 레퍼런스' },
  { url: 'https://www.kickstarter.com/', title: 'Kickstarter', description: '해외 신제품이 먼저 공개되는 크라우드펀딩 플랫폼', category: '뉴스·인사이트 > 프로덕트 레퍼런스' },
  { url: 'https://apick.app/', title: '에이픽', description: '국내 앱·웹 서비스를 순위와 함께 모아 주는 발견 플랫폼', category: '뉴스·인사이트 > 프로덕트 레퍼런스' },
  { url: 'https://paperclip.ing/', title: 'Paperclip', description: '업무용 AI 에이전트를 모아 관리하는 서비스', category: '뉴스·인사이트 > 프로덕트 레퍼런스' },
  { url: 'https://startupstash.com/', title: 'Startup Stash', description: '창업 단계별로 쓸 도구를 정리해 둔 해외 디렉터리', category: '뉴스·인사이트 > 프로덕트 레퍼런스' },
  { url: 'https://codestory.co/', title: 'Code Story', description: '기술 창업자의 제품 개발 뒷이야기를 듣는 팟캐스트', category: '뉴스·인사이트 > 프로덕트 레퍼런스' },
  { url: 'https://www.surfit.io/', title: '서핏', description: '직무별 커리어·실무 아티클을 큐레이션해 주는 플랫폼', category: '뉴스·인사이트 > 프로덕트 레퍼런스' },
  { url: 'https://tilnote.io/', title: 'TILNOTE', description: '배운 것을 기록하고 블로그로 펴는 AI 지식 노트', category: '뉴스·인사이트 > 프로덕트 레퍼런스' },
  { url: 'https://www.stdy.blog/', title: 'Steady Study', description: '비개발자를 위한 바이브코딩 입문 글이 있는 블로그', category: '뉴스·인사이트 > 프로덕트 레퍼런스' },

  // ───────────────────────────── 디자인 레퍼런스 > UI·웹 갤러리 (신규분만)
  { url: 'https://dribbble.com/', title: 'Dribbble', description: '디자이너들이 작업 시안을 올려 공유하는 대표 커뮤니티', category: '디자인 레퍼런스 > UI·웹 갤러리' },

  // ───────────────────────────── 디자인 레퍼런스 > 웹디자인 참고
  { url: 'http://rwdb.kr/', title: 'RWDB', description: '국내 반응형 웹사이트를 모아 둔 디자인 참고 자료실', category: '디자인 레퍼런스 > 웹디자인 참고' },
  { url: 'https://www.dbcut.com/', title: 'DBCut', description: '국내 웹사이트를 심사해 소개하는 오래된 디자인 보드', category: '디자인 레퍼런스 > 웹디자인 참고' },
  { url: 'https://www.gdweb.co.kr/', title: 'GDWEB', description: '우수 웹사이트를 선정해 소개하는 국내 어워드', category: '디자인 레퍼런스 > 웹디자인 참고' },
  { url: 'http://dbdic.co.kr/', title: 'dbdic', description: '업종별 웹디자인을 찾아보는 국내 벤치마킹 사전', category: '디자인 레퍼런스 > 웹디자인 참고' },
  { url: 'https://wordpress.org/showcase/', title: 'WordPress Showcase', description: '워드프레스로 만든 잘된 사이트를 모아 둔 공식 사례집', category: '디자인 레퍼런스 > 웹디자인 참고' },
  { url: 'https://www.designsystems.com/open-design-systems/', title: 'Open Design Systems', description: '공개된 디자인 시스템을 모아 비교해 보는 목록', category: '디자인 레퍼런스 > 웹디자인 참고' },
  { url: 'https://material.io/', title: 'Material Design', description: '구글이 공개한 디자인 가이드라인과 컴포넌트 규격', category: '디자인 레퍼런스 > 웹디자인 참고' },
  { url: 'http://www.lovelyui.com/', title: 'Lovely UI', description: '앱 화면을 요소별로 모아 둔 UI 참고 자료실', category: '디자인 레퍼런스 > 웹디자인 참고' },
  { url: 'http://ava7patterns.com/', title: 'ava7 patterns', description: '무료 반복 배경 패턴 이미지 1900여 종을 받는 곳', category: '디자인 레퍼런스 > 웹디자인 참고' },

  // ───────────────────────────── 디자인 레퍼런스 > 폰트
  { url: 'https://noonnu.cc/', title: '눈누', description: '상업적으로 쓸 수 있는 무료 한글 폰트를 모아 둔 곳', category: '디자인 레퍼런스 > 폰트' },
  { url: 'https://fonts.google.com/', title: 'Google Fonts', description: '웹에 바로 붙여 쓰는 무료 폰트 라이브러리', category: '디자인 레퍼런스 > 폰트' },
  { url: 'http://www.dafont.com/', title: 'DaFont', description: '개성 있는 영문 무료 폰트를 종류별로 받는 곳', category: '디자인 레퍼런스 > 폰트' },
  { url: 'https://kfonts.kr/', title: 'AI 한글폰트 검색', description: '이미지 속 한글 폰트가 무엇인지 찾아 주는 검색 서비스', category: '디자인 레퍼런스 > 폰트' },
  { url: 'https://befonts.com/', title: 'Befonts', description: '디자이너용 무료 영문 폰트를 골라 받는 사이트', category: '디자인 레퍼런스 > 폰트' },
  { url: 'https://fontello.com/', title: 'Fontello', description: '필요한 아이콘만 골라 아이콘 폰트로 묶어 주는 도구', category: '디자인 레퍼런스 > 폰트' },

  // ───────────────────────────── 디자인 레퍼런스 > 색상
  { url: 'https://coolors.co/', title: 'Coolors', description: '스페이스바만 누르면 배색이 바뀌는 팔레트 생성기', category: '디자인 레퍼런스 > 색상' },
  { url: 'https://color.adobe.com/', title: 'Adobe Color', description: '색상환으로 배색을 만들고 남의 팔레트를 찾아보는 도구', category: '디자인 레퍼런스 > 색상' },
  { url: 'https://www.design-seeds.com/', title: 'Design Seeds', description: '사진에서 뽑은 배색을 매일 올려 주는 팔레트 블로그', category: '디자인 레퍼런스 > 색상' },
  { url: 'https://swatchy.twosix.studio/', title: 'Swatchy', description: '색을 골라 다듬고 바로 복사하는 가벼운 색상 편집기', category: '디자인 레퍼런스 > 색상' },

  // ───────────────────────────── 디자인 레퍼런스 > 아이콘
  { url: 'https://heroicons.com/', title: 'Heroicons', description: 'Tailwind 팀이 만든 깔끔한 무료 SVG 아이콘 세트', category: '디자인 레퍼런스 > 아이콘' },
  { url: 'https://feathericons.com/', title: 'Feather', description: '선이 얇고 단정한 오픈소스 아이콘 모음', category: '디자인 레퍼런스 > 아이콘' },
  { url: 'https://fontawesome.com/', title: 'Font Awesome', description: '가장 널리 쓰이는 아이콘 라이브러리. 무료판이 넉넉하다', category: '디자인 레퍼런스 > 아이콘' },
  { url: 'https://fonts.google.com/icons', title: 'Material Symbols', description: '구글이 내놓은 무료 아이콘 세트. 굵기를 조절할 수 있다', category: '디자인 레퍼런스 > 아이콘' },
  { url: 'https://iconmonstr.com/', title: 'iconmonstr', description: '단순한 흑백 아이콘을 무료로 받는 곳', category: '디자인 레퍼런스 > 아이콘' },

  // ───────────────────────────── 디자인 레퍼런스 > 무료 이미지·영상
  { url: 'https://kr.freepik.com/', title: 'Magnific (구 Freepik)', description: '벡터·사진·목업을 받는 곳. 지금은 AI 생성까지 붙었다', category: '디자인 레퍼런스 > 무료 이미지·영상' },
  { url: 'https://photo-ac.com/ko/', title: '포토에이씨', description: '일본계 무료 사진 사이트. 아시아권 인물 사진이 많다', category: '디자인 레퍼런스 > 무료 이미지·영상' },
  { url: 'https://picography.co/', title: 'Picography', description: '고해상도 무료 사진을 조건 없이 받는 사이트', category: '디자인 레퍼런스 > 무료 이미지·영상' },
  { url: 'https://www.foodiesfeed.com/', title: 'Foodiesfeed', description: '음식 사진만 모아 둔 무료 스톡 사이트', category: '디자인 레퍼런스 > 무료 이미지·영상' },
  { url: 'https://stockup.sitebuilderreport.com/', title: 'Stock Up', description: '여러 무료 사진 사이트를 한 번에 검색해 주는 곳', category: '디자인 레퍼런스 > 무료 이미지·영상' },
  { url: 'https://www.videezy.com/', title: 'Videezy', description: '무료로 쓸 수 있는 배경 영상 클립을 받는 곳', category: '디자인 레퍼런스 > 무료 이미지·영상' },
  { url: 'https://giphy.com/', title: 'GIPHY', description: 'GIF를 찾고 만들어 붙여 넣는 세계 최대 GIF 저장소', category: '디자인 레퍼런스 > 무료 이미지·영상' },
  { url: 'https://www.emojiengine.com/', title: 'Emoji Engine', description: '이모지를 검색해 복사하고 조합해 보는 도구', category: '디자인 레퍼런스 > 무료 이미지·영상' },
  { url: 'https://dummyimage.com/', title: 'DummyImage', description: '원하는 크기의 임시 이미지를 주소만으로 만들어 준다', category: '디자인 레퍼런스 > 무료 이미지·영상' },
  { url: 'https://placeholder.com/', title: 'Placeholder.com', description: '시안용 자리표시 이미지를 주소로 불러오는 서비스', category: '디자인 레퍼런스 > 무료 이미지·영상' },
  { url: 'https://diybookcovers.com/3Dmockups/', title: '3D 책표지 목업', description: '표지 이미지를 입체 책 목업으로 바꿔 주는 무료 도구', category: '디자인 레퍼런스 > 무료 이미지·영상' },

  // ───────────────────────────── AI 도구 모음 (기존 하위에 추가)
  { url: 'https://alphacut.video/', title: 'Alphacut', description: '긴 영상에서 하이라이트를 골라 쇼츠로 만들어 주는 국내 도구', category: 'AI 도구 모음 > 영상 편집·자막' },
  { url: 'https://www.chatprd.ai/', title: 'ChatPRD', description: 'PM 대신 제품 요구사항 문서를 써 주는 AI 도구', category: 'AI 도구 모음 > 문서·자동화' },
  { url: 'https://www.inline-ai.com/', title: 'inline AI', description: '컴퓨터가 알아서 반복 업무를 처리하게 하는 국내 자동화 AI', category: 'AI 도구 모음 > 문서·자동화' },
  { url: 'https://www.pulsewave.kr/', title: '퍼스(Pulse)', description: '산업안전보건 서류와 점검을 자동화하는 국내 AI 플랫폼', category: 'AI 도구 모음 > 문서·자동화' },
  { url: 'https://tobl.ai/', title: 'TOBL.ai', description: 'AI 개발과 프로젝트를 맡아 주는 국내 컨설팅 서비스', category: 'AI 도구 모음 > 코딩·에이전트' },
  { url: 'https://www.genstore.ai/', title: 'Genstore', description: '몇 분 만에 AI 쇼핑몰을 세워 주는 커머스 빌더', category: 'AI 도구 모음 > 코딩·에이전트' },

  // ───────────────────────────── 마케팅
  { url: 'https://gency.ai/', title: 'GENCY', description: '상품 정보만 넣으면 상세페이지를 자동으로 만들어 준다', category: '마케팅 > 상세페이지·콘텐츠' },
  { url: 'https://kleo.so/', title: 'Kleo', description: '링크드인 개인 브랜딩 글을 돕는 AI 도구', category: '마케팅 > 리서치·트렌드' },
  { url: 'https://www.jasper.ai/', title: 'Jasper', description: '브랜드 톤을 학습해 마케팅 카피를 쓰는 AI 플랫폼', category: '마케팅 > 리서치·트렌드' },

  // ───────────────────────────── 웹사이트 진단
  { url: 'https://serpivore.com/', title: 'Serpivore', description: '페이지가 많은 사이트의 검색 순위를 추적하는 도구', category: '웹사이트 진단 > 기술스택·SEO' },

  // ───────────────────────────── 업무 워크스페이스
  { url: 'https://docshunt.ai/', title: '독스헌트', description: '아이디어만 넣으면 지원사업 사업계획서를 써 주는 AI', category: '업무 워크스페이스 > 사업·지원사업' },
  { url: 'https://zuzu.network/', title: 'ZUZU', description: '주주명부·투자 관리까지 다루는 스타트업 백오피스', category: '업무 워크스페이스 > 사업·지원사업' },
  { url: 'https://itconnect.daouoffice.com/', title: '다우오피스', description: '사내 메일·전자결재·근태를 다루는 그룹웨어', category: '업무 워크스페이스 > 협업·사내 도구' },
  { url: 'https://play.google.com/console/', title: 'Google Play Console', description: '안드로이드 앱을 올리고 심사·통계를 보는 개발자 콘솔', category: '업무 워크스페이스 > 협업·사내 도구' },
  { url: 'https://www.payple.kr/', title: '페이플', description: '국내 결제와 정산을 붙이는 PG 서비스', category: '업무 워크스페이스 > 결제·정산' },
  { url: 'https://www.paypal.com/kr/', title: 'PayPal', description: '해외 고객에게 받고 보내는 국제 결제 수단', category: '업무 워크스페이스 > 결제·정산' },
  { url: 'https://www.payoneer.com/ko/', title: 'Payoneer', description: '해외 플랫폼 수익을 국내 계좌로 받는 정산 서비스', category: '업무 워크스페이스 > 결제·정산' },
  { url: 'https://elementor.com/affiliates/', title: 'Elementor 제휴', description: '엘리멘터 추천 수익을 확인하는 제휴 프로그램', category: '업무 워크스페이스 > 제휴 마케팅' },
  { url: 'https://affiliate.fastcomet.com/', title: 'FastComet 제휴', description: '패스트코멧 호스팅 추천 수익을 정산하는 화면', category: '업무 워크스페이스 > 제휴 마케팅' },
  { url: 'https://generatepress.com/affiliates/', title: 'GeneratePress 제휴', description: '제너레이트프레스 테마 추천 수익 정산 화면', category: '업무 워크스페이스 > 제휴 마케팅' },
  { url: 'https://wptravelengine.com/affiliate-area/', title: 'WP Travel Engine 제휴', description: '여행 예약 플러그인 추천 수익을 확인하는 화면', category: '업무 워크스페이스 > 제휴 마케팅' },

  // ───────────────────────────── 강의·교육
  { url: 'https://event-us.kr/', title: '이벤터스', description: '세미나·강의 참가 신청을 받고 관리하는 행사 플랫폼', category: '강의·교육 > 교육 자료·운영' },
  { url: 'https://onoffmix.com/', title: '온오프믹스', description: '세미나·네트워킹 모임을 열고 모객하는 플랫폼', category: '강의·교육 > 교육 자료·운영' },
  { url: 'https://www.careerday.jobs/', title: '커리어데이', description: '채용·커리어 행사를 열고 참가자를 모으는 플랫폼', category: '강의·교육 > 교육 자료·운영' },
  { url: 'https://www.diamondforest.kr/', title: '다이아몬드 포레스트', description: '기업 워크숍과 연수를 여는 국내 숙박형 시설', category: '강의·교육 > 워크숍·연수 장소' },
  { url: 'http://www.sandulsori.co.kr/', title: '산들소리', description: '단체 연수와 워크숍을 받는 국내 수련 시설', category: '강의·교육 > 워크숍·연수 장소' },
  { url: 'https://godowoncenter.com/', title: '깊은산속 옹달샘', description: '고도원의 아침이 운영하는 명상·연수 센터', category: '강의·교육 > 워크숍·연수 장소' },
  { url: 'https://sayuwon.com/', title: '사유원', description: '건축과 수목이 어우러진 사색 정원. 소규모 연수에 쓴다', category: '강의·교육 > 워크숍·연수 장소' },
];
