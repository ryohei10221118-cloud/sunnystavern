/**
 * 台灣繁中即時轉換（zhtw-live）— SillyTavern 擴充
 *
 * AI 每則訊息生成完，自動把中國用語轉成台灣繁中，並存回聊天紀錄，
 * 讓模型之後在歷史裡看到的也是台灣用語。原文另外保存，可以隨時還原。
 *
 * 效能：開頁時只載入這個檔案和兩個小模組（約 20KB）。約 1MB 的 OpenCC 字典
 * 等到第一次真的需要轉換時才下載，不會拖慢 SillyTavern 的初始化。
 */

import { createConverter, buildSimplifiedCharSet, extractRegexWords, DEFAULT_OPTIONS } from './converter.js';
import { convertMessage, restoreMessage, forgetOriginal, hasOriginal } from './message.js';

const MODULE = 'zhtw-live';
const LOG = '[zhtw-live]';

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    reasoning: true,
    regexWords: true,
    ...DEFAULT_OPTIONS,
});

const ctx = () => SillyTavern.getContext();

function settings() {
    const all = ctx().extensionSettings;
    all[MODULE] = { ...DEFAULT_SETTINGS, ...(all[MODULE] || {}) };
    return all[MODULE];
}

// ---------------------------------------------------------------------------
// 延遲載入：OpenCC 字典與詞庫只在第一次需要時才下載
// ---------------------------------------------------------------------------

let assetsPromise = null;
let converter = null;
/** @type {{ state: 'idle'|'loading'|'ready'|'error', error?: string }} */
const assetStatus = { state: 'idle' };

function loadAssets() {
    if (!assetsPromise) {
        const url = (path) => new URL(path, import.meta.url).href;
        const json = (path) => fetch(url(path)).then(r => {
            if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
            return r.json();
        });
        assetStatus.state = 'loading';
        updateStatus();
        assetsPromise = Promise.all([
            import(url('./lib/opencc-cn2t.js')),
            json('./data/dictionary.json'),
            json('./data/extra-rules.json'),
            json('./data/opencc-shared-chars.json'),
        ]).then(([opencc, dictionary, extraRules, shared]) => {
            assetStatus.state = 'ready';
            updateStatus();
            return {
                opencc: opencc.Converter({ from: 'cn', to: 'tw' }),
                simplifiedChars: buildSimplifiedCharSet(opencc.Locale.from.cn[0], shared.chars),
                dictionary,
                extraRules,
            };
        }).catch(err => {
            assetsPromise = null;   // 失敗了下次再試
            assetStatus.state = 'error';
            assetStatus.error = err.message;
            updateStatus();
            throw err;
        });
    }
    return assetsPromise;
}

// ---------------------------------------------------------------------------
// 正則用到的詞：原樣保留，讓角色卡／預設／全域正則轉換後還對得上
// ---------------------------------------------------------------------------

let regexEngine;
async function getRegexPatterns() {
    if (regexEngine === undefined) {
        try {
            // SillyTavern 內建的正則擴充（已經載入過，不會重新下載）
            regexEngine = await import(new URL('../../regex/engine.js', import.meta.url).href);
        } catch {
            regexEngine = null;
        }
    }
    let scripts = [];
    try {
        if (regexEngine?.getRegexScripts) {
            scripts = regexEngine.getRegexScripts({ allowedOnly: true });
        } else {
            const c = ctx();
            scripts = [
                ...(c.extensionSettings.regex || []),
                ...(c.characters?.[c.characterId]?.data?.extensions?.regex_scripts || []),
            ];
        }
    } catch (err) {
        console.warn(LOG, '讀不到正則清單', err);
    }
    return scripts.filter(x => x && !x.disabled).map(x => x.findRegex);
}

let regexWords = [];
async function refreshRegexWords() {
    regexWords = settings().regexWords ? extractRegexWords(await getRegexPatterns()) : [];
    return regexWords;
}

// ---------------------------------------------------------------------------
// 轉換函式（設定或保留詞改變時重建，字典本身不會重新下載）
// ---------------------------------------------------------------------------

let converterKey = '';
async function getConverter() {
    const words = await refreshRegexWords();
    const key = words.join('\n');
    if (!converter || key !== converterKey) {
        const assets = await loadAssets();
        converter = createConverter({ ...assets, protectWords: words, options: settings() });
        converterKey = key;
        updateStatus();
    }
    return converter;
}

function invalidateConverter() {
    converter = null;
}

// ---------------------------------------------------------------------------
// 存檔：轉換後補一次延遲存檔（大多數情況 SillyTavern 自己也會接著存）
// ---------------------------------------------------------------------------

let saveTimer = null;
function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        ctx().saveChat().catch(err => console.error(LOG, '存檔失敗', err));
    }, 1000);
}

// ---------------------------------------------------------------------------
// 事件：新訊息生成完就轉換
// ---------------------------------------------------------------------------

async function onMessageReceived(messageId, type) {
    const s = settings();
    if (!s.enabled || type === 'impersonate') return;

    const c = ctx();
    const id = Number(messageId);
    const msg = c.chat[id];
    if (!msg || msg.is_user || msg.is_system) return;

    try {
        const convert = await getConverter();
        if (convertMessage(msg, convert, { reasoning: s.reasoning })) {
            scheduleSave();
            // 串流時訊息已經畫在畫面上，要重畫；非串流時這個事件發生在畫出來之前，
            // SillyTavern 等一下會直接用轉好的內容畫，不用（也不能）重畫
            if (document.querySelector(`#chat .mes[mesid="${id}"]`)) c.updateMessageBlock(id, msg);
        }
    } catch (err) {
        console.error(LOG, '轉換失敗，這則訊息維持原樣', err);
    }
}

function onMessageEdited(messageId) {
    const msg = ctx().chat[Number(messageId)];
    if (forgetOriginal(msg)) scheduleSave();
}

// ---------------------------------------------------------------------------
// 整個聊天：一次轉換／還原
// ---------------------------------------------------------------------------

async function convertWholeChat() {
    const c = ctx();
    if (!c.chat?.length) return toastr.info('目前沒有開啟的聊天。');

    const ok = await c.Popup.show.confirm(
        '轉換目前聊天的所有 AI 訊息？',
        '會把這個聊天裡每一則 AI 訊息（含所有 swipe 與思考過程）轉成台灣繁中並存檔。<br>原文會另外保存，之後可以按「還原」回到原本的樣子。',
    );
    if (!ok) return;

    const convert = await getConverter();
    const s = settings();
    let count = 0;
    for (const msg of c.chat) {
        if (convertMessage(msg, convert, { reasoning: s.reasoning })) count++;
    }
    if (!count) return toastr.info('沒有需要轉換的訊息，已經全部是台灣繁中了。');

    await c.saveChat();
    await c.reloadCurrentChat();
    toastr.success(`已轉換 ${count} 則訊息。`);
}

async function restoreWholeChat() {
    const c = ctx();
    if (!c.chat?.length) return toastr.info('目前沒有開啟的聊天。');

    const total = c.chat.filter(hasOriginal).length;
    if (!total) return toastr.info('這個聊天沒有可還原的原文。');

    const ok = await c.Popup.show.confirm(
        `還原 ${total} 則訊息？`,
        '會把這個聊天轉換過的訊息改回 AI 原本寫的內容並存檔。<br>你在轉換後手動編輯過的訊息不受影響。',
    );
    if (!ok) return;

    let count = 0;
    let skipped = 0;
    for (const msg of c.chat) {
        const r = restoreMessage(msg);
        if (r.restored) count++;
        skipped += r.skipped;
    }
    await c.saveChat();
    await c.reloadCurrentChat();
    toastr.success(skipped
        ? `已還原 ${count} 則訊息；${skipped} 處在轉換後被改過，保留你改過的內容。`
        : `已還原 ${count} 則訊息。`);
}

// ---------------------------------------------------------------------------
// 設定面板
// ---------------------------------------------------------------------------

const CHECKBOXES = [
    ['enabled', '新訊息自動轉換', 'AI 每則回覆生成完就轉換並存檔'],
    ['reasoning', '一併轉換思考過程', '摺疊起來的思考內容也轉換'],
    ['autoFix', '修正轉換錯字', '例如「粉絲髮現」→「粉絲發現」（建議保持開啟）'],
    ['taiwan', '台灣用語（OrchidTea 詞庫）', '視頻→影片、屏幕→螢幕、默認→預設…'],
    ['vocabulary', '台灣用語（補充）', '出租車→計程車、空調→冷氣、小區→社區…'],
    ['context', '依前後文判斷', '信息→訊息／資訊、質量→品質（物理用法不改）'],
    ['taiToTai', '「臺」統一寫成「台」', '舞台、平台、台灣'],
    ['regexWords', '保留正則用到的詞', '角色卡／預設的正則裡出現的中文詞不轉換，避免正則失效（建議保持開啟）'],
];

function settingsHtml() {
    const boxes = CHECKBOXES.map(([key, label, hint]) => `
        <label class="checkbox_label zhtw-live-row" title="${hint}">
            <input type="checkbox" data-zhtw-key="${key}">
            <span>${label}<small>${hint}</small></span>
        </label>`).join('');

    return `
    <div class="zhtw-live-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>台灣繁中即時轉換</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                ${boxes}

                <label for="zhtw-live-custom"><b>自訂替換</b><small>每行一筆「原文=替換」，簡體或繁體都可以</small></label>
                <textarea id="zhtw-live-custom" class="text_pole textarea_compact" rows="4" data-zhtw-text="customPairs" placeholder="土豆=馬鈴薯&#10;靠譜=可靠"></textarea>

                <label for="zhtw-live-keep"><b>不轉換的詞</b><small>每行一個，例如想保留原樣的角色名</small></label>
                <textarea id="zhtw-live-keep" class="text_pole textarea_compact" rows="2" data-zhtw-text="keepWords"></textarea>

                <div class="zhtw-live-buttons">
                    <div class="menu_button menu_button_icon" id="zhtw-live-convert-chat">
                        <i class="fa-solid fa-language"></i><span>轉換目前聊天</span>
                    </div>
                    <div class="menu_button menu_button_icon" id="zhtw-live-restore-chat">
                        <i class="fa-solid fa-rotate-left"></i><span>還原目前聊天</span>
                    </div>
                </div>

                <label for="zhtw-live-test-in"><b>試轉看看</b><small>貼一段文字，馬上看轉換結果（不會改到聊天）</small></label>
                <textarea id="zhtw-live-test-in" class="text_pole textarea_compact" rows="3" placeholder="他打开手机看视频，信息质量太差"></textarea>
                <div id="zhtw-live-test-out" class="zhtw-live-test-out"></div>

                <div id="zhtw-live-status" class="zhtw-live-status"></div>
            </div>
        </div>
    </div>`;
}

const STATUS_TEXT = {
    idle: '字典尚未載入（第一次轉換時才會下載，約 430KB，之後瀏覽器會快取）。',
    loading: '字典載入中…',
    ready: '字典已載入。',
};

function updateStatus() {
    const el = document.getElementById('zhtw-live-status');
    if (!el) return;
    let text = assetStatus.state === 'error'
        ? `字典載入失敗：${assetStatus.error}（下次轉換時會再試一次）`
        : STATUS_TEXT[assetStatus.state];
    if (regexWords.length) {
        const shown = regexWords.slice(0, 12).join('、');
        text += `\n正則用到、保留不轉換的詞：${shown}${regexWords.length > 12 ? ` 等 ${regexWords.length} 個` : ''}`;
    }
    el.textContent = text;
}

let testTimer = null;
function runTest() {
    clearTimeout(testTimer);
    testTimer = setTimeout(async () => {
        const input = document.getElementById('zhtw-live-test-in')?.value || '';
        const out = document.getElementById('zhtw-live-test-out');
        if (!out) return;
        if (!input.trim()) { out.textContent = ''; return; }
        try {
            out.textContent = (await getConverter())(input);
        } catch (err) {
            out.textContent = `轉換失敗：${err.message}`;
        }
    }, 300);
}

function bindSettings() {
    const s = settings();
    const root = document.querySelector('.zhtw-live-settings');

    root.querySelectorAll('[data-zhtw-key]').forEach(el => {
        el.checked = Boolean(s[el.dataset.zhtwKey]);
        el.addEventListener('change', () => {
            settings()[el.dataset.zhtwKey] = el.checked;
            invalidateConverter();
            ctx().saveSettingsDebounced();
            runTest();
        });
    });

    root.querySelectorAll('[data-zhtw-text]').forEach(el => {
        el.value = s[el.dataset.zhtwText] || '';
        el.addEventListener('input', () => {
            settings()[el.dataset.zhtwText] = el.value;
            invalidateConverter();
            ctx().saveSettingsDebounced();
            runTest();
        });
    });

    document.getElementById('zhtw-live-convert-chat').addEventListener('click', () => convertWholeChat().catch(err => {
        console.error(LOG, err);
        toastr.error(`轉換失敗：${err.message}`);
    }));
    document.getElementById('zhtw-live-restore-chat').addEventListener('click', () => restoreWholeChat().catch(err => {
        console.error(LOG, err);
        toastr.error(`還原失敗：${err.message}`);
    }));
    document.getElementById('zhtw-live-test-in').addEventListener('input', runTest);
}

// ---------------------------------------------------------------------------
// 啟動：只掛設定面板與事件，不下載任何字典
// ---------------------------------------------------------------------------

function init() {
    settings();

    const mount = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (mount && !document.querySelector('.zhtw-live-settings')) {
        mount.insertAdjacentHTML('beforeend', settingsHtml());
        bindSettings();
        updateStatus();
    }

    const { eventSource, eventTypes } = ctx();
    // 排第一個：在其他擴充（記憶書、酒館助手…）讀到這則訊息之前就先轉好
    eventSource.makeFirst(eventTypes.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(eventTypes.MESSAGE_EDITED, onMessageEdited);

    console.log(LOG, '已啟用');
}

jQuery(() => init());
