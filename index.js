import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "persistent-custom-css";
const defaultSettings = { css: "", enabled: true };

const STYLE_ID = "persistent-custom-css-style";

function loadSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = structuredClone(defaultSettings);
    }
    for (const key of Object.keys(defaultSettings)) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = defaultSettings[key];
        }
    }
    return extension_settings[extensionName];
}

function applyPersistentCSS() {
    const settings = loadSettings();
    let styleEl = document.getElementById(STYLE_ID);
    if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = STYLE_ID;
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = settings.enabled ? settings.css : "";
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

function addSettingsUI() {
    const settings = loadSettings();
    const html = `
    <div class="pcc-panel pcc-open" id="pcc-panel">
        <div class="pcc-header" id="pcc-header">
            <div class="pcc-title">
                <span class="pcc-dot"></span>
                Persistent Custom CSS
            </div>
            <svg class="pcc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </div>
        <div class="pcc-content">
            <div class="pcc-inner">

                <div class="pcc-row-toggle">
                    <div>
                        <div class="pcc-label">항상 적용</div>
                        <div class="pcc-sub">테마를 바꿔도 아래 CSS는 유지됨</div>
                    </div>
                    <label class="pcc-switch">
                        <input id="pcc-enabled" type="checkbox" ${settings.enabled ? "checked" : ""}>
                        <span class="pcc-track"><span class="pcc-thumb"></span></span>
                    </label>
                </div>

                <div>
                    <div class="pcc-field-label">
                        <span>CUSTOM CSS</span>
                        <span class="pcc-status" id="pcc-status">
                            <span class="pcc-dot2"></span>적용됨
                        </span>
                    </div>
                    <textarea id="pcc-css" spellcheck="false" placeholder="여기에 CSS를 입력하면 테마를 바꿔도 항상 적용됨">${settings.css}</textarea>
                </div>

                <div class="pcc-hint">
                    <b>동작 방식</b> — 이 CSS는 테마 프리셋의 style과 별개로
                    head 맨 끝에 항상 주입돼서, 테마를 바꿔도 지워지지 않아.
                </div>

            </div>
        </div>
    </div>`;

    $("#extensions_settings2").append(html);

    $("#pcc-header").on("click", function () {
        $("#pcc-panel").toggleClass("pcc-open");
    });

    $("#pcc-enabled").on("change", function () {
        settings.enabled = $(this).is(":checked");
        saveSettingsDebounced();
        applyPersistentCSS();
        updateStatus();
    });

    $("#pcc-css").on("input", function () {
        settings.css = $(this).val();
        saveSettingsDebounced();
        applyPersistentCSS();
        updateStatus();
    });

    updateStatus();
}

function updateStatus() {
    const settings = loadSettings();
    const $status = $("#pcc-status");
    if (settings.enabled) {
        $status.css("display", "flex").html('<span class="pcc-dot2"></span>적용됨');
    } else {
        $status.css("display", "none");
    }
}

jQuery(async () => {
    loadSettings();
    addSettingsUI();
    applyPersistentCSS();
    keepStyleOnTop();
});
