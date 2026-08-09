/**
 * FavDash - Favorite Sites Dashboard Application Logic
 */

// Initial seed websites
const DEFAULT_SITES = [
    {
        id: "github",
        title: "GitHub",
        url: "https://github.com",
        category: "ai-dev",
        description: "코드 호스팅, 버전 관리, 소프트웨어 개발 플랫폼",
        tags: ["개발", "Git", "오픈소스"],
        pinned: true,
        iconClass: "fa-brands fa-github",
        views: 42
    },
    {
        id: "chatgpt",
        title: "ChatGPT",
        url: "https://chatgpt.com",
        category: "ai-dev",
        description: "OpenAI 대화형 인공지능 모델 및 어시스턴트",
        tags: ["AI", "LLM", "생산성"],
        pinned: true,
        iconClass: "fa-solid fa-robot",
        views: 89
    },
    {
        id: "claude",
        title: "Claude AI",
        url: "https://claude.ai",
        category: "ai-dev",
        description: "Anthropic의 안전하고 뛰어난 인공지능 추론 모델",
        tags: ["AI", "코드작성", "분석"],
        pinned: true,
        iconClass: "fa-solid fa-brain",
        views: 65
    },
    {
        id: "naver",
        title: "네이버",
        url: "https://www.naver.com",
        category: "community",
        description: "대한민국 대표 포털 및 뉴스, 검색 서비스",
        tags: ["포털", "뉴스", "검색"],
        pinned: true,
        iconClass: "fa-solid fa-bold",
        views: 120
    },
    {
        id: "google",
        title: "Google",
        url: "https://www.google.com",
        category: "productivity",
        description: "전 세계 최대 검색 엔진 및 클라우드 웹 서비스",
        tags: ["검색", "웹", "구글"],
        pinned: true,
        iconClass: "fa-brands fa-google",
        views: 150
    },
    {
        id: "youtube",
        title: "YouTube",
        url: "https://www.youtube.com",
        category: "design",
        description: "동영상 공유 및 라이브 스트리밍 글로벌 플랫폼",
        tags: ["미디어", "영상", "콘텐츠"],
        pinned: false,
        iconClass: "fa-brands fa-youtube",
        views: 95
    },
    {
        id: "notion",
        title: "Notion",
        url: "https://www.notion.so",
        category: "productivity",
        description: "올인원 워크스페이스 (메모, 문서, 프로젝트 관리)",
        tags: ["생산성", "문서", "협업"],
        pinned: false,
        iconClass: "fa-solid fa-note-sticky",
        views: 54
    },
    {
        id: "figma",
        title: "Figma",
        url: "https://www.figma.com",
        category: "design",
        description: "협업 가능한 프로토타이핑 및 UI/UX 디자인 툴",
        tags: ["디자인", "UI/UX", "프로토타입"],
        pinned: false,
        iconClass: "fa-brands fa-figma",
        views: 38
    },
    {
        id: "stackoverflow",
        title: "Stack Overflow",
        url: "https://stackoverflow.com",
        category: "ai-dev",
        description: "개발자를 위한 질문 및 답변 지식 공유 커뮤니티",
        tags: ["개발", "Q&A", "디버깅"],
        pinned: false,
        iconClass: "fa-brands fa-stack-overflow",
        views: 71
    },
    {
        id: "vercel",
        title: "Vercel",
        url: "https://vercel.com",
        category: "ai-dev",
        description: "웹 애플리케이션 프론트엔드 배포 및 호스팅 서비스",
        tags: ["배포", "Next.js", "호스팅"],
        pinned: false,
        iconClass: "fa-solid fa-cloud-arrow-up",
        views: 29
    }
];

class FavDashApp {
    constructor() {
        this.sites = this.loadSites();
        this.currentCategory = "all";
        this.searchQuery = "";
        this.selectedEngine = "google";
        this.currentTheme = localStorage.getItem("favdash_theme") || "dark";
        
        this.initDOM();
        this.bindEvents();
        this.render();
    }

    loadSites() {
        const saved = localStorage.getItem("favdash_sites");
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                console.error("Failed to parse saved sites", e);
            }
        }
        return DEFAULT_SITES;
    }

    saveSites() {
        localStorage.setItem("favdash_sites", JSON.stringify(this.sites));
    }

    initDOM() {
        // Elements
        this.sitesGrid = document.getElementById("sites-grid");
        this.pinnedGrid = document.getElementById("pinned-grid");
        this.pinnedSection = document.getElementById("pinned-section");
        this.emptyState = document.getElementById("empty-state");
        this.searchInput = document.getElementById("search-input");
        this.clearSearchBtn = document.getElementById("clear-search-btn");
        this.sortSelect = document.getElementById("sort-select");
        
        // Category nav
        this.navButtons = document.querySelectorAll(".nav-item");
        this.currentCategoryTitle = document.getElementById("current-category-title");
        
        // Search Engine Dropdown
        this.activeEngineBtn = document.getElementById("active-engine-btn");
        this.engineDropdown = document.getElementById("engine-dropdown");
        this.engineOptions = document.querySelectorAll(".engine-option");
        
        // Modal
        this.siteModal = document.getElementById("site-modal");
        this.siteForm = document.getElementById("site-form");
        this.modalTitle = document.getElementById("modal-title");
        this.btnAddModal = document.getElementById("btn-add-modal");
        this.btnAddEmpty = document.getElementById("btn-add-empty");
        this.modalCloseBtn = document.getElementById("modal-close-btn");
        this.modalCancelBtn = document.getElementById("modal-cancel-btn");
        
        // Theme
        this.themeToggleBtn = document.getElementById("theme-toggle-btn");
        this.themeIcon = document.getElementById("theme-icon");
        this.themeText = document.getElementById("theme-text");
        
        // Backup / Restore
        this.btnExport = document.getElementById("btn-export");
        this.btnImport = document.getElementById("btn-import");
        this.importFileInput = document.getElementById("import-file-input");
        
        // Toast
        this.toast = document.getElementById("toast-notification");
        
        // Apply saved theme
        this.applyTheme(this.currentTheme);
        this.updateGreeting();
    }

    bindEvents() {
        // Search & Keyboard Shortcut
        this.searchInput.addEventListener("input", (e) => {
            this.searchQuery = e.target.value.toLowerCase().trim();
            this.clearSearchBtn.style.display = this.searchQuery ? "block" : "none";
            this.render();
        });

        this.clearSearchBtn.addEventListener("click", () => {
            this.searchInput.value = "";
            this.searchQuery = "";
            this.clearSearchBtn.style.display = "none";
            this.render();
        });

        this.searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && this.searchQuery) {
                // Check if matches internal sites
                const matches = this.getFilteredSites();
                if (matches.length === 0) {
                    // Open web search
                    this.performWebSearch(this.searchQuery);
                }
            }
        });

        document.addEventListener("keydown", (e) => {
            if (e.key === "/" && document.activeElement !== this.searchInput && !this.isModalOpen()) {
                e.preventDefault();
                this.searchInput.focus();
            }
        });

        // Search engine toggle
        this.activeEngineBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.engineDropdown.classList.toggle("show");
        });

        document.addEventListener("click", () => {
            this.engineDropdown.classList.remove("show");
        });

        this.engineOptions.forEach(opt => {
            opt.addEventListener("click", (e) => {
                e.stopPropagation();
                this.engineOptions.forEach(o => o.classList.remove("active"));
                opt.classList.add("active");
                this.selectedEngine = opt.getAttribute("data-engine");
                const iconClass = opt.getAttribute("data-icon");
                this.activeEngineBtn.innerHTML = `<i class="${iconClass}"></i> <i class="fa-solid fa-chevron-down dropdown-arrow"></i>`;
                this.engineDropdown.classList.remove("show");
            });
        });

        // Navigation Category Click
        this.navButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                this.navButtons.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                this.currentCategory = btn.getAttribute("data-category");
                this.render();
            });
        });

        // Sort Select
        this.sortSelect.addEventListener("change", () => {
            this.render();
        });

        // Theme Toggle
        this.themeToggleBtn.addEventListener("click", () => {
            this.currentTheme = this.currentTheme === "dark" ? "light" : "dark";
            this.applyTheme(this.currentTheme);
        });

        // Modal Open / Close
        this.btnAddModal.addEventListener("click", () => this.openModal());
        if (this.btnAddEmpty) {
            this.btnAddEmpty.addEventListener("click", () => this.openModal());
        }
        this.modalCloseBtn.addEventListener("click", () => this.closeModal());
        this.modalCancelBtn.addEventListener("click", () => this.closeModal());

        this.siteModal.addEventListener("click", (e) => {
            if (e.target === this.siteModal) this.closeModal();
        });

        // Site Form Submit
        this.siteForm.addEventListener("submit", (e) => {
            e.preventDefault();
            this.handleFormSubmit();
        });

        // Import & Export
        this.btnExport.addEventListener("click", () => this.exportData());
        this.btnImport.addEventListener("click", () => this.importFileInput.click());
        this.importFileInput.addEventListener("change", (e) => this.importData(e));
    }

    isModalOpen() {
        return this.siteModal.style.display === "flex";
    }

    applyTheme(theme) {
        document.body.className = theme === "light" ? "light-theme" : "dark-theme";
        localStorage.setItem("favdash_theme", theme);
        
        if (theme === "light") {
            this.themeIcon.className = "fa-solid fa-sun";
            this.themeText.innerText = "라이트 모드";
        } else {
            this.themeIcon.className = "fa-solid fa-moon";
            this.themeText.innerText = "다크 모드";
        }
    }

    updateGreeting() {
        const dateElem = document.getElementById("current-date-str");
        const greetingElem = document.getElementById("greeting-title");
        
        const now = new Date();
        const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
        dateElem.innerText = `${now.toLocaleDateString('ko-KR', options)}`;
        
        const hour = now.getHours();
        if (hour < 12) {
            greetingElem.innerText = "상쾌한 아침입니다! ☀️";
        } else if (hour < 18) {
            greetingElem.innerText = "알찬 오후 보내세요! 🚀";
        } else {
            greetingElem.innerText = "편안한 저녁 되세요! 🌙";
        }
    }

    getCategoryName(catKey) {
        const names = {
            "all": "전체 사이트",
            "ai-dev": "AI & 개발 사이트",
            "productivity": "생산성 & 업무 사이트",
            "design": "디자인 & 미디어 사이트",
            "community": "뉴스 & 커뮤니티 사이트",
            "pinned": "고정된 즐겨찾기"
        };
        return names[catKey] || "웹 사이트";
    }

    getFilteredSites() {
        return this.sites.filter(site => {
            // Category filter
            if (this.currentCategory === "pinned" && !site.pinned) return false;
            if (this.currentCategory !== "all" && this.currentCategory !== "pinned" && site.category !== this.currentCategory) return false;
            
            // Search query filter
            if (this.searchQuery) {
                const titleMatch = site.title.toLowerCase().includes(this.searchQuery);
                const urlMatch = site.url.toLowerCase().includes(this.searchQuery);
                const descMatch = (site.description || "").toLowerCase().includes(this.searchQuery);
                const tagMatch = (site.tags || []).some(t => t.toLowerCase().includes(this.searchQuery));
                return titleMatch || urlMatch || descMatch || tagMatch;
            }
            return true;
        });
    }

    sortSites(sitesList) {
        const sortVal = this.sortSelect.value;
        const list = [...sitesList];
        
        if (sortVal === "name") {
            list.sort((a, b) => a.title.localeCompare(b.title));
        } else if (sortVal === "views") {
            list.sort((a, b) => (b.views || 0) - (a.views || 0));
        } else if (sortVal === "newest") {
            list.reverse();
        }
        return list;
    }

    render() {
        this.updateCategoryCounts();
        this.currentCategoryTitle.innerText = this.getCategoryName(this.currentCategory);
        
        // Pinned render
        const pinnedSites = this.sites.filter(s => s.pinned);
        if (pinnedSites.length > 0 && this.currentCategory !== "pinned") {
            this.pinnedSection.style.display = "block";
            this.renderPinned(pinnedSites);
        } else {
            this.pinnedSection.style.display = "none";
        }

        // Main Sites render
        const filtered = this.getFilteredSites();
        const sorted = this.sortSites(filtered);

        if (sorted.length === 0) {
            this.sitesGrid.innerHTML = "";
            this.emptyState.style.display = "block";
        } else {
            this.emptyState.style.display = "none";
            this.renderSitesGrid(sorted);
        }
    }

    updateCategoryCounts() {
        document.getElementById("count-all").innerText = this.sites.length;
        document.getElementById("count-ai-dev").innerText = this.sites.filter(s => s.category === "ai-dev").length;
        document.getElementById("count-productivity").innerText = this.sites.filter(s => s.category === "productivity").length;
        document.getElementById("count-design").innerText = this.sites.filter(s => s.category === "design").length;
        document.getElementById("count-community").innerText = this.sites.filter(s => s.category === "community").length;
        document.getElementById("count-pinned").innerText = this.sites.filter(s => s.pinned).length;
    }

    renderPinned(pinnedSites) {
        this.pinnedGrid.innerHTML = pinnedSites.map(site => {
            const domain = this.extractDomain(site.url);
            const icon = site.iconClass || "fa-solid fa-globe";
            return `
                <a href="${site.url}" target="_blank" class="pinned-card" data-id="${site.id}">
                    <div class="pinned-icon-wrapper">
                        <i class="${icon}"></i>
                    </div>
                    <div class="pinned-info">
                        <div class="pinned-title">${this.escapeHTML(site.title)}</div>
                        <div class="pinned-domain">${domain}</div>
                    </div>
                </a>
            `;
        }).join("");

        // Add view count click handler
        this.pinnedGrid.querySelectorAll(".pinned-card").forEach(el => {
            el.addEventListener("click", () => {
                const id = el.getAttribute("data-id");
                this.incrementViewCount(id);
            });
        });
    }

    renderSitesGrid(sitesList) {
        this.sitesGrid.innerHTML = sitesList.map(site => {
            const domain = this.extractDomain(site.url);
            const icon = site.iconClass || "fa-solid fa-globe";
            const tagsHTML = (site.tags || []).map(t => `<span class="tag-pill">#${this.escapeHTML(t)}</span>`).join("");
            const isPinActive = site.pinned ? "active-pin" : "";

            return `
                <div class="site-card" data-id="${site.id}">
                    <div class="site-card-top">
                        <div class="site-icon-box">
                            <i class="${icon}"></i>
                        </div>
                        <div class="site-card-actions">
                            <button class="action-btn pin-btn ${isPinActive}" title="${site.pinned ? '고정 해제' : '상단 고정'}" data-id="${site.id}">
                                <i class="fa-solid fa-thumbtack"></i>
                            </button>
                            <button class="action-btn edit-btn" title="수정" data-id="${site.id}">
                                <i class="fa-solid fa-pen"></i>
                            </button>
                            <button class="action-btn delete-btn" title="삭제" data-id="${site.id}">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </div>

                    <div class="site-card-body">
                        <h3 class="site-title">${this.escapeHTML(site.title)}</h3>
                        <p class="site-desc">${this.escapeHTML(site.description || '등록된 설명이 없습니다.')}</p>
                        <div class="site-tags">${tagsHTML}</div>
                    </div>

                    <div class="site-card-bottom">
                        <a href="${site.url}" target="_blank" class="site-visit-link" data-id="${site.id}">
                            방문하기 <i class="fa-solid fa-arrow-up-right-from-square"></i>
                        </a>
                        <span class="site-views"><i class="fa-regular fa-eye"></i> ${site.views || 0}</span>
                    </div>
                </div>
            `;
        }).join("");

        // Bind Card Actions
        this.sitesGrid.querySelectorAll(".pin-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.togglePin(btn.getAttribute("data-id"));
            });
        });

        this.sitesGrid.querySelectorAll(".edit-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.openModal(btn.getAttribute("data-id"));
            });
        });

        this.sitesGrid.querySelectorAll(".delete-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.deleteSite(btn.getAttribute("data-id"));
            });
        });

        this.sitesGrid.querySelectorAll(".site-visit-link").forEach(link => {
            link.addEventListener("click", () => {
                this.incrementViewCount(link.getAttribute("data-id"));
            });
        });
    }

    extractDomain(urlStr) {
        try {
            const url = new URL(urlStr);
            return url.hostname.replace('www.', '');
        } catch (e) {
            return urlStr;
        }
    }

    togglePin(id) {
        const site = this.sites.find(s => s.id === id);
        if (site) {
            site.pinned = !site.pinned;
            this.saveSites();
            this.render();
            this.showToast(site.pinned ? `'${site.title}'이(가) 상단에 고정되었습니다.` : `'${site.title}' 고정이 해제되었습니다.`);
        }
    }

    deleteSite(id) {
        const site = this.sites.find(s => s.id === id);
        if (site && confirm(`'${site.title}' 사이트를 삭제하시겠습니까?`)) {
            this.sites = this.sites.filter(s => s.id !== id);
            this.saveSites();
            this.render();
            this.showToast(`'${site.title}' 삭제되었습니다.`);
        }
    }

    incrementViewCount(id) {
        const site = this.sites.find(s => s.id === id);
        if (site) {
            site.views = (site.views || 0) + 1;
            this.saveSites();
        }
    }

    openModal(id = null) {
        this.siteModal.style.display = "flex";
        if (id) {
            const site = this.sites.find(s => s.id === id);
            if (site) {
                this.modalTitle.innerHTML = `<i class="fa-solid fa-pen"></i> 사이트 정보 수정`;
                document.getElementById("site-id").value = site.id;
                document.getElementById("site-title").value = site.title;
                document.getElementById("site-url").value = site.url;
                document.getElementById("site-category").value = site.category;
                document.getElementById("site-desc").value = site.description || "";
                document.getElementById("site-tags").value = (site.tags || []).join(", ");
                document.getElementById("site-pinned").checked = !!site.pinned;
            }
        } else {
            this.modalTitle.innerHTML = `<i class="fa-solid fa-link"></i> 새 사이트 추가`;
            this.siteForm.reset();
            document.getElementById("site-id").value = "";
        }
    }

    closeModal() {
        this.siteModal.style.display = "none";
        this.siteForm.reset();
    }

    handleFormSubmit() {
        const id = document.getElementById("site-id").value;
        const title = document.getElementById("site-title").value.trim();
        const url = document.getElementById("site-url").value.trim();
        const category = document.getElementById("site-category").value;
        const description = document.getElementById("site-desc").value.trim();
        const tagsInput = document.getElementById("site-tags").value.trim();
        const pinned = document.getElementById("site-pinned").checked;

        const tags = tagsInput ? tagsInput.split(",").map(t => t.trim()).filter(Boolean) : [];

        // Auto Icon selector based on category / domain
        let iconClass = "fa-solid fa-globe";
        const domain = this.extractDomain(url).toLowerCase();
        if (domain.includes("github")) iconClass = "fa-brands fa-github";
        else if (domain.includes("google")) iconClass = "fa-brands fa-google";
        else if (domain.includes("youtube")) iconClass = "fa-brands fa-youtube";
        else if (domain.includes("naver")) iconClass = "fa-solid fa-bold";
        else if (domain.includes("figma")) iconClass = "fa-brands fa-figma";
        else if (domain.includes("stack")) iconClass = "fa-brands fa-stack-overflow";
        else if (category === "ai-dev") iconClass = "fa-solid fa-code";
        else if (category === "productivity") iconClass = "fa-solid fa-briefcase";
        else if (category === "design") iconClass = "fa-solid fa-palette";
        else if (category === "community") iconClass = "fa-solid fa-comments";

        if (id) {
            // Edit existing
            const site = this.sites.find(s => s.id === id);
            if (site) {
                site.title = title;
                site.url = url;
                site.category = category;
                site.description = description;
                site.tags = tags;
                site.pinned = pinned;
                site.iconClass = iconClass;
                this.showToast(`'${title}' 정보가 수정되었습니다.`);
            }
        } else {
            // Create new
            const newSite = {
                id: "site_" + Date.now(),
                title,
                url,
                category,
                description,
                tags,
                pinned,
                iconClass,
                views: 0
            };
            this.sites.push(newSite);
            this.showToast(`'${title}' 사이트가 추가되었습니다.`);
        }

        this.saveSites();
        this.closeModal();
        this.render();
    }

    performWebSearch(query) {
        let searchUrl = "";
        switch (this.selectedEngine) {
            case "naver":
                searchUrl = `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`;
                break;
            case "bing":
                searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
                break;
            case "duckduckgo":
                searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
                break;
            case "google":
            default:
                searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
                break;
        }
        window.open(searchUrl, "_blank");
    }

    exportData() {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.sites, null, 2));
        const downloadAnchor = document.createElement("a");
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `favdash_backup_${new Date().toISOString().slice(0,10)}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        this.showToast("백업 데이터 파일이 다운로드 되었습니다.");
    }

    importData(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedSites = JSON.parse(event.target.result);
                if (Array.isArray(importedSites)) {
                    this.sites = importedSites;
                    this.saveSites();
                    this.render();
                    this.showToast("즐겨찾기 데이터가 성공적으로 복원되었습니다.");
                } else {
                    alert("올바르지 않은 백업 파일 형식입니다.");
                }
            } catch (err) {
                alert("파일 읽기 오류: " + err.message);
            }
        };
        reader.readAsText(file);
    }

    showToast(msg) {
        this.toast.innerText = msg;
        this.toast.classList.add("show");
        setTimeout(() => {
            this.toast.classList.remove("show");
        }, 3000);
    }

    escapeHTML(str) {
        return (str || "").replace(/[&<>'"]/g, 
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    }
}

// Initialize Application when DOM ready
document.addEventListener("DOMContentLoaded", () => {
    window.favDash = new FavDashApp();
});
