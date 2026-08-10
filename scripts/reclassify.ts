/**
 * IA 재분류 (2026-08-10) — 상위 분류의 **축 혼재**를 걷어낸다.
 *
 * 실행:
 *   npx tsx scripts/reclassify.ts            # 드라이런 — 아무것도 바꾸지 않고 계획만 출력
 *   npx tsx scripts/reclassify.ts --apply    # 적용 (되돌림 스냅샷을 먼저 남긴다)
 *
 * ## 왜 바꾸나
 *
 * 라이브 286건을 전수 조사한 결과, 상위 10개가 **다섯 가지 서로 다른 기준**으로 만들어져 있었다:
 * 기술·기능(AI 도구 모음·웹 도구·UI/UX) / 업무 도메인(마케팅·강의) / 소유 관계(자사 포트폴리오·
 * 현재 운영 중) / 공급 벤더(구글 서비스) / 잔여(기타·참고자료). 축이 섞이면 같은 성격의 링크가
 * 두 곳에 정당하게 들어갈 수 있고, 판단이 애매한 것은 잔여 분류로 흘러간다. 실제로
 * '구글 서비스' 16건 중 14건이 AI 도구였고, '기타'+'참고자료' 54건(19%)이 사실상 미분류였다.
 *
 * 고치는 것은 **벤더 축과 잔여 축**이다. AI 가 상위인 것은 문제가 아니라 실제 비중이다.
 *
 * ## 두 가지를 일부러 하지 않았다
 *
 * 1. **'현재 운영 중인 사이트'는 그대로 둔다.** 보고서는 '자사 포트폴리오'와 묶어 '자사 자산'
 *    하위로 내리자고 했지만, `lib/constants.ts` 의 `OPERATING_CATEGORY_NAME` 이 이 이름으로
 *    카테고리를 찾고 `lib/queries.ts` 의 `findOperatingCategoryId` 가 **최상위만** 본다.
 *    하위로 내리면 홈 3번째 섹션·사이드바 빠른 접근·모바일 칩이 사라지고, 그 섹션에만 서는
 *    '+ 링크추가' 타일까지 함께 사라진다. 축이 어긋난 것도 아니라(둘 다 소유 관계) 얻을 것이 없다.
 * 2. **'AI 도구 모음'의 이름을 줄이지 않는다.** 보고서 표에는 'AI 도구'로 적었으나 이름은
 *    문제가 아니었고, 사용자가 매일 보는 이름을 바꾸는 것은 순수한 손실이다.
 *
 * ## 안전 장치
 *
 * - `--apply` 없이는 **한 줄도 쓰지 않는다.** 드라이런이 기본값이다.
 * - 적용 직전에 `링크 id → 현재 분류`를 JSON 으로 남긴다(되돌릴 유일한 수단).
 * - 규칙은 전수 검증한다: 286건이 빠짐없이 한 번씩 배정되어야 하고, 개별 규칙은 정확히 한 건과
 *   맞아야 하며, 목표에 없는 분류는 **비어 있을 때만** 지운다.
 * - 지우는 순서는 하위 → 상위다. `categories.parent_id` 가 `on delete set null` 이라 상위를 먼저
 *   지우면 하위가 최상위로 승격해 버린다(같은 이유로 북마크를 먼저 옮긴 뒤에 지운다).
 */
import { writeFileSync } from 'node:fs';

import { createServiceRoleClient } from '@/scripts/lib/service-client';

// ─────────────────────────────────────────────────────────── 목표 구조

/** 상위 분류와 그 하위 — 배열 순서가 그대로 `sort_order` 가 된다(사이드바 순서). */
const TARGET: { name: string; subs: string[] }[] = [
  {
    name: 'AI 도구 모음',
    subs: [
      '대화·챗봇',
      '검색·리서치',
      '이미지',
      '영상 생성',
      '영상 편집·자막',
      '오디오·음성',
      '코딩·에이전트',
      'API·모델 인프라',
      '오픈소스·자료 모음',
      '디자인',
      '문서·자동화',
      '프롬프트·디렉터리',
    ],
  },
  { name: '마케팅', subs: ['분석·측정', '광고 집행', '리서치·트렌드'] },
  { name: '웹사이트 진단', subs: ['성능·속도', '도메인·보안', '기술스택·SEO'] },
  { name: '디자인 레퍼런스', subs: [] },
  { name: '리서치·학술', subs: [] },
  { name: '강의·교육', subs: ['출강처·플랫폼', '교육 자료·운영'] },
  { name: '업무 워크스페이스', subs: [] },
  { name: '자사 포트폴리오', subs: [] },
  // ⚠️ 이름·최상위 위치를 바꾸지 말 것 — lib/constants.ts OPERATING_CATEGORY_NAME 이 이 이름으로 찾는다.
  { name: '현재 운영 중인 사이트', subs: [] },
];

/**
 * 이름만 바뀌는 분류 — 링크가 통째로 따라오므로 id 를 살려 둔다(새로 만들고 지우면 `/category/<id>`
 * 주소가 바뀐다). `옛 경로` → `새 경로`.
 */
const RENAMES: Record<string, string> = {
  '웹 도구': '웹사이트 진단',
  'UI/UX 디자인': '디자인 레퍼런스',
  '강의 및 출강': '강의·교육',
  'AI 도구 모음 > 오디오': 'AI 도구 모음 > 오디오·음성',
  // 검색 계열이 아래 `MOVES` 로 빠져나가면 남는 12건은 전부 대화형이라 이름이 더는 맞지 않는다.
  'AI 도구 모음 > 대화·검색': 'AI 도구 모음 > 대화·챗봇',
  'AI 도구 모음 > 코딩': 'AI 도구 모음 > 코딩·에이전트',
  'AI 도구 모음 > 영상': 'AI 도구 모음 > 영상 생성',
  'AI 도구 모음 > 문서': 'AI 도구 모음 > 문서·자동화',
  'AI 도구 모음 > 프롬프트': 'AI 도구 모음 > 프롬프트·디렉터리',
};

/**
 * 링크가 통째로 옮겨 가는 분류. 개별 규칙(`MOVES`)이 없는 링크는 여기 적힌 곳으로 간다.
 * 이름이 바뀌기만 하는 것은 위 `RENAMES` 가 처리하므로 여기 적지 않는다.
 */
const CATEGORY_DEFAULT: Record<string, string> = {
  'AI 도구 모음 > 논문': '리서치·학술',
  'AI 도구 모음 > 그 외': 'AI 도구 모음 > 디자인',
  '구글 서비스': 'AI 도구 모음 > 이미지',
  기타: '업무 워크스페이스',
  '참고자료 > 도구·서비스': 'AI 도구 모음 > 코딩·에이전트',
  '참고자료 > 학습·리서치': '리서치·학술',
  마케팅: '마케팅 > 리서치·트렌드',
  '웹 도구': '웹사이트 진단 > 기술스택·SEO',
  '강의 및 출강': '강의·교육 > 출강처·플랫폼',
};

/**
 * 개별 링크 규칙 — `from` 분류 안에서 제목이 `title` 로 **시작하는** 한 건을 `to` 로 보낸다.
 *
 * 제목으로 고르는 것은 host 가 유일하지 않기 때문이다(`labs.google` 7건, `github.com` 9건이
 * 서로 다른 곳으로 간다). DB 에 저장된 제목 일부가 `…` 로 잘려 있어 **앞부분만** 적는다.
 * 검증기가 "정확히 한 건과 맞는가"를 규칙마다 확인하므로 잘못 적으면 적용 전에 걸린다.
 */
const MOVES: { from: string; title: string; to: string }[] = [
  // ── 구글 서비스 해체 (16건) — 벤더 축을 없앤다. 14건이 AI 도구다.
  { from: '구글 서비스', title: 'ImageFX', to: 'AI 도구 모음 > 이미지' },
  { from: '구글 서비스', title: 'Whisk', to: 'AI 도구 모음 > 이미지' },
  { from: '구글 서비스', title: 'GenType', to: 'AI 도구 모음 > 이미지' },
  { from: '구글 서비스', title: 'Mixboard', to: 'AI 도구 모음 > 이미지' },
  { from: '구글 서비스', title: 'Flow', to: 'AI 도구 모음 > 영상 생성' },
  { from: '구글 서비스', title: 'MusicFX', to: 'AI 도구 모음 > 오디오·음성' },
  { from: '구글 서비스', title: 'Illuminate', to: 'AI 도구 모음 > 오디오·음성' },
  { from: '구글 서비스', title: 'Welcome', to: 'AI 도구 모음 > 코딩·에이전트' }, // opal.google — AI 미니앱 빌더
  { from: '구글 서비스', title: 'Stax', to: 'AI 도구 모음 > 코딩·에이전트' },
  { from: '구글 서비스', title: 'Vertex AI Studio', to: 'AI 도구 모음 > API·모델 인프라' },
  { from: '구글 서비스', title: 'Google Labs', to: 'AI 도구 모음 > 프롬프트·디렉터리' },
  { from: '구글 서비스', title: 'Learn About', to: 'AI 도구 모음 > 검색·리서치' },
  /* Learn About·Learn Your Way·Little Language Lessons 는 셋 다 구글의 **AI 학습 실험**이다.
     '강의·교육'은 사용자의 출강 사업(출강처·강의 자료)을 담는 자리라 성격이 다르다 — 셋을
     갈라 두면 같은 것을 두 곳에서 찾게 되므로 함께 둔다. */
  { from: '구글 서비스', title: 'Learn Your Way', to: 'AI 도구 모음 > 검색·리서치' },
  { from: '구글 서비스', title: 'Little Language Lessons', to: 'AI 도구 모음 > 검색·리서치' },
  { from: '구글 서비스', title: '구글무료서비스', to: 'AI 도구 모음 > API·모델 인프라' },
  { from: '구글 서비스', title: 'Google 개발자 프로그램', to: 'AI 도구 모음 > API·모델 인프라' },

  // ── AI > 대화·검색 26건에서 '대화도 검색도 아닌 것'을 덜어낸다 (남는 22건이 진짜 대화·검색)
  { from: 'AI 도구 모음 > 대화·검색', title: 'Google AI Studio', to: 'AI 도구 모음 > API·모델 인프라' },
  { from: 'AI 도구 모음 > 대화·검색', title: 'futuretools', to: 'AI 도구 모음 > 프롬프트·디렉터리' },
  { from: 'AI 도구 모음 > 대화·검색', title: 'GetGPT', to: 'AI 도구 모음 > 프롬프트·디렉터리' },
  { from: 'AI 도구 모음 > 대화·검색', title: 'AI Research', to: '리서치·학술' }, // typeset.io — 논문 읽기
  { from: 'AI 도구 모음 > 대화·검색', title: 'Perplexity', to: 'AI 도구 모음 > 검색·리서치' },
  { from: 'AI 도구 모음 > 대화·검색', title: 'Liner', to: 'AI 도구 모음 > 검색·리서치' },
  { from: 'AI 도구 모음 > 대화·검색', title: 'Felo', to: 'AI 도구 모음 > 검색·리서치' },
  { from: 'AI 도구 모음 > 대화·검색', title: 'Goover', to: 'AI 도구 모음 > 검색·리서치' },
  { from: 'AI 도구 모음 > 대화·검색', title: 'Genspark', to: 'AI 도구 모음 > 검색·리서치' },
  { from: 'AI 도구 모음 > 대화·검색', title: 'Skywork', to: 'AI 도구 모음 > 검색·리서치' },
  { from: 'AI 도구 모음 > 대화·검색', title: 'Manus', to: 'AI 도구 모음 > 검색·리서치' },
  { from: 'AI 도구 모음 > 대화·검색', title: 'flowith', to: 'AI 도구 모음 > 검색·리서치' },
  { from: 'AI 도구 모음 > 대화·검색', title: '릴리스', to: 'AI 도구 모음 > 검색·리서치' },
  { from: 'AI 도구 모음 > 대화·검색', title: 'Google NotebookLM', to: 'AI 도구 모음 > 검색·리서치' },

  // ── AI > 영상 25건을 '만드는 것'과 '고치는 것'으로 가른다 (기본값은 영상 생성)
  { from: 'AI 도구 모음 > 영상', title: 'Pippit', to: 'AI 도구 모음 > 영상 편집·자막' },
  { from: 'AI 도구 모음 > 영상', title: 'Descript', to: 'AI 도구 모음 > 영상 편집·자막' },
  { from: 'AI 도구 모음 > 영상', title: 'Lumen5', to: 'AI 도구 모음 > 영상 편집·자막' },
  { from: 'AI 도구 모음 > 영상', title: 'Online Video Editor', to: 'AI 도구 모음 > 영상 편집·자막' },
  { from: 'AI 도구 모음 > 영상', title: 'Veed', to: 'AI 도구 모음 > 영상 편집·자막' },
  { from: 'AI 도구 모음 > 영상', title: 'CapCut', to: 'AI 도구 모음 > 영상 편집·자막' },
  { from: 'AI 도구 모음 > 영상', title: 'Vizard', to: 'AI 도구 모음 > 영상 편집·자막' },
  { from: 'AI 도구 모음 > 영상', title: 'Opus', to: 'AI 도구 모음 > 영상 편집·자막' },
  { from: 'AI 도구 모음 > 영상', title: 'Mosaic Video Editor', to: 'AI 도구 모음 > 영상 편집·자막' },

  // ── AI > 이미지에서 AI 가 아닌 것 하나 (스톡 영상 다운로드)
  { from: 'AI 도구 모음 > 이미지', title: '드롭샷스톡', to: 'AI 도구 모음 > 영상 편집·자막' },

  // ── AI > 코딩 24건에서 모델·실행 인프라를 가른다 (기본값은 코딩·에이전트)
  { from: 'AI 도구 모음 > 코딩', title: 'Hugging Face', to: 'AI 도구 모음 > API·모델 인프라' },
  { from: 'AI 도구 모음 > 코딩', title: 'AI SDK', to: 'AI 도구 모음 > API·모델 인프라' },
  { from: 'AI 도구 모음 > 코딩', title: 'OpenRouter', to: 'AI 도구 모음 > API·모델 인프라' },
  { from: 'AI 도구 모음 > 코딩', title: 'groq', to: 'AI 도구 모음 > API·모델 인프라' },
  { from: 'AI 도구 모음 > 코딩', title: 'Smithery', to: 'AI 도구 모음 > API·모델 인프라' },
  { from: 'AI 도구 모음 > 코딩', title: 'Browserbase', to: 'AI 도구 모음 > API·모델 인프라' },
  { from: 'AI 도구 모음 > 코딩', title: 'Colab', to: 'AI 도구 모음 > API·모델 인프라' },
  // Linear 는 AI 코딩 도구가 아니라 매일 여는 업무 도구다(고정 링크이기도 하다).
  { from: 'AI 도구 모음 > 코딩', title: '개발 Task 관리', to: '업무 워크스페이스' },

  // ── 참고자료 > 도구·서비스 30건 해체 (기본값은 AI 코딩·에이전트)
  { from: '참고자료 > 도구·서비스', title: '한국인 스킬 모음집', to: 'AI 도구 모음 > 오픈소스·자료 모음' },
  { from: '참고자료 > 도구·서비스', title: '제로클로우', to: 'AI 도구 모음 > 오픈소스·자료 모음' },
  { from: '참고자료 > 도구·서비스', title: '클로드온데스크', to: 'AI 도구 모음 > 오픈소스·자료 모음' },
  { from: '참고자료 > 도구·서비스', title: 'whiteport-collective', to: 'AI 도구 모음 > 오픈소스·자료 모음' },
  { from: '참고자료 > 도구·서비스', title: 'ultraworkers/claw-code', to: 'AI 도구 모음 > 오픈소스·자료 모음' },
  { from: '참고자료 > 도구·서비스', title: 'ysys143/analyze-cc-prompts', to: 'AI 도구 모음 > 오픈소스·자료 모음' },
  { from: '참고자료 > 도구·서비스', title: 'phuryn/pm-skills', to: 'AI 도구 모음 > 오픈소스·자료 모음' },
  { from: '참고자료 > 도구·서비스', title: '디자인 수파노바', to: 'AI 도구 모음 > 디자인' },
  { from: '참고자료 > 도구·서비스', title: '디자인 프롬프트 라이브러리', to: 'AI 도구 모음 > 프롬프트·디렉터리' },
  { from: '참고자료 > 도구·서비스', title: 'LLM Leaderboard', to: 'AI 도구 모음 > 프롬프트·디렉터리' },
  { from: '참고자료 > 도구·서비스', title: 'Brevo', to: '마케팅 > 광고 집행' },
  { from: '참고자료 > 도구·서비스', title: '씨그로', to: '마케팅 > 분석·측정' },
  { from: '참고자료 > 도구·서비스', title: 'VCReview', to: '리서치·학술' },
  { from: '참고자료 > 도구·서비스', title: '모두의 AI 실험실', to: '리서치·학술' },
  { from: '참고자료 > 도구·서비스', title: '디지털융합플랫폼', to: '리서치·학술' },
  { from: '참고자료 > 도구·서비스', title: 'R&D 디딤돌', to: '업무 워크스페이스' },
  { from: '참고자료 > 도구·서비스', title: 'Sentry', to: '업무 워크스페이스' },
  { from: '참고자료 > 도구·서비스', title: '파일 검색', to: '업무 워크스페이스' },
  { from: '참고자료 > 도구·서비스', title: '강의 판서용', to: '강의·교육 > 교육 자료·운영' },
  { from: '참고자료 > 도구·서비스', title: '달파AI', to: 'AI 도구 모음 > 문서·자동화' },
  { from: '참고자료 > 도구·서비스', title: '바티AI', to: 'AI 도구 모음 > 문서·자동화' },
  { from: '참고자료 > 도구·서비스', title: '클로브AI', to: 'AI 도구 모음 > 문서·자동화' },
  { from: '참고자료 > 도구·서비스', title: '그랜터AI', to: 'AI 도구 모음 > 문서·자동화' },
  { from: '참고자료 > 도구·서비스', title: 'Pipedream', to: 'AI 도구 모음 > 문서·자동화' },
  { from: '참고자료 > 도구·서비스', title: 'BrowserAct', to: 'AI 도구 모음 > 문서·자동화' },

  // ── 참고자료 > 학습·리서치 17건 해체 (기본값은 리서치·학술)
  { from: '참고자료 > 학습·리서치', title: 'NCS강사', to: '강의·교육 > 출강처·플랫폼' },
  { from: '참고자료 > 학습·리서치', title: '콘텐츠 ax', to: '강의·교육 > 교육 자료·운영' },
  { from: '참고자료 > 학습·리서치', title: '콘텐츠 AX', to: '강의·교육 > 교육 자료·운영' },
  { from: '참고자료 > 학습·리서치', title: 'Prompt Airlines', to: 'AI 도구 모음 > 프롬프트·디렉터리' },
  { from: '참고자료 > 학습·리서치', title: 'getdesign.md', to: 'AI 도구 모음 > 디자인' },
  { from: '참고자료 > 학습·리서치', title: '페이지메이커', to: 'AI 도구 모음 > 디자인' },
  { from: '참고자료 > 학습·리서치', title: 'Blog and Portfolio', to: 'AI 도구 모음 > 코딩·에이전트' },
  { from: '참고자료 > 학습·리서치', title: 'Lazyweb MCP', to: 'AI 도구 모음 > 문서·자동화' },
  { from: '참고자료 > 학습·리서치', title: 'Digital Intelligence', to: '마케팅 > 리서치·트렌드' }, // sensortower
  { from: '참고자료 > 학습·리서치', title: 'Apify', to: '마케팅 > 리서치·트렌드' },
  { from: '참고자료 > 학습·리서치', title: 'Bright Data', to: '마케팅 > 리서치·트렌드' },
  { from: '참고자료 > 학습·리서치', title: 'chopratejas/headroom', to: 'AI 도구 모음 > 오픈소스·자료 모음' },
  { from: '참고자료 > 학습·리서치', title: 'VoltAgent/awesome-design-m', to: 'AI 도구 모음 > 오픈소스·자료 모음' },
  { from: '참고자료 > 학습·리서치', title: 'zarazhangrui/frontend-slid', to: 'AI 도구 모음 > 오픈소스·자료 모음' },
  { from: '참고자료 > 학습·리서치', title: 'ZeroLu/awesome-gpt-image', to: 'AI 도구 모음 > 오픈소스·자료 모음' },
  { from: '참고자료 > 학습·리서치', title: 'pim97/anti-detect-browser', to: 'AI 도구 모음 > 오픈소스·자료 모음' },

  // ── 기타 7건 해체 (기본값은 업무 워크스페이스)
  { from: '기타', title: '강사형 직무 교육', to: '강의·교육 > 교육 자료·운영' },
  { from: '기타', title: '[1분반] 2026 AI디지털튜터', to: '강의·교육 > 교육 자료·운영' },

  // ── 마케팅 21건을 셋으로 (기본값은 리서치·트렌드)
  { from: '마케팅', title: 'GA', to: '마케팅 > 분석·측정' },
  { from: '마케팅', title: 'GB', to: '마케팅 > 분석·측정' },
  { from: '마케팅', title: 'GSC', to: '마케팅 > 분석·측정' },
  { from: '마케팅', title: 'NA', to: '마케팅 > 분석·측정' },
  { from: '마케팅', title: 'NSA', to: '마케팅 > 분석·측정' },
  { from: '마케팅', title: 'Hotjar', to: '마케팅 > 분석·측정' },
  { from: '마케팅', title: '애널리틱스', to: '마케팅 > 분석·측정' },
  { from: '마케팅', title: 'GAD', to: '마케팅 > 광고 집행' },
  { from: '마케팅', title: '구글 광고', to: '마케팅 > 광고 집행' },
  { from: '마케팅', title: '페북 광고', to: '마케팅 > 광고 집행' },
  { from: '마케팅', title: '네이버 검색광고', to: '마케팅 > 광고 집행' },
  { from: '마케팅', title: 'HyperSales', to: '마케팅 > 광고 집행' },
  { from: '마케팅', title: '후커블', to: '마케팅 > 광고 집행' },
  { from: '마케팅', title: '유광기', to: '마케팅 > 광고 집행' },

  // ── 웹 도구 22건을 셋으로 (기본값은 기술스택·SEO)
  { from: '웹 도구', title: '웹 사이트 속도체크', to: '웹사이트 진단 > 성능·속도' },
  { from: '웹 도구', title: 'GTmetrix', to: '웹사이트 진단 > 성능·속도' },
  { from: '웹 도구', title: 'Google PageSpeed Insights', to: '웹사이트 진단 > 성능·속도' },
  { from: '웹 도구', title: 'SiteIndices', to: '웹사이트 진단 > 성능·속도' },
  { from: '웹 도구', title: 'SSL 검사', to: '웹사이트 진단 > 도메인·보안' },
  { from: '웹 도구', title: 'DNS Checker', to: '웹사이트 진단 > 도메인·보안' },
  { from: '웹 도구', title: 'What Is My IP Address', to: '웹사이트 진단 > 도메인·보안' },
  { from: '웹 도구', title: '사용중인 호스팅 서버', to: '웹사이트 진단 > 도메인·보안' },
  { from: '웹 도구', title: '개인정보 보호 브라우저', to: '웹사이트 진단 > 도메인·보안' },
  { from: '웹 도구', title: 'SW저작권 체크프로그램', to: '웹사이트 진단 > 도메인·보안' },
  { from: '웹 도구', title: 'Toolsaday', to: 'AI 도구 모음 > 문서·자동화' }, // AI 글쓰기 도구 모음 — 진단 도구가 아니다

  // ── UI/UX 디자인 13건 중 'AI 도구'인 것 하나만 AI 로 (나머지는 볼 것 = 디자인 레퍼런스)
  { from: 'UI/UX 디자인', title: 'UX Pilot', to: 'AI 도구 모음 > 디자인' },

  // ── 강의 및 출강 7건 (기본값은 출강처·플랫폼) — 전부 출강처라 개별 규칙 없음
];

// ─────────────────────────────────────────────────────── 여기부터 실행부

type Category = { id: string; name: string; parent_id: string | null; sort_order: number };
type Bookmark = { id: string; title: string; url: string; category_id: string | null };

function pathOf(category: Category, byId: Map<string, Category>): string {
  if (category.parent_id === null) return category.name;

  return `${byId.get(category.parent_id)?.name ?? '?'} > ${category.name}`;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const service = createServiceRoleClient();

  const { data: catData, error: catError } = await service
    .from('categories')
    .select('id, name, parent_id, sort_order');
  const { data: bmData, error: bmError } = await service
    .from('bookmarks')
    .select('id, title, url, category_id')
    .order('sort_order');
  if (catError || bmError || !catData || !bmData) {
    throw new Error(`조회 실패: ${catError?.message ?? bmError?.message ?? '알 수 없음'}`);
  }

  const cats = catData as Category[];
  const bms = bmData as Bookmark[];
  const byId = new Map(cats.map((c) => [c.id, c]));
  const currentPath = new Map(cats.map((c) => [c.id, pathOf(c, byId)]));

  console.log(`현재: 링크 ${bms.length}건 · 분류 ${cats.length}개`);
  console.log(apply ? '모드: 적용(--apply)\n' : '모드: 드라이런 — 아무것도 바꾸지 않는다\n');

  // ── ① 규칙을 링크에 배정한다 ────────────────────────────────
  const problems: string[] = [];
  const targetPaths = new Set<string>();
  for (const top of TARGET) {
    targetPaths.add(top.name);
    for (const sub of top.subs) targetPaths.add(`${top.name} > ${sub}`);
  }

  /** 링크 id → 갈 곳(경로). */
  const plan = new Map<string, string>();
  /** 어떤 규칙이 몇 건과 맞았는지 — 0건이거나 2건 이상이면 규칙이 틀린 것이다. */
  const ruleHits = MOVES.map(() => [] as string[]);

  for (const bm of bms) {
    const from = bm.category_id === null ? '(미분류)' : (currentPath.get(bm.category_id) ?? '(없는 분류)');

    const hit: number[] = [];
    MOVES.forEach((rule, index) => {
      if (rule.from === from && bm.title.startsWith(rule.title)) hit.push(index);
    });

    /* 접두사끼리 겹칠 수 있다 — 마케팅의 "GA"(애널리틱스)는 "GAD"(광고)의 접두사이기도 하다.
       **더 긴 규칙이 이긴다**: 길수록 더 좁게 지목한 것이므로 그쪽이 쓴 사람의 의도다.
       같은 길이가 둘이면 그건 정말로 못 가리는 것이라 아래에서 문제로 세운다. */
    const longest = hit.reduce((best, i) => (MOVES[i].title.length > MOVES[best].title.length ? i : best), hit[0]);
    const matched = hit.filter((i) => MOVES[i].title.length === MOVES[longest]?.title.length);

    if (matched.length > 1) {
      const names = matched.map((i) => `"${MOVES[i].title}"`).join(', ');
      problems.push(`규칙 충돌: "${bm.title}" (${from}) 에 ${names} 가 함께 맞는다`);
      continue;
    }

    if (matched.length === 1) {
      const index = matched[0];
      ruleHits[index].push(bm.title);
      plan.set(bm.id, MOVES[index].to);
      continue;
    }

    // 개별 규칙이 없으면 분류 단위 기본값 → 이름만 바뀐 경우 → 제자리
    const fallback = CATEGORY_DEFAULT[from] ?? RENAMES[from] ?? from;
    plan.set(bm.id, fallback);
  }

  ruleHits.forEach((hits, index) => {
    const rule = MOVES[index];
    if (hits.length === 0) problems.push(`빈 규칙: "${rule.title}" 가 [${rule.from}] 에서 아무것도 못 찾았다`);
    if (hits.length > 1) problems.push(`중복 규칙: "${rule.title}" 가 [${rule.from}] 에서 ${hits.length}건과 맞았다 — ${hits.join(' / ')}`);
  });

  for (const [id, dest] of plan) {
    if (!targetPaths.has(dest)) {
      const bm = bms.find((b) => b.id === id);
      problems.push(`목표에 없는 분류로 보냄: "${bm?.title}" → [${dest}]`);
    }
  }

  if (plan.size !== bms.length) problems.push(`배정 누락: ${bms.length}건 중 ${plan.size}건만 배정됐다`);

  // ── ② 계획 출력 ────────────────────────────────────────────
  const bucket = new Map<string, Bookmark[]>();
  for (const bm of bms) {
    const dest = plan.get(bm.id)!;
    if (!bucket.has(dest)) bucket.set(dest, []);
    bucket.get(dest)!.push(bm);
  }

  let moved = 0;
  for (const bm of bms) {
    const from = bm.category_id === null ? '(미분류)' : (currentPath.get(bm.category_id) ?? '(없는 분류)');
    const to = plan.get(bm.id)!;
    if ((RENAMES[from] ?? from) !== to) moved += 1;
  }

  console.log('■ 적용 뒤 구조');
  let total = 0;
  for (const top of TARGET) {
    const direct = bucket.get(top.name)?.length ?? 0;
    const subCounts = top.subs.map((s) => bucket.get(`${top.name} > ${s}`)?.length ?? 0);
    const sum = direct + subCounts.reduce((a, b) => a + b, 0);
    total += sum;
    console.log(`  ${top.name}  ${sum}건${top.subs.length > 0 ? ` (직속 ${direct})` : ''}`);
    top.subs.forEach((sub, i) => {
      const flag = subCounts[i] > 25 ? '  ⚠ 25건 초과' : subCounts[i] === 0 ? '  ⚠ 비어 있음' : '';
      console.log(`      └ ${sub}  ${subCounts[i]}건${flag}`);
    });
  }
  console.log(`  ─────────── 합계 ${total}건 (원본 ${bms.length}건) · 자리를 옮기는 링크 ${moved}건\n`);

  const dissolved = ['구글 서비스', '참고자료', '참고자료 > 도구·서비스', '참고자료 > 학습·리서치', '기타', 'AI 도구 모음 > 논문', 'AI 도구 모음 > 그 외'];
  console.log(`■ 사라지는 분류: ${dissolved.join(' · ')}`);
  console.log(`■ 이름만 바뀌는 분류: ${Object.entries(RENAMES).map(([a, b]) => `${a} → ${b}`).join(' · ')}\n`);

  if (problems.length > 0) {
    console.log(`■ 문제 ${problems.length}건 — 적용하지 않는다`);
    for (const p of problems) console.log(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log('■ 검증 통과: 규칙이 전부 정확히 한 건과 맞았고, 모든 링크가 목표 분류에 배정됐다\n');

  if (!apply) {
    console.log('드라이런이라 여기서 멈춘다. 적용하려면 --apply 를 붙여라.');

    return;
  }

  // ── ③ 되돌림 스냅샷 ────────────────────────────────────────
  const snapshot = {
    takenAt: new Date().toISOString(),
    note: 'IA 재분류 직전 상태. 되돌리려면 categories 를 이대로 만들고 bookmarks.category_id 를 되돌린다.',
    categories: cats,
    bookmarks: bms.map((b) => ({ id: b.id, title: b.title, categoryPath: b.category_id === null ? null : currentPath.get(b.category_id) })),
  };
  const snapshotPath = `reclassify-snapshot-${snapshot.takenAt.replace(/[:.]/g, '-')}.json`;
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`① 스냅샷 저장: ${snapshotPath}`);

  // ── ④ 이름 바꾸기 ─────────────────────────────────────────
  for (const [oldPath, newPath] of Object.entries(RENAMES)) {
    const category = cats.find((c) => pathOf(c, byId) === oldPath);
    if (category === undefined) continue;
    const newName = newPath.includes(' > ') ? newPath.split(' > ')[1] : newPath;
    const { error } = await service.from('categories').update({ name: newName }).eq('id', category.id);
    if (error) throw new Error(`이름 변경 실패(${oldPath}): ${error.message}`);
    category.name = newName;
  }
  console.log(`② 이름 변경 ${Object.keys(RENAMES).length}건`);

  // ── ⑤ 없는 분류 만들기 ────────────────────────────────────
  const idOfPath = new Map<string, string>();
  for (const c of cats) idOfPath.set(pathOf(c, byId), c.id);

  let created = 0;
  for (const [order, top] of TARGET.entries()) {
    let topId = idOfPath.get(top.name);
    if (topId === undefined) {
      const { data, error } = await service
        .from('categories')
        .insert({ name: top.name, parent_id: null, sort_order: order })
        .select('id')
        .single();
      if (error || !data) throw new Error(`상위 생성 실패(${top.name}): ${error?.message}`);
      topId = data.id as string;
      idOfPath.set(top.name, topId);
      created += 1;
    } else {
      await service.from('categories').update({ sort_order: order }).eq('id', topId);
    }

    for (const [subOrder, sub] of top.subs.entries()) {
      const path = `${top.name} > ${sub}`;
      const existing = idOfPath.get(path);
      if (existing === undefined) {
        const { data, error } = await service
          .from('categories')
          .insert({ name: sub, parent_id: topId, sort_order: subOrder })
          .select('id')
          .single();
        if (error || !data) throw new Error(`하위 생성 실패(${path}): ${error?.message}`);
        idOfPath.set(path, data.id as string);
        created += 1;
      } else {
        await service.from('categories').update({ sort_order: subOrder }).eq('id', existing);
      }
    }
  }
  console.log(`③ 분류 생성 ${created}개 · 순서 재지정 완료`);

  // ── ⑥ 링크 옮기기 ─────────────────────────────────────────
  const byDest = new Map<string, string[]>();
  for (const [bookmarkId, dest] of plan) {
    if (!byDest.has(dest)) byDest.set(dest, []);
    byDest.get(dest)!.push(bookmarkId);
  }

  let updated = 0;
  for (const [dest, ids] of byDest) {
    const categoryId = idOfPath.get(dest);
    if (categoryId === undefined) throw new Error(`목표 분류 id 를 못 찾음: ${dest}`);
    // PostgREST 의 `in` 은 URL 길이 제한이 있어 나눠 보낸다.
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const { error } = await service.from('bookmarks').update({ category_id: categoryId }).in('id', chunk);
      if (error) throw new Error(`링크 이동 실패(${dest}): ${error.message}`);
      updated += chunk.length;
    }
  }
  console.log(`④ 링크 이동 ${updated}건`);

  // ── ⑦ 빈 분류 지우기 (하위 먼저 — on delete set null 이 하위를 최상위로 올리기 때문) ──
  const { data: after } = await service.from('categories').select('id, name, parent_id, sort_order');
  const { data: afterBms } = await service.from('bookmarks').select('category_id');
  const afterCats = (after ?? []) as Category[];
  const afterById = new Map(afterCats.map((c) => [c.id, c]));
  const used = new Set((afterBms ?? []).map((b) => b.category_id));

  const doomed = afterCats.filter((c) => !targetPaths.has(pathOf(c, afterById)));
  const stuck = doomed.filter((c) => used.has(c.id));
  if (stuck.length > 0) {
    throw new Error(`링크가 남아 있는 분류를 지우려 했다: ${stuck.map((c) => c.name).join(', ')}`);
  }

  for (const c of doomed.filter((x) => x.parent_id !== null)) {
    const { error } = await service.from('categories').delete().eq('id', c.id);
    if (error) throw new Error(`하위 삭제 실패(${c.name}): ${error.message}`);
  }
  for (const c of doomed.filter((x) => x.parent_id === null)) {
    const { error } = await service.from('categories').delete().eq('id', c.id);
    if (error) throw new Error(`상위 삭제 실패(${c.name}): ${error.message}`);
  }
  console.log(`⑤ 빈 분류 삭제 ${doomed.length}개`);
  console.log('\n완료. `npx tsx scripts/reclassify.ts` 를 다시 돌리면 현재 상태를 확인할 수 있다.');
}

main().catch((error) => {
  console.error(`오류: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
