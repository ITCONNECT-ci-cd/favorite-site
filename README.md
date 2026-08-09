# 🌟 FavDash - 즐겨찾기 대시보드 (Favorite Site Dashboard)

자주 방문하는 웹사이트를 카테고리별로 정돈하고 신속하게 접속할 수 있는 반응형 웹 대시보드 애플리케이션입니다.

![GitHub repository](https://img.shields.io/badge/GitHub-ITCONNECT--ci--cd%2Ffavorite--site-blue?logo=github)
![License](https://img.shields.io/badge/License-MIT-green)

---

## ✨ 주요 기능 (Key Features)

1. **🎨 다크 / 라이트 모드 & 글래스모피즘 UI**
   - 모던하고 세련된 Glassmorphic 카드 디자인 및 다크/라이트 테마 지원
2. **🔍 실시간 사이트 검색 & 통합 검색엔진**
   - 사이트 제목, 태그, URL, 설명 실시간 필터링
   - Google, 네이버, Bing, DuckDuckGo 검색 엔진 연동 (단축키 `/` 지원)
3. **📌 빠른 바로가기 (상단 고정)**
   - 자주 방문하는 주요 사이트를 상단 퀵 바에 고정
4. **📁 카테고리 분류 및 정렬**
   - AI & 개발, 생산성 & 업무, 디자인 & 미디어, 뉴스 & 커뮤니티 등 분리
   - 이름순, 방문 횟수순, 최근 추가순 정렬 지원
5. **➕ Custom 사이트 추가/수정/삭제**
   - 사용자 정의 웹사이트 등록 (제목, URL, 설명, 태그, 카테고리 설정)
6. **💾 LocalStorage 자동 저장 & 백업/복원**
   - 브라우저 로컬 저장소 동기화
   - JSON 파일 형식으로 백업 내보내기(Export) 및 복원(Import) 기능 제공

---

## 🚀 시작하기 (Getting Started)

별도의 패키지 설치나 빌드 과정 없이 `index.html` 파일을 브라우저에서 실행하면 바로 사용할 수 있습니다.

```bash
git clone https://github.com/ITCONNECT-ci-cd/favorite-site.git
cd favorite-site
```

---

## 📁 프로젝트 구조 (Project Structure)

```
favorite-site/
├── index.html        # 메인 레이아웃 및 HTML 구조
├── styles.css        # 모던 디자인 시스템 및 테마 스타일시트
├── app.js            # 동적 인터랙션 및 LocalStorage 데이터 관리 로직
└── README.md         # 프로젝트 안내 문서
```

---

## 🛠️ 기술 스택 (Tech Stack)

- **Frontend**: HTML5, CSS3 (Vanilla CSS, CSS Grid & Flexbox), Modern JavaScript (ES6+)
- **Icons**: FontAwesome 6
- **Typography**: Google Fonts (Inter)
