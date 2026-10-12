/**
 * 台灣繁中即時轉換 — 訊息層處理
 *
 * 只操作 SillyTavern 的訊息物件（純資料），不碰畫面，可單獨測試。
 *
 * SillyTavern 一則訊息的結構：
 *   mes            目前顯示的文字
 *   swipes[i]      每個 swipe 的文字（目前這個 = swipes[swipe_id]）
 *   swipe_info[i]  每個 swipe 的附加資料；切換 swipe 時 .extra 會整份換進 message.extra
 *   extra          目前這個 swipe 的附加資料（思考過程在 extra.reasoning）
 *
 * 原文紀錄放在 extra.zhtw（各 swipe 各自一份），跟著 SillyTavern 原生的 swipe 切換走：
 *   { mes, mesSig, reasoning, reasoningSig }
 *   mes／reasoning   轉換前的原文
 *   *Sig             我們寫回去的轉換結果的指紋（長度＋雜湊），用來判斷內容後來有沒有被改過
 *
 * 指紋的用途：
 *   - 按「繼續」讓 AI 往下寫時，新寫的那段會接在原文後面一起記錄，還原時不會遺失
 *   - 使用者手動改過內容後，還原會跳過那則，不會把使用者的修改蓋回 AI 原文
 */

export const RECORD_KEY = 'zhtw';

/** 文字指紋：長度 + FNV-1a 32 位元雜湊。 */
export function signature(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return `${text.length}:${(h >>> 0).toString(36)}`;
}

function clearField(record, field) {
    delete record[field];
    delete record[field + 'Sig'];
}

function isEmptyRecord(record) {
    return !record || (record.mes === undefined && record.reasoning === undefined);
}

/**
 * 轉換一段文字，並更新它的原文紀錄。
 * @returns {string} 轉換後的文字
 */
function track(record, field, text, convert) {
    if (typeof text !== 'string' || !text) return text;
    const after = convert(text);
    const original = record[field];
    const sig = record[field + 'Sig'];

    if (original === undefined) {
        if (after !== text) {
            record[field] = text;
            record[field + 'Sig'] = signature(after);
        }
        return after;
    }

    // 內容跟上次寫回去的一模一樣：已經轉過，原文紀錄不動
    if (sig && signature(text) === sig) return after;

    const length = Number(String(sig || '').split(':')[0]);
    if (sig && text.length > length && signature(text.slice(0, length)) === sig) {
        // 「繼續」：前段是上次轉好的內容，後面是 AI 新寫、還沒轉換的部分
        record[field] = original + text.slice(length);
    } else if (after !== text) {
        // 對不上（內容被改過）：從目前內容重新記錄，至少保住現在的樣子
        record[field] = text;
    } else {
        clearField(record, field);
        return after;
    }
    record[field + 'Sig'] = signature(after);
    return after;
}

/**
 * 把紀錄裡的原文取回來。內容在轉換後被改過就不還原（回傳 null），以免蓋掉使用者的修改。
 * @returns {{ text: string|null, skipped: boolean }}
 */
function takeOriginal(record, field, current) {
    if (!record || record[field] === undefined) return { text: null, skipped: false };
    const sig = record[field + 'Sig'];
    const original = record[field];
    clearField(record, field);
    if (sig && typeof current === 'string' && signature(current) !== sig) {
        return { text: null, skipped: true };
    }
    return { text: original, skipped: false };
}

/**
 * 轉換一則訊息（含所有 swipe 與思考過程）。已轉過的內容再轉一次不會有變化。
 * @param {object} msg SillyTavern 訊息物件
 * @param {(text: string) => string} convert 轉換函式
 * @param {object} [opt]
 * @param {boolean} [opt.reasoning=true] 是否一併轉換思考過程
 * @returns {boolean} 是否有任何改動
 */
export function convertMessage(msg, convert, { reasoning = true } = {}) {
    if (!msg || msg.is_user || msg.is_system) return false;
    const before = JSON.stringify([msg.mes, msg.swipes, msg.extra?.reasoning, msg.swipe_info?.map(i => i?.extra?.reasoning)]);

    msg.extra = msg.extra || {};
    const record = msg.extra[RECORD_KEY] || {};
    msg.mes = track(record, 'mes', msg.mes, convert);
    if (reasoning && typeof msg.extra.reasoning === 'string') msg.extra.reasoning = track(record, 'reasoning', msg.extra.reasoning, convert);

    const sid = msg.swipe_id;
    if (typeof sid === 'number' && Array.isArray(msg.swipes)) {
        if (!Array.isArray(msg.swipe_info)) msg.swipe_info = [];
        for (let i = 0; i < msg.swipes.length; i++) {
            if (typeof msg.swipes[i] !== 'string') continue;
            let info = msg.swipe_info[i];
            if (!info || typeof info !== 'object') info = msg.swipe_info[i] = {};
            if (!info.extra || typeof info.extra !== 'object') info.extra = {};

            if (i === sid) {
                // 目前這個 swipe 跟 message 共用紀錄；swipe 文字獨立轉換
                // （開場白在未動過的聊天裡，swipe 存的是未替換巨集的版本，不能直接拿 mes 蓋過去）
                msg.swipes[i] = convert(msg.swipes[i]);
                if (reasoning && typeof msg.extra.reasoning === 'string') info.extra.reasoning = msg.extra.reasoning;
                continue;
            }

            const r = info.extra[RECORD_KEY] || {};
            msg.swipes[i] = track(r, 'mes', msg.swipes[i], convert);
            if (reasoning && typeof info.extra.reasoning === 'string') info.extra.reasoning = track(r, 'reasoning', info.extra.reasoning, convert);
            if (isEmptyRecord(r)) delete info.extra[RECORD_KEY];
            else info.extra[RECORD_KEY] = r;
        }
    }

    if (isEmptyRecord(record)) delete msg.extra[RECORD_KEY];
    else msg.extra[RECORD_KEY] = record;

    // 目前 swipe 的附加資料與 message 同步（同 SillyTavern 的 syncMesToSwipe）
    const activeInfo = typeof sid === 'number' ? msg.swipe_info?.[sid] : null;
    if (activeInfo?.extra) {
        if (msg.extra[RECORD_KEY]) activeInfo.extra[RECORD_KEY] = structuredClone(msg.extra[RECORD_KEY]);
        else delete activeInfo.extra[RECORD_KEY];
    }

    const after = JSON.stringify([msg.mes, msg.swipes, msg.extra?.reasoning, msg.swipe_info?.map(i => i?.extra?.reasoning)]);
    return before !== after;
}

/**
 * 把一則訊息還原成轉換前的原文。轉換後被手動改過的部分會略過、保留使用者的修改。
 * @returns {{ restored: boolean, skipped: number }}
 */
export function restoreMessage(msg) {
    const result = { restored: false, skipped: 0 };
    if (!msg) return result;
    const sid = msg.swipe_id;

    const record = msg.extra?.[RECORD_KEY];
    if (record) {
        const m = takeOriginal(record, 'mes', msg.mes);
        if (m.text !== null) {
            msg.mes = m.text;
            if (typeof sid === 'number' && typeof msg.swipes?.[sid] === 'string') msg.swipes[sid] = m.text;
            result.restored = true;
        }
        if (m.skipped) result.skipped++;

        const r = takeOriginal(record, 'reasoning', msg.extra.reasoning);
        if (r.text !== null) {
            msg.extra.reasoning = r.text;
            const info = typeof sid === 'number' ? msg.swipe_info?.[sid] : null;
            if (info?.extra) info.extra.reasoning = r.text;
            result.restored = true;
        }
        if (r.skipped) result.skipped++;

        delete msg.extra[RECORD_KEY];
    }

    if (Array.isArray(msg.swipes) && Array.isArray(msg.swipe_info)) {
        msg.swipe_info.forEach((info, i) => {
            const rec = info?.extra?.[RECORD_KEY];
            if (!rec) return;
            if (i !== sid) {
                const m = takeOriginal(rec, 'mes', msg.swipes[i]);
                if (m.text !== null) { msg.swipes[i] = m.text; result.restored = true; }
                if (m.skipped) result.skipped++;
                const r = takeOriginal(rec, 'reasoning', info.extra.reasoning);
                if (r.text !== null) { info.extra.reasoning = r.text; result.restored = true; }
                if (r.skipped) result.skipped++;
            }
            delete info.extra[RECORD_KEY];
        });
    }

    return result;
}

/**
 * 使用者手動編輯訊息後呼叫：丟掉目前 swipe 的原文紀錄，
 * 之後按「還原」才不會把使用者自己的修改蓋回 AI 原文。
 */
export function forgetOriginal(msg) {
    if (!msg) return false;
    let changed = false;
    for (const extra of [msg.extra, msg.swipe_info?.[msg.swipe_id]?.extra]) {
        if (extra?.[RECORD_KEY]) {
            delete extra[RECORD_KEY];
            changed = true;
        }
    }
    return changed;
}

/** 這則訊息是否存有可還原的原文。 */
export function hasOriginal(msg) {
    if (!msg) return false;
    if (!isEmptyRecord(msg.extra?.[RECORD_KEY])) return true;
    return Array.isArray(msg.swipe_info) && msg.swipe_info.some(i => !isEmptyRecord(i?.extra?.[RECORD_KEY]));
}
