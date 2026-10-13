/**
 * 台灣繁中即時轉換 — 轉換核心
 *
 * 純函式，不依賴 SillyTavern，可以單獨在 Node 裡測試。
 *
 * 轉換順序（與 OrchidTea「角色卡台灣繁中工具」一致，讓卡片與聊天用字相同）：
 *   1. OpenCC 簡體 → 台灣字形（cn → tw，只換字形，不用會轉過頭的 twp 詞彙模式）
 *   2. 自動修正：OpenCC 斷詞造成的錯字（髮現→發現、籤名→簽名、託盤→托盤…）
 *   3. 台灣用語：意思明確的詞（視頻→影片、屏幕→螢幕…）
 *   4. 本擴充補充的用語、Taiwan.md 詞庫的日常用語、前後文規則（信息→訊息／資訊、質量→品質…）
 *   5. 「臺」統一成「台」
 *   6. 使用者自訂替換
 *
 * 不會被轉換的內容：{{巨集}}、網址、HTML／XML 標籤（含中文標籤名，例如 <狀態列>）、
 * <script>／<style> 整塊、使用者指定保留的詞，以及正則搜尋式裡用到的中文詞。
 * 標籤名不轉，是為了讓角色卡正則永遠對得上模型輸出的標籤。
 */

const HAS_CJK = /[㐀-鿿]/;

const PROTECT_PATTERNS = [
    '<(script|style)\\b[\\s\\S]*?<\\/\\1\\s*>',
    '\\{\\{[\\s\\S]*?\\}\\}',
    'https?:\\/\\/[^\\s<>"\'`）)」』]+',
    '<\\/?[A-Za-z\\u3400-\\u9fff][^<>\\n]{0,400}>',
];

export const DEFAULT_OPTIONS = Object.freeze({
    autoFix: true,
    taiwan: true,
    vocabulary: true,
    taiwanmd: true,
    context: true,
    taiToTai: true,
    customPairs: '',
    keepWords: '',
});

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 每行一筆，支援「原文=替換」或「原文→替換」，# 開頭為註解。 */
export function parsePairs(text) {
    const pairs = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const m = line.match(/^(.+?)\s*(?:=|→)\s*(.*)$/);
        if (m && m[1]) pairs.push([m[1].trim(), m[2].trim()]);
    }
    return pairs;
}

/** 每行一個詞，# 開頭為註解。 */
export function parseList(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(x => x && !x.startsWith('#'));
}

/**
 * 把詞庫條目編譯成依序套用的步驟。
 * plain 條目合併成一個「長詞優先」的正規表示式（避免「視頻」先把「視頻通話」吃掉），
 * regex 條目保留原本順序。
 * @param {Array} entries 詞庫條目：[find, to] 或 { find, to, regex }
 * @param {boolean} keepOrder true＝完全照原順序逐條套用（自動修正、前後文規則用）
 */
function compileGroup(entries, keepOrder) {
    const steps = [];
    const plain = new Map();

    const flushPlain = () => {
        if (!plain.size) return;
        const keys = [...plain.keys()].sort((a, b) => b.length - a.length);
        const map = new Map(plain);
        steps.push({ re: new RegExp(keys.map(escapeRegex).join('|'), 'g'), to: (m) => map.get(m) });
        plain.clear();
    };

    for (const entry of entries || []) {
        let find, to, isRegex;
        if (Array.isArray(entry)) {
            [find, to] = entry;
        } else if (entry && typeof entry === 'object') {
            ({ find, to } = entry);
            isRegex = Boolean(entry.regex);
        }
        if (typeof find !== 'string' || !find || typeof to !== 'string') continue;

        if (isRegex) {
            if (keepOrder) flushPlain();
            try {
                steps.push({ re: new RegExp(find, 'g'), to });
            } catch (err) {
                console.warn('[zhtw-live] 略過無效的規則', find, err);
            }
        } else if (keepOrder) {
            steps.push({ re: new RegExp(escapeRegex(find), 'g'), to });
        } else {
            plain.set(find, to);
        }
    }
    flushPlain();

    if (!keepOrder) {
        // 長詞優先的 plain 合併步驟放最前面，regex 條目照原順序接在後面
        steps.sort((a, b) => (typeof b.to === 'function') - (typeof a.to === 'function'));
    }
    return steps;
}

/**
 * 從正則的搜尋式裡挑出中文詞（連續兩個字以上）。
 * 角色卡常用「【小剧场】…」這類正則抓內文；這些詞如果被轉成繁體，正則就對不上了，
 * 所以要原樣保留。標籤名（<状态栏>）本來就不轉，這裡處理的是標籤以外的詞。
 * @param {string[]} patterns 正則搜尋式（可含 /…/flags 外框）
 * @returns {string[]} 去重、長詞優先
 */
export function extractRegexWords(patterns) {
    const words = new Set();
    for (const pattern of patterns || []) {
        if (typeof pattern !== 'string') continue;
        // 去掉 \u4e00 這類跳脫，避免把跳脫後面的字誤認成詞的一部分
        const source = pattern.replace(/\\(?:u\{?[0-9a-fA-F]+\}?|x[0-9a-fA-F]{2}|.)/g, ' ');
        for (const m of source.matchAll(/[\u3400-\u9fff\uf900-\ufaff]{2,}/g)) words.add(m[0]);
    }
    return [...words].sort((a, b) => b.length - a.length);
}

/**
 * 算出「只有簡體才用的字」：OpenCC 字表裡的簡體字，扣掉繁簡共用字。
 * 共用字（托、台、后、里、干…）在繁體文字裡是正確的，不能拿來判斷一行是不是簡體。
 * @param {string} stCharacters opencc-js 的 Locale.from.cn[0]，格式「简 繁|简 繁|…」
 * @param {string} sharedChars 繁簡共用字
 * @returns {Set<string>}
 */
export function buildSimplifiedCharSet(stCharacters, sharedChars) {
    const shared = new Set(Array.from(sharedChars || ''));
    const set = new Set();
    for (const entry of String(stCharacters || '').split('|')) {
        const key = entry.split(' ')[0];
        if (key && !shared.has(key)) set.add(key);
    }
    return set;
}

/**
 * 建立轉換函式。
 * @param {object} p
 * @param {(text: string) => string} p.opencc OpenCC 轉換函式（cn → tw）
 * @param {object} p.dictionary OrchidTea 詞庫（autoFix / taiwan）
 * @param {object} [p.extraRules] 本擴充補充規則（context / vocabulary）
 * @param {Set<string>} [p.simplifiedChars] 只有簡體才用的字。有給的話，沒有這些字的行
 *   會被視為已經是繁體、不經過 OpenCC（避免把正確的繁體二次轉錯，例如 托盤→託盤）
 * @param {Array<[string, string]>} [p.taiwanmdTerms] Taiwan.md 詞庫的取代規則
 * @param {string[]} [p.protectWords] 額外要原樣保留的詞（例如正則用到的詞）
 * @param {object} [p.options] 見 DEFAULT_OPTIONS
 * @returns {(text: string) => string}
 */
export function createConverter({ opencc, dictionary, extraRules = {}, taiwanmdTerms = [], simplifiedChars = null, protectWords = [], options = {} }) {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    const steps = [];
    if (opts.autoFix) {
        steps.push(...compileGroup(dictionary?.autoFix, true));
        steps.push(...compileGroup(extraRules?.fix, false));
    }
    if (opts.taiwan) steps.push(...compileGroup(dictionary?.taiwan, false));
    if (opts.vocabulary) steps.push(...compileGroup(extraRules?.vocabulary, false));
    if (opts.taiwanmd) steps.push(...compileGroup(taiwanmdTerms, false));
    if (opts.context) steps.push(...compileGroup(extraRules?.context, true));

    // 使用者輸入的原文可能是簡體，先過一次 OpenCC，才對得上轉換後的文字
    const custom = parsePairs(opts.customPairs).map(([find, to]) => [opencc(find), to]);
    const customSteps = compileGroup(custom, false);

    const keepWords = [...new Set([...parseList(opts.keepWords), ...protectWords])]
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)
        .map(escapeRegex);
    const protectRe = new RegExp([...keepWords, ...PROTECT_PATTERNS].join('|'), 'gi');

    const needsOpenCC = simplifiedChars
        ? (line) => { for (const ch of line) if (simplifiedChars.has(ch)) return true; return false; }
        : () => true;

    /** 逐行：有簡體字的行才過 OpenCC，已經是繁體的行原樣保留。 */
    function toTraditional(text) {
        if (!simplifiedChars) return opencc(text);
        return text.split(/(\r?\n)/).map(part => (part && needsOpenCC(part) ? opencc(part) : part)).join('');
    }

    function convertPlain(text) {
        if (!text || !HAS_CJK.test(text)) return text;
        let out = toTraditional(text);
        for (const step of steps) out = out.replace(step.re, step.to);
        if (opts.taiToTai) out = out.replace(/臺/g, '台');
        for (const step of customSteps) out = out.replace(step.re, step.to);
        return out;
    }

    return function convert(text) {
        if (typeof text !== 'string' || !HAS_CJK.test(text)) return text;
        let out = '';
        let last = 0;
        for (const m of text.matchAll(protectRe)) {
            out += convertPlain(text.slice(last, m.index)) + m[0];
            last = m.index + m[0].length;
        }
        return out + convertPlain(text.slice(last));
    };
}
