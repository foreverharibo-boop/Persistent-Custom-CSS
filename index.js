import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "persistent-custom-css";
const defaultSettings = { entries: [], folders: [] };

const STYLE_ID = "persistent-custom-css-style";

// "all" | "none" | <folderId> - 세션 동안만 유지되는 필터 상태 (저장 안 함)
let activeFilter = "all";

function genId() {
    return (crypto.randomUUID ? crypto.randomUUID() : `pcc-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function escapeAttr(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function loadSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = structuredClone(defaultSettings);
    }
    const settings = extension_settings[extensionName];

    // 이전 버전(단일 css/enabled) 마이그레이션
    if (!Array.isArray(settings.entries)) {
        const legacyCss = settings.css || "";
        settings.entries = legacyCss
            ? [{ id: genId(), title: "CSS 1", enabled: settings.enabled ?? true, collapsed: false, folderId: null, css: legacyCss }]
            : [];
        delete settings.css;
        delete settings.enabled;
    }

    if (!Array.isArray(settings.folders)) {
        settings.folders = [];
    }

    if (settings.entries.length === 0) {
        settings.entries.push({ id: genId(), title: "CSS 1", enabled: true, collapsed: false, folderId: null, css: "" });
    }

    // 기존 저장 데이터에 없는 필드 채워줌
    for (const entry of settings.entries) {
        if (entry.collapsed === undefined) entry.collapsed = false;
        if (entry.folderId === undefined) entry.folderId = null;
    }
    for (const folder of settings.folders) {
        if (folder.collapsed === undefined) folder.collapsed = false;
    }

    return settings;
}

function applyPersistentCSS() {
    const settings = loadSettings();
    let styleEl = document.getElementById(STYLE_ID);
    if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = STYLE_ID;
        document.head.appendChild(styleEl);
    }
    const combined = settings.entries
        .filter(e => e.enabled && e.css && e.css.trim())
        .map(e => `/* ${e.title || "이름 없음"} */\n${e.css}`)
        .join("\n\n");
    styleEl.textContent = combined;
}

// 테마 프리셋이 바뀌면서 다른 style/link가 head에 새로 삽입되어도
// 항상 맨 마지막에 위치시켜서 캐스케이드 우선순위를 유지
function keepStyleOnTop() {
    const observer = new MutationObserver(() => {
        const styleEl = document.getElementById(STYLE_ID);
        if (styleEl && document.head.lastElementChild !== styleEl) {
            document.head.appendChild(styleEl);
        }
    });
    observer.observe(document.head, { childList: true });
}

function updateMasterToggle() {
    const settings = loadSettings();
    const allOn = settings.entries.length > 0 && settings.entries.every(e => e.enabled);
    $("#pcc-master-toggle").prop("checked", allOn);
}

function buildEntryHtml(entry, folders) {
    const isCollapsed = !!entry.collapsed;
    const folderOptions = folders.map(f =>
        `<option value="${f.id}" ${entry.folderId === f.id ? "selected" : ""}>${escapeAttr(f.title)}</option>`
    ).join("");

    return `
    <div class="pcc-entry${isCollapsed ? " pcc-collapsed" : ""}" data-id="${entry.id}">
        <div class="pcc-entry-header">
            <button type="button" class="pcc-entry-collapse" title="접기/펼치기">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                    <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
            <input type="text" class="pcc-entry-title" value="${escapeAttr(entry.title)}" placeholder="이름 없음">
            <div class="pcc-entry-controls">
                ${folders.length > 0 ? `
                <select class="pcc-entry-folder" title="폴더로 이동">
                    <option value="">폴더 없음</option>
                    ${folderOptions}
                </select>` : ""}
                <label class="pcc-switch">
                    <input type="checkbox" class="pcc-entry-enabled" ${entry.enabled ? "checked" : ""}>
                    <span class="pcc-track"><span class="pcc-thumb"></span></span>
                </label>
                <button type="button" class="pcc-entry-delete" title="삭제">✕</button>
            </div>
        </div>
        <textarea class="pcc-entry-css" spellcheck="false" placeholder="여기에 CSS 입력">${entry.css}</textarea>
    </div>`;
}

function renderFilterBar(settings) {
    const $bar = $("#pcc-filter-bar");
    $bar.empty();

    if (settings.folders.length === 0) {
        $bar.hide();
        return;
    }
    $bar.show();

    const pills = [
        { id: "all", label: "전체" },
        ...settings.folders.map(f => ({ id: f.id, label: f.title || "이름 없음" })),
        { id: "none", label: "미분류" },
    ];

    pills.forEach(p => {
        const active = activeFilter === p.id;
        $bar.append(
            `<button type="button" class="pcc-filter-pill${active ? " active" : ""}" data-filter="${escapeAttr(p.id)}">${escapeAttr(p.label)}</button>`
        );
    });
}

function renderEntries() {
    const settings = loadSettings();

    // 필터로 걸어둔 폴더가 삭제됐으면 전체 보기로 되돌림
    if (activeFilter !== "all" && activeFilter !== "none" && !settings.folders.some(f => f.id === activeFilter)) {
        activeFilter = "all";
    }

    renderFilterBar(settings);

    const $list = $("#pcc-list");
    $list.empty();

    if (activeFilter === "none") {
        settings.entries
            .filter(e => !e.folderId)
            .forEach(entry => $list.append(buildEntryHtml(entry, settings.folders)));
        return;
    }

    if (activeFilter !== "all") {
        settings.entries
            .filter(e => e.folderId === activeFilter)
            .forEach(entry => $list.append(buildEntryHtml(entry, settings.folders)));
        return;
    }

    // 전체 보기: 폴더 먼저, 그다음 폴더 미지정 항목
    settings.folders.forEach((folder) => {
        const isCollapsed = !!folder.collapsed;
        const $folder = $(`
        <div class="pcc-folder${isCollapsed ? " pcc-collapsed" : ""}" data-folder-id="${folder.id}">
            <div class="pcc-folder-header">
                <button type="button" class="pcc-folder-collapse" title="접기/펼치기">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                        <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
                <span class="pcc-folder-icon">📁</span>
                <input type="text" class="pcc-folder-title" value="${escapeAttr(folder.title)}" placeholder="폴더 이름">
                <button type="button" class="pcc-folder-delete" title="폴더 삭제 (안의 항목은 유지됨)">✕</button>
            </div>
            <div class="pcc-folder-body">
                <div class="pcc-folder-entries"></div>
            </div>
        </div>`);
        const $entriesBox = $folder.find(".pcc-folder-entries");
        settings.entries
            .filter(e => e.folderId === folder.id)
            .forEach(entry => $entriesBox.append(buildEntryHtml(entry, settings.folders)));
        $list.append($folder);
    });

    settings.entries
        .filter(e => !e.folderId)
        .forEach(entry => $list.append(buildEntryHtml(entry, settings.folders)));
}

function addSettingsUI() {
    // ST 기본 inline-drawer 구조 사용 -> 다른 확장 항목들과 동일하게
    // 이름 + 화살표로 접힌 채 리스트에 표시되고, 클릭하면 펼쳐짐
    const html = `
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Persistent Custom CSS</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <div class="pcc-inner">
                <div class="pcc-master-row">
                    <span class="pcc-master-label">전체 켜기/끄기</span>
                    <label class="pcc-switch pcc-switch-sm">
                        <input type="checkbox" id="pcc-master-toggle">
                        <span class="pcc-track"><span class="pcc-thumb"></span></span>
                    </label>
                </div>
                <div id="pcc-filter-bar" class="pcc-filter-bar"></div>
                <div id="pcc-list"></div>
                <div class="pcc-btn-row">
                    <button type="button" id="pcc-add" class="pcc-add-btn">+ CSS 항목 추가</button>
                    <button type="button" id="pcc-add-folder" class="pcc-add-btn">+ 폴더 추가</button>
                </div>
            </div>
        </div>
    </div>`;

    $("#extensions_settings2").append(html);
    renderEntries();
    updateMasterToggle();

    const $list = $("#pcc-list");

    $("#pcc-filter-bar").on("click", ".pcc-filter-pill", function () {
        activeFilter = $(this).data("filter");
        renderEntries();
    });

    $list.on("input", ".pcc-entry-title", function () {
        const id = $(this).closest(".pcc-entry").data("id");
        const settings = loadSettings();
        const entry = settings.entries.find(e => e.id === id);
        if (entry) {
            entry.title = $(this).val();
            saveSettingsDebounced();
        }
    });

    $list.on("input", ".pcc-entry-css", function () {
        const id = $(this).closest(".pcc-entry").data("id");
        const settings = loadSettings();
        const entry = settings.entries.find(e => e.id === id);
        if (entry) {
            entry.css = $(this).val();
            saveSettingsDebounced();
            applyPersistentCSS();
        }
    });

    $list.on("change", ".pcc-entry-enabled", function () {
        const id = $(this).closest(".pcc-entry").data("id");
        const settings = loadSettings();
        const entry = settings.entries.find(e => e.id === id);
        if (entry) {
            entry.enabled = $(this).is(":checked");
            saveSettingsDebounced();
            applyPersistentCSS();
            updateMasterToggle();
        }
    });

    $list.on("click", ".pcc-entry-collapse", function () {
        const id = $(this).closest(".pcc-entry").data("id");
        const settings = loadSettings();
        const entry = settings.entries.find(e => e.id === id);
        if (entry) {
            entry.collapsed = !entry.collapsed;
            $(this).closest(".pcc-entry").toggleClass("pcc-collapsed", entry.collapsed);
            saveSettingsDebounced();
        }
    });

    $list.on("change", ".pcc-entry-folder", function () {
        const id = $(this).closest(".pcc-entry").data("id");
        const settings = loadSettings();
        const entry = settings.entries.find(e => e.id === id);
        if (entry) {
            entry.folderId = $(this).val() || null;
            saveSettingsDebounced();
            renderEntries();
        }
    });

    $list.on("click", ".pcc-entry-delete", function () {
        const id = $(this).closest(".pcc-entry").data("id");
        const settings = loadSettings();
        settings.entries = settings.entries.filter(e => e.id !== id);
        if (settings.entries.length === 0) {
            settings.entries.push({ id: genId(), title: "CSS 1", enabled: true, collapsed: false, folderId: null, css: "" });
        }
        saveSettingsDebounced();
        applyPersistentCSS();
        renderEntries();
        updateMasterToggle();
    });

    $list.on("input", ".pcc-folder-title", function () {
        const id = $(this).closest(".pcc-folder").data("folder-id");
        const settings = loadSettings();
        const folder = settings.folders.find(f => f.id === id);
        if (folder) {
            folder.title = $(this).val();
            saveSettingsDebounced();
        }
    });

    $list.on("click", ".pcc-folder-collapse", function () {
        const id = $(this).closest(".pcc-folder").data("folder-id");
        const settings = loadSettings();
        const folder = settings.folders.find(f => f.id === id);
        if (folder) {
            folder.collapsed = !folder.collapsed;
            $(this).closest(".pcc-folder").toggleClass("pcc-collapsed", folder.collapsed);
            saveSettingsDebounced();
        }
    });

    $list.on("click", ".pcc-folder-delete", function () {
        const id = $(this).closest(".pcc-folder").data("folder-id");
        const settings = loadSettings();
        settings.folders = settings.folders.filter(f => f.id !== id);
        settings.entries.forEach(e => { if (e.folderId === id) e.folderId = null; });
        saveSettingsDebounced();
        applyPersistentCSS();
        renderEntries();
    });

    $("#pcc-add").on("click", function () {
        const settings = loadSettings();
        settings.entries.push({
            id: genId(),
            title: `CSS ${settings.entries.length + 1}`,
            enabled: true,
            collapsed: false,
            folderId: null,
            css: "",
        });
        saveSettingsDebounced();
        renderEntries();
        updateMasterToggle();
    });

    $("#pcc-add-folder").on("click", function () {
        const settings = loadSettings();
        settings.folders.push({
            id: genId(),
            title: `폴더 ${settings.folders.length + 1}`,
            collapsed: false,
        });
        saveSettingsDebounced();
        renderEntries();
    });

    $("#pcc-master-toggle").on("change", function () {
        const checked = $(this).is(":checked");
        const settings = loadSettings();
        settings.entries.forEach(e => { e.enabled = checked; });
        saveSettingsDebounced();
        applyPersistentCSS();
        renderEntries();
        updateMasterToggle();
    });
}

jQuery(async () => {
    loadSettings();
    addSettingsUI();
    applyPersistentCSS();
    keepStyleOnTop();
});
