/**
 * 링크의 **제목·설명·분류 교정표** — `scripts/enrich.ts` 가 이 표를 라이브 DB 에 적용한다.
 *
 * 2026-08-10 사용자 요청으로 만들었다. 고치는 것이 셋이다.
 *
 * 1. **제목** — 서비스의 공식 이름으로. 예전 값에는 로그인 페이지 제목(`Sign Up`·`Welcome`),
 *    브라우저 탭에서 잘린 제목(`Stability AI (Image, Video…`), 오타(`vo.dev`·`Leonargo.ai`),
 *    호스트 그대로(`lapa.ninja`), 뜻을 모르면 못 읽는 약어(`GA`·`NSA`·`GAD`)가 섞여 있었다.
 * 2. **설명** — "이 서비스가 무엇인가"를 말하는 **한 문장**으로. 예전 값은 전부 20자 안팎의
 *    꼬리표였다(중앙값 10자 — `AI 대화·문서 초안`).
 * 3. **분류** — 내용과 어긋난 것을 옮긴다. 사용자가 짚은 클로브·그랜터(재무·회계인데
 *    'AI > 문서·자동화'에 있었다)가 그 예다.
 *
 * ## 설명 길이 예산 — **42자**
 *
 * 카드의 설명 칸은 3줄이고 가장 좁은 칸(158px)에서 한 줄에 한글 11자쯤 들어간다
 * (`components/card/geometry.ts`). 그래서 42자를 넘기면 카드에서 잘린다 —
 * `enrich.ts` 가 적용 전에 세어 보고 넘치면 **거부한다.** 늘리려면 카드 기하부터 고쳐라.
 *
 * ## 키는 URL 이다
 *
 * 제목은 지금 고치는 대상이라 키가 될 수 없고(`Jules` 는 둘이다), id 는 읽어도 무엇인지 알 수
 * 없다. URL 은 249건 전수에서 유일하다(확인함). 적용 스크립트는 **정확히 일치**하는 행만
 * 고치고, 못 찾은 키와 표에 없는 링크를 둘 다 보고한다.
 */

export type Enrichment = {
  /** 라이브 DB 의 `url` 과 **정확히** 같아야 한다. */
  url: string;
  /** 공식 서비스명. */
  title: string;
  /** 한 문장 설명 — 42자 이내(위 예산). */
  description: string;
  /**
   * 옮길 분류. `'상위'` 또는 `'상위 > 하위'`. **그대로 두면 생략한다** — 생략된 항목이
   * "지금 자리가 맞다"는 판단이고, 적는 순간 그 판단이 바뀌었다는 뜻이 된다.
   *
   * 없는 분류를 적으면 `enrich.ts` 가 **만든다**(아래 `NEW_CATEGORIES` 에 근거를 적어 둔 것만).
   */
  category?: string;
};

/**
 * 이번에 새로 만드는 하위 분류와 그 근거. `enrich.ts` 는 **이 목록에 있는 이름만** 만든다 —
 * 오타로 적은 분류명이 조용히 새 분류가 되어 링크 한 건짜리 유령 분류를 낳지 않게 하는 빗장이다.
 *
 * 상위는 하나도 새로 만들지 않는다(합의된 확장 규칙: 벤더·유행어로 상위를 만들지 말 것).
 */
export const NEW_CATEGORIES: { path: string; why: string }[] = [
  {
    path: 'AI 도구 모음 > 학습·교육',
    why: "구글의 학습 실험 도구 셋(Learn About·Learn Your Way·Little Language Lessons)이 '검색·리서치'에 있었다. 검색이 아니라 배우는 도구다. 국내 AI 실습 커뮤니티도 여기로 모은다.",
  },
  {
    path: '마케팅 > 상세페이지·콘텐츠',
    why: "상세페이지 제작 도구 넷이 세 분류에 흩어져 있었다(후커블은 '광고 집행', 제디터·키위스냅·페이지메이커는 'AI > 디자인'). 광고를 집행하는 일도 UI 를 설계하는 일도 아닌, 커머스 콘텐츠를 만드는 일이다.",
  },
  {
    path: '업무 워크스페이스 > 협업·사내 도구',
    why: "상위가 직속 4건뿐이었는데 아래에 재무·사업 분류가 생기면서 '직속만 있는 상위'가 사라졌다. 남는 넷(위키·콘솔·모니터링)에 이름을 준다.",
  },
  {
    path: '업무 워크스페이스 > 재무·회계',
    why: '사용자가 짚은 자리다. 클로브·그랜터는 계좌·거래·세금계산서를 다루는 재무회계 서비스인데 AI 라는 이유만으로 AI 도구 모음에 들어가 있었다(벤더·유행어로 분류하지 않는다는 규칙과 같은 종류의 오류).',
  },
  {
    path: '업무 워크스페이스 > 사업·지원사업',
    why: "사업계획서·투자심사·창업 단체가 '마케팅 > 리서치·트렌드'와 '리서치·학술'에 흩어져 있었다. 마케팅 리서치도 학술 자료도 아니다.",
  },
];

export const ENRICHMENTS: Enrichment[] = [
  // ───────────────────────────────── AI 도구 모음 > 대화·챗봇
  {
    url: 'https://chat.openai.com/',
    title: 'ChatGPT',
    description: 'OpenAI의 대화형 AI. 글쓰기·분석·이미지·코드를 한 창에서 다룬다',
  },
  {
    url: 'https://claude.ai/login?returnTo=%2F%3F',
    title: 'Claude',
    description: 'Anthropic의 대화형 AI. 긴 문서 분석과 코드 작업에 특히 강하다',
  },
  {
    url: 'https://gemini.google.com/app',
    title: 'Gemini',
    description: '구글의 대화형 AI. 검색·유튜브·워크스페이스와 그대로 이어진다',
  },
  {
    url: 'https://grok.com/',
    title: 'Grok',
    description: 'xAI의 대화형 AI. X와 웹을 실시간으로 읽어 답한다',
  },
  {
    url: 'https://chat.qwen.ai/',
    title: 'Qwen',
    description: '알리바바의 대화형 AI. 오픈 모델을 무료로 써 볼 수 있다',
  },
  {
    url: 'https://alan.est.ai/',
    title: '앨런',
    description: '이스트소프트의 AI 지식 에이전트. 리서치와 자료 제작을 돕는다',
  },
  {
    url: 'https://www.wrks.ai/',
    title: '웍스',
    description: '기업용 AI 워크스페이스. 사내 자료를 붙여 팀이 함께 쓴다',
  },
  {
    url: 'https://wrtn.ai/',
    title: '뤼튼',
    description: '국내 AI 포털. 최신 모델과 AI 도구를 무료로 모아 쓴다',
  },
  {
    url: 'https://sider.ai/ko',
    title: 'Sider',
    description: '브라우저 사이드바 AI. 보고 있는 페이지를 그 자리에서 요약한다',
  },
  {
    url: 'https://adot.ai/multillm',
    title: '에이닷',
    description: 'SK텔레콤의 AI 비서. 통화 요약·검색·일정을 한 앱에서 다룬다',
  },
  {
    url: 'https://clova-x.naver.com/',
    title: 'CLOVA X',
    description: '네이버의 대화형 AI. 국내 서비스와 쇼핑 정보에 강하다',
  },
  {
    url: 'https://copilot.microsoft.com/',
    title: 'Microsoft Copilot',
    description: 'MS의 대화형 AI. 오피스 문서·엣지 브라우저와 붙어 있다',
  },

  // ───────────────────────────────── AI 도구 모음 > 검색·리서치
  {
    url: 'https://www.perplexity.ai/',
    title: 'Perplexity',
    description: '출처를 붙여 답하는 AI 검색. 근거 링크를 바로 확인한다',
  },
  {
    url: 'https://liner.com/ko',
    title: '라이너',
    description: '출처 기반 AI 검색과 하이라이트. 논문 리서치와 글쓰기를 잇는다',
  },
  {
    url: 'https://notebooklm.google.com/notebook/574b20e0-aa4f-4b1b-ae77-dd206fa4fd80?original_referer=https%3A%2F%2Fnotebooklm.google%23',
    title: 'NotebookLM',
    description: '올린 자료만 읽고 답하는 구글 노트. 팟캐스트로도 만들어 준다',
  },
  {
    url: 'https://felo.ai/ko/search',
    title: 'Felo',
    description: '다국어 AI 검색. 결과를 슬라이드·마인드맵으로 정리해 준다',
  },
  {
    url: 'https://lilys.ai/',
    title: '릴리스AI',
    description: '유튜브·PDF·웹을 요약하는 국내 서비스. 영어 논문도 정리한다',
  },
  {
    url: 'https://beta.goover.ai/home',
    title: 'Goover',
    description: '주제를 던지면 자료를 모아 리포트로 엮어 주는 AI 리서치 도구',
  },
  {
    url: 'https://manus.im/',
    title: 'Manus',
    description: '지시를 받아 스스로 작업을 끝내는 범용 AI 에이전트',
  },
  {
    url: 'https://www.genspark.ai/',
    title: 'Genspark',
    description: '검색과 실행을 함께하는 AI 에이전트. 조사 뒤 문서까지 만든다',
  },
  {
    url: 'https://skywork.ai/',
    title: 'Skywork',
    description: '조사한 내용을 문서·슬라이드·시트로 만들어 주는 AI 에이전트',
    category: 'AI 도구 모음 > 문서·자동화',
  },
  {
    url: 'https://flowith.io/blank',
    title: 'Flowith',
    description: '여러 모델을 한 캔버스에 펼쳐 놓고 쓰는 AI 작업판',
    category: 'AI 도구 모음 > 문서·자동화',
  },
  {
    url: 'https://learnyourway.withgoogle.com/',
    title: 'Learn Your Way',
    description: '교재를 내 수준에 맞게 다시 써 주는 구글 학습 실험 도구',
    category: 'AI 도구 모음 > 학습·교육',
  },
  {
    url: 'https://labs.google/lll/en',
    title: 'Little Language Lessons',
    description: '상황을 정하면 그에 맞는 외국어 표현을 알려 주는 구글 실험',
    category: 'AI 도구 모음 > 학습·교육',
  },
  {
    url: 'https://learning.google.com/experiments/learn-about/signup',
    title: 'Learn About',
    description: '물어보며 한 주제를 파고드는 구글의 대화형 학습 도구',
    category: 'AI 도구 모음 > 학습·교육',
  },
  {
    url: 'https://aitestbed.kr/apply?tab=vibeCoding',
    title: '모두의 AI 실험실',
    description: 'AI 실습과 자동화 프로젝트를 예제로 배우는 국내 학습 공간',
    category: 'AI 도구 모음 > 학습·교육',
  },

  // ───────────────────────────────── AI 도구 모음 > 이미지
  {
    url: 'https://www.recraft.ai/',
    title: 'Recraft',
    description: '벡터·일러스트·목업까지 만드는 디자이너용 이미지 생성 도구',
  },
  {
    url: 'https://www.midjourney.com/home',
    title: 'Midjourney',
    description: '화질과 화풍이 가장 뛰어난 축에 드는 이미지 생성 서비스',
  },
  {
    url: 'https://designer.microsoft.com/',
    title: 'Microsoft Designer',
    description: 'MS의 무료 디자인 도구. SNS 게시물·카드뉴스를 빠르게 만든다',
  },
  {
    url: 'https://ideogram.ai/login',
    title: 'Ideogram',
    description: '그림 속 글자를 정확히 써 주는 생성 도구. 로고·포스터에 좋다',
  },
  {
    url: 'https://www.craiyon.com/',
    title: 'Craiyon',
    description: '가입 없이 바로 써 보는 무료 이미지 생성기. 속도가 강점이다',
  },
  {
    url: 'https://playground.com/design',
    title: 'Playground',
    description: '템플릿으로 이미지를 만들고 다듬는 웹 디자인·편집 도구',
  },
  {
    url: 'https://logodiffusion.com/',
    title: 'Logo Diffusion',
    description: '로고 전용 AI. 스케치나 문장을 벡터 로고로 바꿔 내보낸다',
  },
  {
    url: 'https://leonardo.ai/',
    title: 'Leonardo.Ai',
    description: '이미지와 짧은 영상을 함께 만드는 도구. 게임·아트에 강하다',
  },
  {
    url: 'https://new.express.adobe.com/?locale=ko-KR',
    title: 'Adobe Express',
    description: '어도비의 간편 디자인 도구. 이미지·영상·게시물을 웹에서 만든다',
  },
  {
    url: 'https://stablediffusionweb.com/ko',
    title: 'Stable Diffusion Online',
    description: '설치 없이 웹에서 Stable Diffusion을 돌려 보는 무료 생성기',
  },
  {
    url: 'https://marble.worldlabs.ai/',
    title: 'Marble',
    description: '사진 몇 장을 걸어 다닐 3D 공간으로 바꾸는 World Labs 도구',
  },
  {
    url: 'https://labs.google/gentype',
    title: 'GenType',
    description: '원하는 재료로 알파벳 글꼴을 만들어 주는 구글 실험 도구',
  },
  {
    url: 'https://labs.google.com/mixboard/welcome',
    title: 'Mixboard',
    description: '이미지와 메모를 펼쳐 아이디어를 넓히는 구글의 AI 보드',
  },
  {
    url: 'https://labs.google/fx/ko/tools/whisk',
    title: 'Whisk',
    description: '이미지 여러 장을 섞어 새 이미지를 만드는 구글 실험 도구',
  },
  {
    url: 'https://labs.google/fx/ko/tools/image-fx',
    title: 'ImageFX',
    description: '구글 Imagen으로 이미지를 만드는 실험 도구. 프롬프트를 돕는다',
  },
  {
    url: 'https://flux-ai.io/flux-video-ai/',
    title: 'Flux AI',
    description: 'FLUX 모델을 웹에서 바로 써 보는 이미지·영상 생성 도구',
    category: 'AI 도구 모음 > 이미지',
  },

  // ───────────────────────────────── AI 도구 모음 > 영상 생성
  {
    url: 'https://higgsfield.ai/',
    title: 'Higgsfield',
    description: '카메라 움직임을 골라 영화 같은 장면을 만드는 영상 생성 도구',
  },
  {
    url: 'https://invideo.io/',
    title: 'InVideo AI',
    description: '한 문장으로 대본·자막·음성이 붙은 영상을 만들어 준다',
  },
  {
    url: 'https://sora.com/',
    title: 'Sora',
    description: 'OpenAI의 영상 생성 서비스. 문장이나 사진에서 영상을 만든다',
  },
  {
    url: 'https://klingai.com/',
    title: 'Kling AI',
    description: '인물 움직임이 자연스러운 고품질 영상·이미지 생성 도구',
  },
  {
    url: 'https://lumalabs.ai/dream-machine/creations',
    title: 'Luma Dream Machine',
    description: '사진과 문장으로 짧은 영상을 만드는 Luma AI의 생성 도구',
  },
  {
    url: 'https://runwayml.com/',
    title: 'Runway',
    description: '영상 생성부터 편집까지 하는 스튜디오. 광고·영화에 쓰인다',
  },
  {
    url: 'https://hailuoai.com/video',
    title: '하이루오 AI',
    description: '미니맥스가 만든 영상 생성 도구. 짧은 장면 표현이 뛰어나다',
  },
  {
    url: 'https://www.synthesia.io/',
    title: 'Synthesia',
    description: '대본을 넣으면 AI 아바타가 말한다. 사내 교육 영상에 많이 쓴다',
  },
  {
    url: 'https://www.heygen.com/',
    title: 'HeyGen',
    description: 'AI 아바타 영상과 다국어 더빙. 입 모양까지 맞춰 준다',
  },
  {
    url: 'https://www.d-id.com/',
    title: 'D-ID',
    description: '사진 한 장을 말하는 얼굴 영상으로 바꿔 주는 도구',
  },
  {
    url: 'https://pika.art/try',
    title: 'Pika',
    description: '짧고 재미있는 영상을 빠르게 만드는 생성 도구',
  },
  {
    url: 'https://kaiber.ai/pricing',
    title: 'Kaiber',
    description: '이미지와 음악을 영상 스타일로 바꿔 주는 생성 도구',
  },
  {
    url: 'https://aico.tv/ko',
    title: '아이코(AICO)',
    description: '긴 영상을 클릭 세 번으로 쇼츠로 만드는 국내 편집 도구',
    category: 'AI 도구 모음 > 영상 편집·자막',
  },
  {
    url: 'https://perso.ai/ko/workspace',
    title: 'PERSO.ai',
    description: 'AI 아바타와 다국어 더빙 영상을 만드는 국내 스튜디오',
  },
  {
    url: 'https://nordy.ai/',
    title: 'Nordy',
    description: '설치도 GPU도 없이 웹에서 ComfyUI 워크플로를 돌리는 클라우드',
    category: 'AI 도구 모음 > API·모델 인프라',
  },
  {
    url: 'https://labs.google/flow/about',
    title: 'Flow',
    description: '구글 Veo로 장면을 이어 붙여 영상을 만드는 크리에이티브 도구',
  },

  // ───────────────────────────────── AI 도구 모음 > 영상 편집·자막
  {
    url: 'https://stock.dropshot.io/ko/lp',
    title: '드롭샷스톡',
    description: '저작권 걱정 없는 한국 스톡 영상을 사는 곳. 편집 소스로 쓴다',
  },
  {
    url: 'https://www.pippit.ai/home',
    title: 'Pippit AI',
    description: '상품 영상·광고·아바타를 자동으로 만드는 캡컷 계열 도구',
  },
  {
    url: 'https://www.descript.com/',
    title: 'Descript',
    description: '받아쓴 글을 고치면 영상이 따라 잘리는 영상·팟캐스트 편집기',
  },
  {
    url: 'https://lumen5.com/',
    title: 'Lumen5',
    description: '블로그 글이나 문서를 SNS용 마케팅 영상으로 바꿔 준다',
  },
  {
    url: 'https://videostew.com/',
    title: '비디오스튜',
    description: '슬라이드 만들듯 글을 영상으로 바꾸는 국내 웹 편집기',
  },
  {
    url: 'https://www.veed.io/',
    title: 'VEED',
    description: '웹에서 자막·자르기·더빙까지 하는 영상 편집 도구',
  },
  {
    url: 'https://www.capcut.com/ko-kr/',
    title: 'CapCut',
    description: '무료 영상 편집기. 템플릿과 자동 자막으로 숏폼을 만든다',
  },
  {
    url: 'https://vizard.ai/',
    title: 'Vizard.ai',
    description: '긴 영상에서 반응 좋을 구간을 골라 숏폼으로 잘라 준다',
  },
  {
    url: 'https://www.opus.pro/',
    title: 'OpusClip',
    description: '긴 영상을 숏폼으로 자르고 자막까지 붙여 바로 올려 준다',
  },
  {
    url: 'https://app.mosaic.so/',
    title: 'Mosaic',
    description: '에이전트가 컷 편집을 대신하는 웹 영상 편집 캔버스',
  },

  // ───────────────────────────────── AI 도구 모음 > 오디오·음성
  {
    url: 'https://suno.com/',
    title: 'Suno',
    description: '가사나 설명을 넣으면 노래 한 곡을 통째로 만들어 주는 AI',
  },
  {
    url: 'https://soundraw.io/',
    title: 'SOUNDRAW',
    description: '저작권 걱정 없는 배경음악을 만들어 내려받는 AI 작곡 도구',
  },
  {
    url: 'https://podcast.adobe.com/',
    title: 'Adobe Podcast',
    description: '녹음에서 잡음과 울림을 걷어 스튜디오 음질로 바꿔 준다',
  },
  {
    url: 'https://wisprflow.ai/',
    title: 'Wispr Flow',
    description: '말하면 어느 앱에나 받아써 주는 음성 입력. 문장도 다듬는다',
  },
  {
    url: 'https://superwhisper.com/',
    title: 'superwhisper',
    description: '맥·윈도우용 음성 받아쓰기. 오프라인 인식과 맞춤 모드를 쓴다',
  },
  {
    url: 'https://illuminate.google.com/explore',
    title: 'Illuminate',
    description: '논문을 두 사람이 대화하는 팟캐스트로 바꿔 주는 구글 도구',
  },
  {
    url: 'https://labs.google/fx/ko/tools/music-fx-dj',
    title: 'MusicFX DJ',
    description: '문장으로 배경음악과 루프를 만들어 보는 구글 실험 도구',
  },

  // ───────────────────────────────── AI 도구 모음 > 코딩·에이전트
  {
    url: 'https://lovable.dev/',
    title: 'Lovable',
    description: '말로 지시하면 웹앱을 만들어 배포까지 해 주는 도구',
  },
  {
    url: 'https://v0.dev/chat',
    title: 'v0',
    description: 'Vercel의 AI 개발 도구. 화면과 코드를 함께 만들어 준다',
  },
  {
    url: 'https://bolt.new/',
    title: 'Bolt',
    description: '브라우저 안에서 앱을 만들고 그대로 배포하는 AI 빌더',
  },
  {
    url: 'https://replit.com/',
    title: 'Replit',
    description: '설치 없이 브라우저에서 코딩하고 배포까지 하는 개발 환경',
  },
  {
    url: 'https://qshop.ai/',
    title: '큐샵',
    description: '코딩 없이 몇 분 만에 쇼핑몰을 세우는 국내 AI 제작 도구',
  },
  {
    url: 'https://www.qodo.ai/',
    title: 'Qodo',
    description: 'PR을 대신 읽고 문제를 짚어 주는 AI 코드 리뷰 도구',
  },
  {
    url: 'https://kiro.dev/',
    title: 'Kiro',
    description: '아마존의 스펙 기반 코딩 IDE. 요구사항부터 코드로 잇는다',
  },
  {
    url: 'https://www.trae.ai/',
    title: 'Trae',
    description: '바이트댄스가 만든 무료 AI 코딩 IDE',
  },
  {
    url: 'https://voideditor.com/',
    title: 'Void',
    description: '오픈소스 AI 코드 에디터. 내 컴퓨터 안에서만 돌릴 수 있다',
  },
  {
    url: 'https://www.warp.dev/',
    title: 'Warp',
    description: 'AI 에이전트가 붙은 터미널. 명령을 대신 짜고 실행해 준다',
  },
  {
    url: 'https://windsurf.com/editor',
    title: 'Windsurf (Devin)',
    description: '코딩 에이전트 IDE. Cognition이 인수해 Devin으로 이어진다',
  },
  {
    url: 'https://21st.dev/?tab=home',
    title: '21st.dev',
    description: 'shadcn 기반 React 컴포넌트 1만여 개를 골라 쓰는 저장소',
  },
  {
    url: 'https://jules.google/',
    title: 'Jules',
    description: '구글의 자율 코딩 에이전트. 이슈를 받아 PR까지 올린다',
  },
  {
    url: 'https://readdy.ai/',
    title: 'Readdy',
    description: '대화만으로 웹사이트를 만들고 코드·피그마로 내보내는 도구',
  },
  {
    url: 'https://mgx.dev/',
    title: 'Atoms (옛 MetaGPT X)',
    description: 'AI 직원들이 나눠 일해 웹사이트·앱을 만드는 멀티 에이전트',
  },
  {
    url: 'https://jules.google.com/task',
    title: 'Jules',
    description: '구글의 자율 코딩 에이전트. 이슈를 받아 PR까지 올린다',
  },
  {
    url: 'https://www.onlook.com/',
    title: 'Onlook',
    description: '실제 React 코드를 화면에서 직접 고치는 디자이너용 에디터',
  },
  {
    url: 'https://pieces.app/',
    title: 'Pieces',
    description: '작업 맥락을 기억해 두었다 다른 AI 도구에 넘겨 주는 도구',
  },
  {
    url: 'https://opal.google/landing/?source=labs',
    title: 'Opal',
    description: '프롬프트를 이어 붙여 작은 AI 앱을 만드는 구글 실험 도구',
  },
  {
    url: 'https://stax.withgoogle.com/projects',
    title: 'Stax',
    description: '여러 LLM의 답을 나란히 견줘 평가하는 구글 실험 도구',
    category: 'AI 도구 모음 > API·모델 인프라',
  },
  {
    url: 'https://v0.app/templates/blog-and-portfolio',
    title: 'v0 템플릿 갤러리',
    description: '블로그·포트폴리오 등 v0로 만든 템플릿을 골라 쓰는 곳',
  },

  // ───────────────────────────────── AI 도구 모음 > API·모델 인프라
  {
    url: 'https://aistudio.google.com/prompts/new_chat',
    title: 'Google AI Studio',
    description: '제미나이 모델을 바로 시험하고 API 키를 받는 구글 콘솔',
  },
  {
    url: 'https://huggingface.co/',
    title: 'Hugging Face',
    description: '오픈 모델·데이터셋·데모가 모이는 AI 커뮤니티 저장소',
  },
  {
    url: 'https://smithery.ai/',
    title: 'Smithery',
    description: '에이전트가 붙일 MCP 서버를 찾아 설치하는 레지스트리',
  },
  {
    url: 'https://ai-sdk.dev/',
    title: 'AI SDK',
    description: 'Next.js 팀이 만든 LLM 연동 SDK. 모델을 바꿔 끼우기 쉽다',
  },
  {
    url: 'https://openrouter.ai/models',
    title: 'OpenRouter',
    description: '여러 회사 모델을 API 하나로 부르고 가격을 견주는 중개소',
  },
  {
    url: 'https://groq.com/',
    title: 'Groq',
    description: '전용 칩으로 응답이 아주 빠른 LLM 추론 API',
  },
  {
    url: 'https://colab.research.google.com/',
    title: 'Google Colab',
    description: '브라우저에서 파이썬을 돌리는 노트북. GPU도 조금 내준다',
  },
  {
    url: 'https://www.browserbase.com/',
    title: 'Browserbase',
    description: '에이전트가 쓰는 클라우드 브라우저. 로그인·캡차까지 다룬다',
  },
  {
    url: 'https://cloud.google.com/use-cases/free-ai-tools?hl=ko',
    title: 'Google Cloud 무료 AI 도구',
    description: '구글 클라우드가 무료로 여는 AI 도구와 크레딧 안내 모음',
  },
  {
    url: 'https://developers.google.com/program/my-benefits?hl=ko',
    title: 'Google Developer Program',
    description: '구글 개발자용 학습·배지·크레딧을 모아 주는 공식 프로그램',
  },
  {
    url: 'https://console.cloud.google.com/vertex-ai/studio/multimodal?rapt=AEjHL4OUnNOBwgf5kj6fYmKSl9K1WVE-9osgrqMBVbrAEcsZmoZ1Waas-uP5Ck_mP3N5SSf8GZDwN_I2OVb7MYnFFSZ6hbvEJa7wET0HySuiFi-2sSpFsfE&project=gen-lang-client-0188130285',
    title: 'Vertex AI Studio',
    description: '구글 클라우드에서 모델을 시험하고 운영에 붙이는 콘솔',
  },
  {
    url: 'https://stability.ai/',
    title: 'Stability AI',
    description: 'Stable Diffusion을 만든 곳. 이미지·영상·오디오 모델을 낸다',
    category: 'AI 도구 모음 > API·모델 인프라',
  },

  // ───────────────────────────────── AI 도구 모음 > 오픈소스·자료 모음
  {
    url: 'https://github.com/NomaDamas/k-skill',
    title: 'k-skill',
    description: '에이전트를 한국 사정에 맞게 굴리는 스킬 모음 저장소',
  },
  {
    url: 'https://github.com/zeroclaw-labs/zeroclaw',
    title: 'Zeroclaw',
    description: '어느 기기에서나 도는 가볍고 자율적인 AI 비서 저장소',
  },
  {
    url: 'https://github.com/rullerzhou-afk/clawd-on-desk',
    title: 'clawd-on-desk',
    description: '코딩 에이전트가 일하는 모습을 지켜보는 픽셀 데스크톱 펫',
  },
  {
    url: 'https://github.com/whiteport-collective/whiteport-design-studio',
    title: 'Whiteport Design Studio',
    description: 'BMad 방법론을 따르는 UX·컨셉 디자인 에이전트 모음',
  },
  {
    url: 'https://github.com/ultraworkers/claw-code',
    title: 'claw-code',
    description: '사람 손 없이 에이전트만으로 만들고 고치는 러스트 실험작',
  },
  {
    url: 'https://github.com/ysys143/analyze-cc-prompts',
    title: 'analyze-cc-prompts',
    description: 'Claude Code의 내부 프롬프트를 뜯어 분석해 둔 저장소',
  },
  {
    url: 'https://github.com/phuryn/pm-skills',
    title: 'pm-skills',
    description: '기획부터 출시까지 PM 업무를 돕는 에이전트 스킬 100여 종',
  },
  {
    url: 'https://github.com/chopratejas/headroom',
    title: 'Headroom',
    description: '도구 출력과 로그를 줄여 LLM 토큰을 아끼는 압축 라이브러리',
  },
  {
    url: 'https://github.com/VoltAgent/awesome-design-md/tree/main',
    title: 'awesome-design-md',
    description: '유명 브랜드 디자인 시스템을 정리한 DESIGN.md 모음',
  },
  {
    url: 'https://github.com/zarazhangrui/frontend-slides',
    title: 'frontend-slides',
    description: '코딩 에이전트로 웹 슬라이드를 만드는 스킬 저장소',
  },
  {
    url: 'https://github.com/ZeroLu/awesome-gpt-image',
    title: 'awesome-gpt-image',
    description: 'GPT Image로 잘 나온 프롬프트와 예시를 모아 둔 저장소',
  },
  {
    url: 'https://github.com/pim97/anti-detect-browser-tools-tech-comparison',
    title: 'anti-detect-browser-tools 비교',
    description: '웹 스크래핑 도구들이 봇 차단을 어떻게 다루는지 비교한 글',
  },

  // ───────────────────────────────── AI 도구 모음 > 디자인
  {
    url: 'https://uizard.io/',
    title: 'Uizard',
    description: '슬라이드 만들듯 앱·웹 화면을 그리는 AI 와이어프레임 도구',
  },
  {
    url: 'https://www.napkin.ai/',
    title: 'Napkin AI',
    description: '글을 붙여 넣으면 도식과 그림으로 바꿔 주는 도구',
  },
  {
    url: 'https://teleporthq.io/',
    title: 'TeleportHQ',
    description: '화면을 그리면 프런트엔드 코드가 나오는 로우코드 빌더',
  },
  {
    url: 'https://www.visily.ai/',
    title: 'Visily',
    description: '스크린샷이나 손그림을 고품질 화면 설계로 바꿔 주는 도구',
  },
  {
    url: 'https://stitch.withgoogle.com/',
    title: 'Stitch',
    description: '문장으로 앱·웹 UI를 만들어 주는 구글의 디자인 실험 도구',
  },
  {
    url: 'https://www.lovart.ai/ko',
    title: 'Lovart',
    description: '대화 한 번으로 로고부터 캠페인까지 만드는 디자인 에이전트',
  },
  {
    url: 'https://uxpilot.ai/a/ui-list',
    title: 'UX Pilot',
    description: '와이어프레임과 UI를 빠르게 뽑아 주는 AI 화면 설계 도구',
  },
  {
    url: 'https://www.supanova.dev/',
    title: '수파노바',
    description: '바이브코딩용 랜딩페이지 디자인을 대신 잡아 주는 국내 도구',
  },
  {
    url: 'https://getdesign.md/',
    title: 'getdesign.md',
    description: '유명 사이트의 디자인 규칙을 코딩 에이전트에 물려주는 문서',
  },
  {
    url: 'https://app.superdesign.dev/',
    title: 'Superdesign',
    description: '프롬프트로 화면 디자인을 만들고 다듬는 AI 디자인 도구',
    category: 'AI 도구 모음 > 디자인',
  },

  // ───────────────────────────────── AI 도구 모음 > 문서·자동화
  {
    url: 'https://gamma.app/',
    title: 'Gamma',
    description: '문장 몇 줄로 슬라이드·문서·웹페이지를 만들어 주는 도구',
  },
  {
    url: 'https://www.beautiful.ai/',
    title: 'Beautiful.ai',
    description: '레이아웃이 알아서 맞춰지는 기업용 슬라이드 제작 도구',
  },
  {
    url: 'https://www.popai.pro/',
    title: 'PopAi',
    description: 'PDF·문서를 읽고 발표 자료로 만들어 주는 AI 도구',
  },
  {
    url: 'https://toolsaday.com/seo/lazy-loading-images-checker',
    title: 'Toolsaday',
    description: '글쓰기·SEO·이미지 점검까지 잡다한 무료 웹 도구 모음',
  },
  {
    url: 'https://app.dalpha.so/proposal/result/01962d3e-2ce8-7437-b041-e44cb3cbfa4f',
    title: '달파 자동화 제안서',
    description: '달파에 맡긴 업무 자동화 제안 결과를 보는 페이지',
  },
  {
    url: 'https://bati.ai/',
    title: '바티AI',
    description: '반복 업무를 대신 처리해 주는 국내 AI 자동화 비서',
  },
  {
    url: 'https://pipedream.com/',
    title: 'Pipedream',
    description: 'API와 앱을 이어 붙여 업무 흐름을 자동화하는 개발자 도구',
  },
  {
    url: 'https://www.browseract.com/',
    title: 'BrowserAct',
    description: '코딩 없이 웹 스크래퍼를 만들어 돌리는 자동화 도구',
  },
  {
    url: 'https://getgpt.app/?provider=google',
    title: 'GetGPT',
    description: 'AI 글쓰기와 업무 자동화 도구를 모아 둔 국내 서비스',
    category: 'AI 도구 모음 > 문서·자동화',
  },

  // ───────────────────────────────── AI 도구 모음 > 프롬프트·디렉터리
  {
    url: 'https://www.futuretools.io/',
    title: 'Future Tools',
    description: '새로 나온 AI 도구를 분류해 모아 두는 해외 디렉터리',
  },
  {
    url: 'https://prompthero.com/',
    title: 'PromptHero',
    description: '이미지 생성 프롬프트를 결과와 함께 검색하는 사이트',
  },
  {
    url: 'https://www.prpt.ai/',
    title: '오픈프롬프트',
    description: '국내 사용자들이 프롬프트를 올리고 나눠 쓰는 라이브러리',
  },
  {
    url: 'https://gptable.net/',
    title: '지피테이블 (도메인 확인 필요)',
    description: '프롬프트·GPTs 공유 DB였으나 지금은 다른 사이트가 떠 있다',
  },
  {
    url: 'https://labs.google/experiments',
    title: 'Google Labs (주소 확인 필요)',
    description: '구글 실험 프로젝트 모음. 지금 이 주소는 404를 돌려준다',
  },
  {
    url: 'https://promptairlines.com/',
    title: 'Prompt Airlines',
    description: '프롬프트 공격을 실습으로 배우는 Wiz의 AI 보안 훈련장',
  },
  {
    url: 'https://www.vellum.ai/llm-leaderboard',
    title: 'LLM Leaderboard',
    description: '주요 모델의 추론·코딩 성능을 항목별로 견주는 순위표',
  },

  // ───────────────────────────────── 마케팅 > 분석·측정
  {
    url: 'https://analytics.google.com/analytics/web/#/p403179142/reports/intelligenthome?params=_u..nav%3Dmaui',
    title: 'Google Analytics (b-creator)',
    description: '방문자 유입과 행동을 보는 구글 분석. 비크리에이터 속성이다',
  },
  {
    url: 'https://www.google.com/search?q=%EB%82%B4+%EB%B9%84%EC%A6%88%EB%8B%88%EC%8A%A4&mat=CaZK1gopX54YEkwBezTaAWQ6ROnT7CfMICfmsBtsIUOdVFzTSaEpJcFb5OnBcEwFRS2q1sAMDQXpB-AxHuIlBmfxESF5AwXkZg5vOq3NS89Qw8gEVS4Q&hl=ko&authuser=0',
    title: 'Google 비즈니스 프로필',
    description: '검색·지도에 뜨는 우리 업체 정보를 고치고 성과를 보는 곳',
  },
  {
    url: 'https://search.google.com/search-console/performance/search-analytics?resource_id=https%3A%2F%2Fb-creator.com%2F',
    title: 'Google Search Console',
    description: '검색 노출·클릭·색인 상태를 보는 구글 웹마스터 도구',
  },
  {
    url: 'https://analytics.naver.com/summary/dashboard.html?startDateStr=2024.04.25&endDateStr=2024.05.01#url',
    title: '네이버 애널리틱스',
    description: '네이버가 주는 방문 통계. 국내 유입 경로를 함께 본다',
  },
  {
    url: 'https://searchadvisor.naver.com/console/site/report/expose?site=https%3A%2F%2Fkeypaper.biz',
    title: '네이버 서치어드바이저',
    description: '네이버 검색 노출과 색인을 관리하는 웹마스터 도구',
  },
  {
    url: 'https://www.hotjar.com/',
    title: 'Hotjar',
    description: '클릭 히트맵과 방문자 화면 녹화로 이탈 지점을 찾는 도구',
  },
  {
    url: 'https://analytics.google.com/analytics/web/#/p500059188/reports/dashboard?params=_u..nav%3Dmaui&ruid=business-objectives-raise-brand-awareness-overview,business-objectives,raise-brand-awareness&collectionId=business-objectives&r=business-objectives-raise-brand-awareness-overview',
    title: 'Google Analytics (브랜드 인지)',
    description: '브랜드 인지 목표 대시보드. 위 GA와 다른 속성을 본다',
  },
  {
    url: 'https://www.cigro.io/',
    title: '씨그로',
    description: '여러 채널의 매출과 광고비를 한곳에 모으는 커머스 분석',
  },

  // ───────────────────────────────── 마케팅 > 광고 집행
  {
    url: 'https://www.google.com/adsense/new/u/0/pub-5228404410896212/home',
    title: 'Google AdSense',
    description: '내 사이트에 광고를 붙여 수익을 정산받는 구글 서비스',
  },
  {
    url: 'https://ads.google.com/aw/overview?ocid=1212815919&euid=1033953280&__u=1936734720&uscid=1212815919&__c=4014010231&authuser=0&workspaceId=0&subid=kr-ko-awhp-g-aw-c-home-signin-bgc!o2-ahpm-0000000188-0000000000',
    title: 'Google Ads',
    description: '검색·디스플레이·유튜브 광고를 만들고 집행하는 관리자',
  },
  {
    url: 'https://adsmanager.facebook.com/adsmanager/manage/campaigns?global_scope_id=193887206628749&business_id=193887206628749&act=366312127494051&redirect_session_id=0ab71c9f-8ddf-4691-9b2b-150bfdcdfc71#',
    title: 'Meta 광고 관리자',
    description: '페이스북·인스타그램 광고를 만들고 성과를 보는 관리자',
  },
  {
    url: 'https://manage.searchad.naver.com/customers/1186218/adgroups/grp-a001-01-000000045538176',
    title: '네이버 검색광고',
    description: '네이버 파워링크 등 검색광고를 집행하는 광고주 센터',
  },
  {
    url: 'https://www.brevo.com/',
    title: 'Brevo',
    description: '이메일·SMS 발송과 CRM을 함께 다루는 마케팅 자동화 도구',
  },
  {
    url: 'https://mediap.kr/',
    title: '미디어플랫폼',
    description: '보도자료를 언론사에 배포해 네이버·다음에 노출시키는 대행',
    category: '마케팅 > 광고 집행',
  },

  // ───────────────────────────────── 마케팅 > 리서치·트렌드
  {
    url: 'https://vling.net/',
    title: '블링',
    description: '유튜브 채널·영상 데이터를 분석해 협업 후보를 찾는 도구',
  },
  {
    url: 'https://aisac.kobaco.co.kr/site/main/home',
    title: 'AiSAC',
    description: '코바코가 운영하는 광고 아카이브와 AI 광고 제작 지원',
  },
  {
    url: 'https://ko-kr.facebook.com/ads/library/?active_status=active&ad_type=political_and_issue_ads&country=KR&is_targeted_country=false&media_type=all',
    title: 'Meta 광고 라이브러리',
    description: '지금 집행 중인 메타 광고를 누구나 찾아보는 공개 DB',
  },
  {
    url: 'https://adstransparency.google.com/?region=KR',
    title: '광고 투명성 센터',
    description: '광고주별로 구글에 집행 중인 광고를 찾아보는 공개 DB',
  },
  {
    url: 'https://sensortower.com/',
    title: 'Sensor Tower',
    description: '앱 다운로드·매출·광고 집행을 추정해 주는 시장 데이터',
  },
  {
    url: 'https://apify.com/',
    title: 'Apify',
    description: '웹 데이터를 긁어 오는 스크래퍼를 골라 돌리는 마켓플레이스',
  },
  {
    url: 'https://brightdata.com/?ps_partner_key=Nzk0YWIzOGI1OTNj&ps_xid=xNjtHXvSitPMgj&gsxid=xNjtHXvSitPMgj&gspk=Nzk0YWIzOGI1OTNj',
    title: 'Bright Data',
    description: '프록시망과 데이터셋으로 대규모 웹 수집을 하는 플랫폼',
  },
  {
    url: 'https://www.ugwanggi.com/',
    title: '유광기',
    description: '유튜브 광고 소재를 모아 레퍼런스로 찾아보는 국내 서비스',
    category: '마케팅 > 리서치·트렌드',
  },
  {
    url: 'https://hypersales.ai/',
    title: '하이퍼세일즈',
    description: 'B2B 영업용 기업 데이터를 찾아 아웃바운드에 쓰는 도구',
    category: '마케팅 > 리서치·트렌드',
  },
  {
    url: 'https://www.lazyweb.com/',
    title: 'Lazyweb',
    description: '30만 건 실험 데이터에서 그로스 아이디어를 뽑아 주는 도구',
    category: '마케팅 > 리서치·트렌드',
  },

  // ───────────────────────────────── 마케팅 > 상세페이지·콘텐츠 (신설)
  {
    url: 'https://www.hookable.ai/',
    title: '후커블',
    description: '히트 상품 데이터를 학습해 상세페이지를 만드는 국내 AI',
    category: '마케팅 > 상세페이지·콘텐츠',
  },
  {
    url: 'https://aieditor.gabia.com/',
    title: '제디터',
    description: '가비아의 AI 에디터. 상품 상세페이지를 몇 분 만에 만든다',
    category: '마케팅 > 상세페이지·콘텐츠',
  },
  {
    url: 'https://home.kiwisnap.net/service/editor',
    title: '키위스냅',
    description: '쿠팡·스마트스토어용 상세페이지를 템플릿으로 만드는 도구',
    category: '마케팅 > 상세페이지·콘텐츠',
  },
  {
    url: 'https://pagemaker.ai.kr/',
    title: '페이지메이커',
    description: '이미지나 상품 URL로 상세페이지와 SNS 콘텐츠를 뽑아낸다',
    category: '마케팅 > 상세페이지·콘텐츠',
  },

  // ───────────────────────────────── 웹사이트 진단 > 성능·속도
  {
    url: 'https://www.siteindices.com/',
    title: 'SiteIndices',
    description: '트래픽과 광고 수익을 근거로 사이트 가치를 매겨 주는 곳',
  },
  {
    url: 'https://tools.pingdom.com/',
    title: 'Pingdom Tools',
    description: '페이지 로딩 시간과 요청을 항목별로 재 주는 속도 검사',
  },
  {
    url: 'https://gtmetrix.com/',
    title: 'GTmetrix',
    description: '페이지 속도를 상세 리포트로 진단하고 개선점을 알려 준다',
  },
  {
    url: 'https://developers.google.com/speed/pagespeed/insights/?hl=ko',
    title: 'PageSpeed Insights',
    description: '구글이 매기는 성능 점수와 코어 웹 바이탈 진단',
  },

  // ───────────────────────────────── 웹사이트 진단 > 도메인·보안
  {
    url: 'https://www.ssllabs.com/ssltest/',
    title: 'SSL Server Test',
    description: '인증서와 TLS 설정을 등급으로 채점해 주는 무료 보안 검사',
  },
  {
    url: 'https://dnschecker.org/#A/moneynlifehacker.com',
    title: 'DNS Checker',
    description: '전 세계 DNS 서버에 변경이 퍼졌는지 한눈에 확인한다',
  },
  {
    url: 'https://www.spc.or.kr/sam/sam06_01.asp',
    title: 'SW저작권 체크 (주소 확인 필요)',
    description: '불법 SW 자가점검 도구였으나 지금 이 주소는 열리지 않는다',
  },
  {
    url: 'https://duckduckgo.com/',
    title: 'DuckDuckGo',
    description: '검색 기록을 남기지 않는 개인정보 보호 검색엔진',
  },
  {
    url: 'https://whatismyipaddress.com/',
    title: 'What Is My IP Address',
    description: '지금 내 공인 IP와 접속 위치·통신사를 알려 주는 곳',
  },
  {
    url: 'https://digital.com/best-web-hosting/who-is/#search=wgtoy.or.kr',
    title: '호스팅 업체 조회 (주소 확인 필요)',
    description: '어느 호스팅을 쓰는지 찾는 도구였으나 주소가 사라졌다',
  },

  // ───────────────────────────────── 웹사이트 진단 > 기술스택·SEO
  {
    url: 'https://www.similarweb.com/',
    title: 'Similarweb',
    description: '경쟁 사이트의 트래픽과 유입 경로를 추정해 보여 준다',
  },
  {
    url: 'http://www.internettrend.co.kr/trendForward.tsp',
    title: 'InternetTrend',
    description: '국내 검색엔진 점유율과 산업별 검색 동향을 보는 리포트',
  },
  {
    url: 'https://www.xml-sitemaps.com/validate-xml-sitemap.html',
    title: 'XML Sitemap 검사',
    description: '사이트맵 파일이 형식에 맞는지 검사해 주는 무료 도구',
  },
  {
    url: 'https://web.archive.org/',
    title: 'Wayback Machine',
    description: '과거 어느 날의 웹페이지 모습을 그대로 되살려 보여 준다',
  },
  {
    url: 'https://trends.builtwith.com/cms/WordPress',
    title: 'BuiltWith Trends',
    description: '어떤 웹 기술을 얼마나 쓰는지 점유율로 보여 주는 통계',
  },
  {
    url: 'https://www.tiobe.com/tiobe-index/',
    title: 'TIOBE Index',
    description: '검색량을 근거로 매기는 프로그래밍 언어 인기 순위',
  },
  {
    url: 'https://w3techs.com/',
    title: 'W3Techs',
    description: '서버·CMS·언어 등 웹 기술 사용 통계를 조사해 공개한다',
  },
  {
    url: 'https://www.wp-data.com/kr/',
    title: '워드프레스 애널리틱스',
    description: '워드프레스 사이트의 테마·플러그인·호스팅을 조회한다',
  },
  {
    url: 'https://sitechecker.pro/app/main/wp-checker-land?pageUrl=https:%2F%2Fcrew.titantools.co.kr%2F',
    title: 'Sitechecker',
    description: '사이트를 훑어 SEO 문제와 순위 변화를 추적하는 도구',
  },
  {
    url: 'https://www.google.com/webmasters/markup-helper/u/0/?hl=ko',
    title: '구조화된 데이터 마크업 도우미',
    description: '검색 결과에 쓰일 구조화 데이터를 눌러서 만드는 구글 도구',
  },
  {
    url: 'https://websiteseochecker.com/',
    title: 'Website SEO Checker',
    description: '도메인·백링크·속도를 한 번에 훑는 무료 SEO 점검 도구',
  },

  // ───────────────────────────────── 디자인 레퍼런스
  {
    url: 'https://wwit.design/#google_vignette',
    title: 'What Was IT',
    description: '한국 앱·웹의 UI/UX 패턴을 모아 두는 국내 레퍼런스',
  },
  {
    url: 'https://land-book.com/',
    title: 'Land-book',
    description: '잘 만든 랜딩페이지를 업종·스타일별로 골라 보는 갤러리',
  },
  {
    url: 'https://uibowl.io/',
    title: '유아이볼',
    description: '국내 앱·웹 UI를 화면·패턴별로 찾아보는 레퍼런스 서비스',
  },
  {
    url: 'https://mobbin.com/',
    title: 'Mobbin',
    description: '실제 앱 화면 40만 장을 흐름·패턴으로 검색하는 자료실',
  },
  {
    url: 'https://scrnshts.club/',
    title: 'ScreensDesign',
    description: '앱스토어 스크린샷을 모아 마케팅 화면을 참고하는 곳',
  },
  {
    url: 'https://appshots.design/',
    title: 'Appshots',
    description: '앱 화면과 온보딩 흐름을 모아 보여 주는 레퍼런스 사이트',
  },
  {
    url: 'https://www.lapa.ninja/',
    title: 'Lapa Ninja',
    description: '무료 랜딩페이지 예시와 UI 키트를 모아 둔 갤러리',
  },
  {
    url: 'https://collectui.com/',
    title: 'Collect UI',
    description: '버튼·폼 같은 일상 UI 시안을 주제별로 모아 두는 곳',
  },
  {
    url: 'https://designbase.co.kr/designer-bookmark/',
    title: '디자인베이스',
    description: '국내 디자이너가 모은 무료 폰트·컬러·소스 북마크 모음',
  },
  {
    url: 'https://www.cssdesignawards.com/',
    title: 'CSS Design Awards',
    description: '완성도 높은 웹사이트를 뽑아 시상하는 해외 어워드',
  },
  {
    url: 'https://www.awwwards.com/',
    title: 'Awwwards',
    description: '웹 디자인 트렌드를 이끄는 대표적인 사이트 어워드',
  },
  {
    url: 'https://www.behance.net/',
    title: 'Behance',
    description: '어도비가 운영하는 포트폴리오 플랫폼. 작업물을 찾아본다',
  },

  // ───────────────────────────────── 리서치·학술
  {
    url: 'https://typeset.io/',
    title: 'SciSpace (typeset.io)',
    description: '논문을 읽고 요약·설명해 주는 AI. 아래 scispace와 같은 곳',
  },
  {
    url: 'https://consensus.app/sign-up/onboarding/?redirect_url=%2F',
    title: 'Consensus',
    description: '질문을 던지면 논문 속 근거 문장을 찾아 주는 학술 검색',
  },
  {
    url: 'https://scispace.com/',
    title: 'SciSpace',
    description: '논문을 요약·번역하고 이어질 질문까지 다루는 리서치 AI',
  },
  {
    url: 'https://www.semanticscholar.org/',
    title: 'Semantic Scholar',
    description: 'AI가 인용 관계까지 정리해 주는 무료 영어 논문 검색',
  },
  {
    url: 'https://app.researchrabbit.ai/?auth-open=sign-up',
    title: 'ResearchRabbit',
    description: '논문 한 편에서 인용 관계를 지도로 펼쳐 보여 주는 도구',
  },
  {
    url: 'https://scholar.google.com/?hl=ko',
    title: 'Google 학술검색',
    description: '논문·특허·판례까지 폭넓게 훑는 구글의 학술 검색',
  },
  {
    url: 'https://www.kci.go.kr/kciportal/main.kci',
    title: '한국학술지인용색인(KCI)',
    description: '국내 학술지의 논문과 인용 관계를 모아 둔 공식 DB',
  },
  {
    url: 'https://kiss.kstudy.com/',
    title: 'KISS',
    description: '국내 학술논문을 주제·인용지수로 찾는 전문 검색 서비스',
  },
  {
    url: 'https://www.dbpia.co.kr/',
    title: 'DBpia',
    description: '국내 논문과 학술지를 원문으로 받아 보는 대표 학술 DB',
  },
  {
    url: 'https://www.riss.kr/index.do',
    title: 'RISS',
    description: '국내외 학위논문·학술지를 통합 검색하는 공공 서비스',
  },

  // ───────────────────────────────── 강의·교육 > 출강처·플랫폼
  {
    url: 'https://www.gangsaya.co.kr/intro.html',
    title: '강사야',
    description: '특강·행사 강사를 등록하고 섭외 요청을 받는 매칭 플랫폼',
  },
  {
    url: 'https://iamgangsa.com/',
    title: '아이엠강사',
    description: '강사 프로필과 강의안을 올려 기업 교육 섭외를 받는 곳',
  },
  {
    url: 'https://biz.taling.me/tutor/507',
    title: '탈잉 기업교육',
    description: '탈잉이 운영하는 기업 맞춤 교육. 강사로 등록해 출강한다',
  },
  {
    url: 'http://stargs.co.kr/',
    title: '스타강사클럽',
    description: '강사들이 강의 정보와 섭외 기회를 나누는 국내 커뮤니티',
  },
  {
    url: 'https://hooh.kr/sub/member/join1.asp#/',
    title: '호오컨설팅',
    description: '기업 교육 강사를 섭외·중개하는 국내 컨설팅 플랫폼',
  },
  {
    url: 'https://www.wisecasting.com/',
    title: '전지연 (와이즈캐스팅)',
    description: '연사·강사·심사위원 등 전문가의 시간을 사고파는 플랫폼',
  },
  {
    url: 'https://www.connectvalue.net/',
    title: '커넥트밸류',
    description: '에듀테크로 계층교육을 설계하는 HRD 컨설팅 회사',
  },

  // ───────────────────────────────── 강의·교육 > 교육 자료·운영
  {
    url: 'https://www.work24.go.kr/hr/i/b/1200/ncsInstrChgAply.do?hnfManageNo=m5Q99sQbywiSwdZa1AmPnw%3D%3D&changeSeqNo=0&edtYn=&maxChangeSeqNo=0',
    title: '고용24 (NCS 강사 변경)',
    description: '직업훈련 과정의 NCS 강사 등록·변경을 신청하는 공공 창구',
  },
  {
    url: 'https://excalidraw.com/',
    title: 'Excalidraw',
    description: '손그림 느낌으로 그리는 화이트보드. 강의 판서에 쓴다',
  },

  // ───────────────────────────────── 업무 워크스페이스 > 협업·사내 도구 (신설)
  {
    url: 'https://www.notion.so/2e61751b19ce80cbb3aff557b4a960e4',
    title: '아이티커넥트 위키 (Notion)',
    description: '사내 문서와 업무 기록이 모이는 노션 워크스페이스',
    category: '업무 워크스페이스 > 협업·사내 도구',
  },
  {
    url: 'https://platform.claude.com/',
    title: 'Claude Platform',
    description: 'Claude API 키와 사용량을 관리하는 Anthropic 콘솔',
    category: '업무 워크스페이스 > 협업·사내 도구',
  },
  {
    url: 'https://studio.workspace.google.com/',
    title: 'Google Workspace Studio',
    description: '구글 문서·시트·메일을 잇는 업무 자동화를 만드는 곳',
    category: '업무 워크스페이스 > 협업·사내 도구',
  },
  {
    url: 'https://itconnect-ft.sentry.io/issues/',
    title: 'Sentry',
    description: '운영 중인 서비스에서 나는 오류를 모아 보는 모니터링',
    category: '업무 워크스페이스 > 협업·사내 도구',
  },

  // ───────────────────────────────── 업무 워크스페이스 > 재무·회계 (신설)
  {
    url: 'https://clobe.ai/',
    title: '클로브',
    description: '계좌·카드·세금 데이터를 모아 매일 자금일보를 보내 준다',
    category: '업무 워크스페이스 > 재무·회계',
  },
  {
    url: 'https://granter.biz/ai-chat',
    title: '그랜터',
    description: '거래내역을 모아 계정과목을 자동 분류하는 AI 회계 프로그램',
    category: '업무 워크스페이스 > 재무·회계',
  },

  // ───────────────────────────────── 업무 워크스페이스 > 사업·지원사업 (신설)
  {
    url: 'https://makedeck.nextunicorn.kr/service',
    title: '메이크덱',
    description: '정부지원사업 공고를 읽고 사업계획서 초안을 만들어 준다',
    category: '업무 워크스페이스 > 사업·지원사업',
  },
  {
    url: 'https://www.vcreview.xyz/',
    title: 'VCReview',
    description: 'VC 페르소나들이 IR 자료의 약점을 짚어 주는 투심 시뮬레이터',
    category: '업무 워크스페이스 > 사업·지원사업',
  },
  {
    url: 'https://kstartupforum.org/members/interview',
    title: '코리아스타트업포럼',
    description: '스타트업의 정책 대응과 성장을 돕는 국내 협회',
    category: '업무 워크스페이스 > 사업·지원사업',
  },
  {
    url: 'https://portal.koreaconnect.kr/user/ma/main',
    title: '디지털융합플랫폼',
    description: '정부와 민간이 함께 쓰는 디지털 자원 신청·관리 포털',
    category: '업무 워크스페이스 > 사업·지원사업',
  },

  // ───────────────────────────────── Discord 등록 후 분류·내용 보정
  {
    url: 'https://jiinsi.com/',
    title: '지인시',
    description: 'AI 기술·경제·논문 소식을 매일 큐레이션하는 뉴스레터',
    category: '뉴스·인사이트 > AI 뉴스',
  },

  // ───────────────────────────────── 현재 운영 중인 사이트
  {
    url: 'https://itconnect.dev/',
    title: '아이티커넥트',
    description: 'AX 컨설팅과 사내 바이브코딩 교육을 하는 우리 대표 사이트',
  },
  {
    url: 'https://b-creator.com/',
    title: '비크리에이터',
    description: 'AI 바이브코딩 학습과 결과 정리를 함께하는 학습 도구',
  },
  {
    url: 'https://consulting.itconnect.dev/',
    title: 'Axio',
    description: '병목 업무를 찾아 가치부터 검증하는 AX 컨설팅 코파일럿',
  },
  {
    url: 'https://homepage.works/',
    title: 'HOMEPAGE.WORKS',
    description: '웹·앱 개발 견적을 3분 만에 비교해 보는 외주 개발 창구',
  },
  {
    url: 'https://startora.net/',
    title: 'Startora',
    description: '지식 검색·문서 생성·일정을 챗 하나로 처리하는 업무 비서',
  },
  {
    url: 'https://keypaper.biz/',
    title: 'GrowthLab',
    description: '유튜브 채널·키워드를 분석해 성장 인사이트를 뽑는 스튜디오',
  },
  {
    url: 'https://contents.itconnect.dev/',
    title: 'AI 콘텐츠 자동 생성',
    description: 'AI로 콘텐츠 기획과 제작을 자동화하는 서비스 · 개발 중',
    category: '현재 운영 중인 사이트',
  },
  {
    url: 'https://landingmaker.biz/',
    title: 'LandingMaker',
    description: 'AI로 페이지를 기획하고 제작 프로세스를 관리하는 서비스 · 개발 중',
    category: '현재 운영 중인 사이트',
  },
  {
    url: 'https://itconnect.co.kr/',
    title: 'AI 사업계획서 작성',
    description: 'AI와 함께 사업계획서를 단계별로 완성하는 서비스 · 개발 중',
    category: '현재 운영 중인 사이트',
  },
  {
    url: 'https://profile.itconnect.dev/',
    title: '최원재 프로필',
    description: '대표 프로필 페이지. 기업 AI 교육과 AX 컨설팅 이력을 담았다',
  },
  {
    url: 'https://rutiqa.com/',
    title: '루티카',
    description: '운동·식단·영양제를 채팅과 사진으로 기록하는 AI 관리 앱',
  },
  {
    url: 'https://musinsa-contents.itconnect.dev/login',
    title: '공통 AX 키트 생성기',
    description: '상품별 마케팅 이미지와 문구를 자동 생성하는 사내 도구',
  },
  {
    url: 'https://musinsa-invoice.itconnect.dev/login',
    title: '무신사 주문·송장 변환',
    description: '무신사 3PL 주문서와 송장을 자동 변환하는 사내 작업공간',
  },
  {
    url: 'http://127.0.0.1:9119/content-control',
    title: 'SNS Hermes (내 PC 전용)',
    description: 'SNS 콘텐츠 관리 도구. 주소가 127.0.0.1이라 이 PC에서만 열린다',
  },
  {
    url: 'https://localro-pms.kr/',
    title: '청년마을 PMS',
    description: '청년마을 사업의 실적 보고와 증빙을 관리하는 시스템',
  },
  {
    url: 'https://moneynlifehacker.com/',
    title: 'MacroLens',
    description: '거시 지표와 자산 상관관계를 보는 개인용 주식 분석 도구',
  },
];
