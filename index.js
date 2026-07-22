import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from "../../../popup.js";

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

    // 각 폴더 토글도 그 폴더 안 항목이 전부 켜졌을 때만 켜진 상태로 맞춰줌
    settings.folders.forEach(folder => {
        const folderEntries = settings.entries.filter(e => e.folderId === folder.id);
        const folderAllOn = folderEntries.length > 0 && folderEntries.every(e => e.enabled);
        $(`.pcc-folder[data-folder-id="${folder.id}"] .pcc-folder-toggle`).prop("checked", folderAllOn);
    });
}

function buildEntryHtml(entry, folders) {
    const isCollapsed = !!entry.collapsed;
    const folderOptions = folders.map(f =>
        `<option value="${f.id}" ${entry.folderId === f.id ? "selected" : ""}>📁 ${escapeAttr(f.title)}</option>`
    ).join("");

    return `
    <div class="pcc-entry${isCollapsed ? " pcc-collapsed" : ""}" data-id="${entry.id}">
        <div class="pcc-entry-header">
            <button type="button" class="pcc-entry-collapse" title="접기/펼치기">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                    <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
            <span class="pcc-drag-handle" title="드래그해서 순서 변경">⠿</span>
            <input type="text" class="pcc-entry-title" value="${escapeAttr(entry.title)}" placeholder="이름 없음">
            <div class="pcc-entry-controls">
                ${folders.length > 0 ? `
                <select class="pcc-entry-folder" title="폴더로 이동">
                    <option value="">📂 폴더 없음</option>
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
                <span class="pcc-drag-handle pcc-folder-drag-handle" title="드래그해서 순서 변경">⠿</span>
                <span class="pcc-folder-icon">📁</span>
                <input type="text" class="pcc-folder-title" value="${escapeAttr(folder.title)}" placeholder="폴더 이름">
                <label class="pcc-switch pcc-switch-sm pcc-folder-toggle-wrap">
                    <input type="checkbox" class="pcc-folder-toggle">
                    <span class="pcc-track"><span class="pcc-thumb"></span></span>
                </label>
                <button type="button" class="pcc-folder-delete" title="폴더 삭제 (안의 항목은 유지됨)">✕</button>
            </div>
            <div class="pcc-folder-body">
                <div class="pcc-folder-entries"></div>
            </div>
        </div>`);
        const $entriesBox = $folder.find(".pcc-folder-entries");
        const folderEntries = settings.entries.filter(e => e.folderId === folder.id);
        folderEntries.forEach(entry => $entriesBox.append(buildEntryHtml(entry, settings.folders)));
        const allOn = folderEntries.length > 0 && folderEntries.every(e => e.enabled);
        $folder.find(".pcc-folder-toggle").prop("checked", allOn);
        $list.append($folder);
    });

    settings.entries
        .filter(e => !e.folderId)
        .forEach(entry => $list.append(buildEntryHtml(entry, settings.folders)));

    initSortable();
}

// 드래그로 DOM 순서가 바뀐 뒤, 화면에 보이는 순서대로 settings.entries / folders를 다시 정렬
function syncOrderFromDom() {
    const settings = loadSettings();
    const $list = $("#pcc-list");

    // 폴더 순서: 리스트에 나타난 .pcc-folder 순서대로
    const folderOrder = $list.children(".pcc-folder").map(function () {
        return $(this).data("folder-id");
    }).get();
    if (folderOrder.length) {
        settings.folders.sort((a, b) => folderOrder.indexOf(a.id) - folderOrder.indexOf(b.id));
    }

    // 항목 순서: 각 항목의 화면상 위치 + 소속 폴더를 읽어 재구성
    const orderedEntries = [];
    // 폴더 안 항목
    $list.children(".pcc-folder").each(function () {
        const folderId = $(this).data("folder-id");
        $(this).find(".pcc-folder-entries > .pcc-entry").each(function () {
            const id = $(this).data("id");
            const entry = settings.entries.find(e => e.id === id);
            if (entry) {
                entry.folderId = folderId;
                orderedEntries.push(entry);
            }
        });
    });
    // 폴더 밖(전체 보기 시 리스트 직속) 항목
    $list.children(".pcc-entry").each(function () {
        const id = $(this).data("id");
        const entry = settings.entries.find(e => e.id === id);
        if (entry) {
            // 필터가 "미분류"나 특정 폴더일 때도 안전하게 처리
            if (activeFilter === "all") entry.folderId = null;
            orderedEntries.push(entry);
        }
    });

    // DOM에 안 나온 항목(다른 필터로 가려진 것)은 뒤에 원래 순서대로 보존
    settings.entries.forEach(e => {
        if (!orderedEntries.includes(e)) orderedEntries.push(e);
    });

    settings.entries = orderedEntries;
    saveSettingsDebounced();
    applyPersistentCSS();
}

function initSortable() {
    const $list = $("#pcc-list");
    if (!$list.length || typeof $list.sortable !== "function") return; // jQuery UI 없으면 드래그 없이 동작

    const sortableOpts = {
        handle: ".pcc-drag-handle",
        items: "> .pcc-entry, > .pcc-folder",
        placeholder: "pcc-sort-placeholder",
        forcePlaceholderSize: true,
        tolerance: "pointer",
        update: () => syncOrderFromDom(),
    };

    // 최상위: 폴더 + 폴더 밖 항목
    if ($list.hasClass("ui-sortable")) $list.sortable("destroy");
    $list.sortable(sortableOpts);

    // 각 폴더 내부 항목 (폴더 간 이동 허용: connectWith)
    $("#pcc-list .pcc-folder-entries").each(function () {
        const $box = $(this);
        if ($box.hasClass("ui-sortable")) $box.sortable("destroy");
        $box.sortable({
            handle: ".pcc-drag-handle",
            items: "> .pcc-entry",
            connectWith: ".pcc-folder-entries",
            placeholder: "pcc-sort-placeholder",
            forcePlaceholderSize: true,
            tolerance: "pointer",
            update: () => syncOrderFromDom(),
        });
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
                <div id="pcc-filter-bar" class="pcc-filter-bar"></div>
                <div id="pcc-list"></div>
                <div class="pcc-btn-row">
                    <button type="button" id="pcc-add" class="pcc-add-btn">+ CSS 항목 추가</button>
                    <button type="button" id="pcc-add-folder" class="pcc-add-btn">+ 폴더 추가</button>
                </div>
                <div class="pcc-btn-row">
                    <button type="button" id="pcc-export" class="pcc-add-btn">내보내기</button>
                    <button type="button" id="pcc-import" class="pcc-add-btn">가져오기</button>
                    <input type="file" id="pcc-import-file" accept="application/json,.json" style="display:none">
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
            renderFilterBar(settings);
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

    $list.on("change", ".pcc-folder-toggle", function () {
        const id = $(this).closest(".pcc-folder").data("folder-id");
        const checked = $(this).is(":checked");
        const settings = loadSettings();
        settings.entries.forEach(e => {
            if (e.folderId === id) e.enabled = checked;
        });
        saveSettingsDebounced();
        applyPersistentCSS();
        renderEntries();
        updateMasterToggle();
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

    $("#pcc-export").on("click", function () {
        const settings = loadSettings();
        const payload = {
            type: "persistent-custom-css",
            version: 1,
            entries: settings.entries,
            folders: settings.folders,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const stamp = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `persistent-custom-css-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    $("#pcc-import").on("click", function () {
        $("#pcc-import-file").val("").trigger("click");
    });

    $("#pcc-import-file").on("change", async function () {
        const file = this.files && this.files[0];
        if (!file) return;

        let data;
        try {
            data = JSON.parse(await file.text());
        } catch (e) {
            toastr.error("파일을 읽을 수 없어요. 올바른 JSON 파일인지 확인해주세요.");
            return;
        }

        const importedEntries = Array.isArray(data.entries) ? data.entries : null;
        const importedFolders = Array.isArray(data.folders) ? data.folders : [];
        if (!importedEntries) {
            toastr.error("이 확장에서 내보낸 파일이 아닌 것 같아요.");
            return;
        }

        // 새 ID를 부여해서 기존 항목과 충돌하지 않게 함 + 폴더 매핑 유지
        const folderIdMap = {};
        const newFolders = importedFolders.map(f => {
            const newId = genId();
            folderIdMap[f.id] = newId;
            return {
                id: newId,
                title: f.title ?? "폴더",
                collapsed: !!f.collapsed,
            };
        });
        const newEntries = importedEntries.map(e => ({
            id: genId(),
            title: e.title ?? "CSS",
            enabled: e.enabled ?? true,
            collapsed: !!e.collapsed,
            folderId: e.folderId ? (folderIdMap[e.folderId] ?? null) : null,
            css: e.css ?? "",
        }));

        const applyImport = (mode) => {
            const settings = loadSettings();
            if (mode === "overwrite") {
                settings.entries = newEntries;
                settings.folders = newFolders;
                if (settings.entries.length === 0) {
                    settings.entries.push({ id: genId(), title: "CSS 1", enabled: true, collapsed: false, folderId: null, css: "" });
                }
            } else {
                settings.folders = settings.folders.concat(newFolders);
                settings.entries = settings.entries.concat(newEntries);
            }
            activeFilter = "all";
            saveSettingsDebounced();
            applyPersistentCSS();
            renderEntries();
            updateMasterToggle();
        };

        const summary = `CSS 항목 ${newEntries.length}개, 폴더 ${newFolders.length}개`;

        if (typeof callGenericPopup === "function" && typeof POPUP_TYPE !== "undefined") {
            const result = await callGenericPopup(
                `${summary}를 가져올게요.\n\n기존 항목을 어떻게 할까요?`,
                POPUP_TYPE.TEXT,
                "",
                {
                    okButton: "덮어쓰기",
                    cancelButton: "취소",
                    customButtons: [{ text: "기존에 추가", result: POPUP_RESULT.CUSTOM1 }],
                }
            );
            if (result === POPUP_RESULT.AFFIRMATIVE) applyImport("overwrite");
            else if (result === POPUP_RESULT.CUSTOM1) applyImport("append");
            // 그 외(취소/닫기)는 아무것도 안 함
        } else {
            // 팝업 API를 못 쓰는 경우 기본 confirm으로 폴백
            const overwrite = confirm(`${summary}를 가져옵니다.\n\n확인 = 덮어쓰기 / 취소 = 기존에 추가`);
            applyImport(overwrite ? "overwrite" : "append");
        }
    });
}

jQuery(async () => {
    loadSettings();
    addSettingsUI();
    applyPersistentCSS();
    keepStyleOnTop();
});
