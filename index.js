import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "persistent-custom-css";
const defaultSettings = { entries: [] };

const STYLE_ID = "persistent-custom-css-style";

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
            ? [{ id: genId(), title: "CSS 1", enabled: settings.enabled ?? true, css: legacyCss }]
            : [];
        delete settings.css;
        delete settings.enabled;
    }

    if (settings.entries.length === 0) {
        settings.entries.push({ id: genId(), title: "CSS 1", enabled: true, css: "" });
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

function renderEntries() {
    const settings = loadSettings();
    const $list = $("#pcc-list");
    $list.empty();

    settings.entries.forEach((entry) => {
        const html = `
        <div class="pcc-entry" data-id="${entry.id}">
            <div class="pcc-entry-header">
                <input type="text" class="pcc-entry-title" value="${escapeAttr(entry.title)}" placeholder="이름 없음">
                <div class="pcc-entry-controls">
                    <label class="pcc-switch">
                        <input type="checkbox" class="pcc-entry-enabled" ${entry.enabled ? "checked" : ""}>
                        <span class="pcc-track"><span class="pcc-thumb"></span></span>
                    </label>
                    <button type="button" class="pcc-entry-delete" title="삭제">✕</button>
                </div>
            </div>
            <textarea class="pcc-entry-css" spellcheck="false" placeholder="여기에 CSS 입력">${entry.css}</textarea>
        </div>`;
        $list.append(html);
    });
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
                <div id="pcc-list"></div>
                <button type="button" id="pcc-add" class="pcc-add-btn">+ CSS 항목 추가</button>
            </div>
        </div>
    </div>`;

    $("#extensions_settings2").append(html);
    renderEntries();
    updateMasterToggle();

    const $list = $("#pcc-list");

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

    $list.on("click", ".pcc-entry-delete", function () {
        const id = $(this).closest(".pcc-entry").data("id");
        const settings = loadSettings();
        settings.entries = settings.entries.filter(e => e.id !== id);
        if (settings.entries.length === 0) {
            settings.entries.push({ id: genId(), title: `CSS ${settings.entries.length + 1}`, enabled: true, css: "" });
        }
        saveSettingsDebounced();
        applyPersistentCSS();
        renderEntries();
        updateMasterToggle();
    });

    $("#pcc-add").on("click", function () {
        const settings = loadSettings();
        settings.entries.push({
            id: genId(),
            title: `CSS ${settings.entries.length + 1}`,
            enabled: true,
            css: "",
        });
        saveSettingsDebounced();
        renderEntries();
        updateMasterToggle();
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
