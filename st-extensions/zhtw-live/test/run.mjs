// 台灣繁中即時轉換 — 測試
// 執行：node --test st-extensions/zhtw-live/test/run.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Converter, Locale } from '../lib/opencc-cn2t.js';
import { createConverter, buildSimplifiedCharSet, extractRegexWords } from '../converter.js';
import { convertMessage, restoreMessage, forgetOriginal, hasOriginal, RECORD_KEY } from '../message.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dictionary = JSON.parse(readFileSync(join(root, 'data/dictionary.json'), 'utf8'));
const extraRules = JSON.parse(readFileSync(join(root, 'data/extra-rules.json'), 'utf8'));
const shared = JSON.parse(readFileSync(join(root, 'data/opencc-shared-chars.json'), 'utf8'));
const opencc = Converter({ from: 'cn', to: 'tw' });
const simplifiedChars = buildSimplifiedCharSet(Locale.from.cn[0], shared.chars);
// 跟擴充正式執行時的組法一模一樣
const make = (options = {}, protectWords = []) => createConverter({ opencc, dictionary, extraRules, simplifiedChars, protectWords, options });
const convert = make();

// ---------------------------------------------------------------------------
// 轉換核心
// ---------------------------------------------------------------------------

test('從正則挑出中文詞', () => {
    assert.deepEqual(
        extractRegexWords(['/【小剧场】([\\s\\S]*?)【\\/小剧场】/g', '<状态栏>(.*?)地点：(.*?)<\\/状态栏>', '/\\u4e00好/', null, '我']),
        ['小剧场', '状态栏', '地点'],
    );
});

test('正則用到的詞原樣保留，正則轉換後仍對得上', () => {
    const findRegex = '/【小剧场】([\\s\\S]*?)【\\/小剧场】/';
    const words = extractRegexWords([findRegex]);
    const out = make({}, words)('【小剧场】他打开手机看视频【/小剧场】');
    assert.equal(out, '【小剧场】他打開手機看影片【/小剧场】');
    assert.match(out, new RegExp(findRegex.slice(1, -1)));
    // 卡片已經被轉成繁體的情況：簡體輸出照樣轉成繁體，跟繁體正則對得上
    const twWords = extractRegexWords(['【小劇場】([\\s\\S]*?)【\\/小劇場】']);
    assert.equal(make({}, twWords)('【小剧场】内容【/小剧场】'), '【小劇場】內容【/小劇場】');
});

test('修正 OpenCC 的斷詞錯字', () => {
    assert.equal(convert('粉丝发现了他的秘密'), '粉絲發現了他的秘密');
    assert.equal(convert('他签下名字'), '他簽下名字');
    assert.equal(convert('一见钟情'), '一見鍾情');
    assert.equal(convert('这里离市区十公里'), '這裡離市區十公里');
    assert.equal(convert('她把头发别到耳后'), '她把頭髮別到耳後');
});

test('台灣用語：長詞優先，不會被短詞先吃掉', () => {
    assert.equal(convert('他发起视频通话'), '他發起視訊通話');
    assert.equal(convert('看了一段视频'), '看了一段影片');
    assert.equal(convert('屏幕上的默认设置'), '螢幕上的預設設置');
    assert.equal(convert('给她点赞'), '給她按讚');
});

test('不會轉過頭（OpenCC 詞彙模式的錯誤不能出現）', () => {
    assert.equal(convert('他打开手机'), '他打開手機');
    assert.equal(convert('出租车停在窗口旁'), '計程車停在窗口旁');
});

test('補充用語', () => {
    assert.equal(convert('出租车停在小区门口'), '計程車停在社區門口');
    assert.equal(convert('这片小区域很安静'), '這片小區域很安靜');
    assert.equal(convert('打开笔记本电脑'), '打開筆電');
    assert.equal(convert('在笔记本上写字'), '在筆記本上寫字');
    assert.equal(convert('开空调吃方便面'), '開冷氣吃泡麵');
});

test('依前後文判斷：信息、質量', () => {
    assert.equal(convert('请填写个人信息'), '請填寫個人資訊');
    assert.equal(convert('她收到一条信息'), '她收到一條訊息');
    assert.equal(convert('这杯奶茶的质量真差'), '這杯奶茶的品質真差');
    assert.equal(convert('原子质量'), '原子質量');
    assert.equal(convert('质量守恒定律'), '質量守恆定律');
});

test('「臺」統一成「台」，可以關掉', () => {
    assert.equal(convert('站在舞台上'), '站在舞台上');
    assert.equal(convert('台湾'), '台灣');
    assert.equal(make({ taiToTai: false })('他站在舞台上说'), '他站在舞臺上說');
});

test('保護：標籤名、屬性、巨集、網址、script/style 都不轉', () => {
    assert.equal(convert('<状态栏><心情图标>头发</心情图标></状态栏>'), '<状态栏><心情图标>頭髮</心情图标></状态栏>');
    assert.equal(convert('<div title="标题" class="红">红色</div>'), '<div title="标题" class="红">紅色</div>');
    assert.equal(convert('{{getvar::字数要求}}个字'), '{{getvar::字数要求}}個字');
    assert.equal(convert('看 https://example.com/中文路径 这里'), '看 https://example.com/中文路径 這裡');
    assert.equal(convert('<script>const 变量 = "简体";</script>简体'), '<script>const 变量 = "简体";</script>簡體');
    assert.equal(convert('<style>.红 { color: red }</style>红'), '<style>.红 { color: red }</style>紅');
});

test('文章裡的大於小於符號不會被當成標籤', () => {
    assert.equal(convert('3 < 5，而且 7 > 2，这是对的'), '3 < 5，而且 7 > 2，這是對的');
});

test('不轉換的詞', () => {
    const c = make({ keepWords: '叶子\n# 這行是註解' });
    assert.equal(c('叶子说她的叶子掉了'), '叶子說她的叶子掉了');
});

test('自訂替換：簡體或繁體寫法都對得上', () => {
    const c = make({ customPairs: '靠谱=可靠\n土豆→馬鈴薯\n# 註解' });
    assert.equal(c('这人很靠谱，还做了土豆炖肉'), '這人很可靠，還做了馬鈴薯燉肉');
});

test('關掉台灣用語就只換字形', () => {
    assert.equal(make({ taiwan: false })('看了一段视频'), '看了一段視頻');
});

test('沒有中文或不是字串就原樣回傳', () => {
    assert.equal(convert(''), '');
    assert.equal(convert('Hello world <b>x</b>'), 'Hello world <b>x</b>');
    assert.equal(convert(null), null);
    assert.equal(convert(undefined), undefined);
});

const SAMPLE = [
    '<狀態列>',
    '<心情图标>🎧</心情图标>',
    '<心情标题>扣紧不放</心情标题>',
    '<心情独白>"她数落自己缺点的时候，我只想把她那双冰凉的手揣进我心口里捂热。"</心情独白>',
    '<翻牌C图示>🍬</翻牌C标题>',
    '<铁盒碎语1>"大二寒假，徐知晏在电话里跟她发脾气。" —— 2022.01.22</铁盒碎语1>',
    '</狀態列>',
    '<content>',
    '金尊里的酒液泛着淡珀色的微光，粉丝发现他打开手机看视频，信息质量太差，网络又卡。',
    '出租车停在小区门口，他用笔记本电脑登录了个人信息页面。',
    '</content>',
    '<sidestory><details><summary>小剧场</summary><div style="padding: 15px;"><p>他说："走吧。"</p></div></details></sidestory>',
].join('\n');

test('狀態列範例：標籤原封不動、內容轉換', () => {
    const out = convert(SAMPLE);
    for (const tag of SAMPLE.match(/<\/?[^<>\n]+>/g)) assert.ok(out.includes(tag), `標籤被改了：${tag}`);
    assert.ok(out.includes('粉絲發現他打開手機看影片，訊息品質太差，網路又卡。'));
    assert.ok(out.includes('計程車停在社區門口，他用筆電'));
    assert.ok(out.includes('個人資訊'));
    assert.ok(out.includes('<summary>小劇場</summary>'));
});

test('冪等：已經轉過的內容再轉一次不會變', () => {
    const corpus = [SAMPLE, '粉丝发现', '视频通话', '个人信息与信息', '舞台上的台湾人', '原子质量与奶茶质量', '叶子的头发'];
    for (const text of corpus) {
        const once = convert(text);
        assert.equal(convert(once), once, `不冪等：${text}`);
    }
});

test('效能：10 萬字在 1 秒內', () => {
    const big = SAMPLE.repeat(Math.ceil(100000 / SAMPLE.length));
    const t0 = performance.now();
    convert(big);
    const ms = performance.now() - t0;
    assert.ok(ms < 1000, `花了 ${ms.toFixed(0)}ms`);
});

test('已經是繁體的文字不會被改壞（繁簡共用字）', () => {
    for (const text of [
        '她把托盤放在案几上', '皇后娘娘駕到', '這會干擾判斷', '頭髮與發現',
        '她托著腮看他', '一見鍾情', '這裡離市區十公里', '松鼠跳上松樹', '只是一瞬間',
    ]) {
        assert.equal(convert(text), text, `繁體被改壞：${text}`);
    }
});

test('同一行混了簡體字時，共用字仍然轉對', () => {
    assert.equal(convert('他把这个托盘放下'), '他把這個托盤放下');
    assert.equal(convert('他把这个托盤放下'), '他把這個托盤放下');
    assert.equal(convert('这会干擾判断'), '這會干擾判斷');
});

test('已經是繁體的文字一個字都不動', () => {
    const sample = readFileSync(join(root, 'test/fixtures/traditional-sample.txt'), 'utf8');
    assert.equal(convert(sample), sample);
});

// ---------------------------------------------------------------------------
// 訊息層
// ---------------------------------------------------------------------------

const clone = (o) => JSON.parse(JSON.stringify(o));

test('單則訊息：轉換、記錄原文、還原', () => {
    const msg = { name: 'AI', is_user: false, mes: '粉丝发现了信息', extra: {} };
    assert.equal(convertMessage(msg, convert), true);
    assert.equal(msg.mes, '粉絲發現了訊息');
    assert.equal(msg.extra[RECORD_KEY].mes, '粉丝发现了信息');
    assert.equal(hasOriginal(msg), true);

    const r = restoreMessage(msg);
    assert.deepEqual(r, { restored: true, skipped: 0 });
    assert.equal(msg.mes, '粉丝发现了信息');
    assert.equal(hasOriginal(msg), false);
});

test('再轉一次沒有變化，也不會蓋掉原文', () => {
    const msg = { is_user: false, mes: '看视频', extra: {} };
    convertMessage(msg, convert);
    const snapshot = clone(msg);
    assert.equal(convertMessage(msg, convert), false);
    assert.deepEqual(msg, snapshot);
});

test('使用者訊息、系統訊息不動', () => {
    const u = { is_user: true, mes: '看视频', extra: {} };
    const s = { is_user: false, is_system: true, mes: '看视频', extra: {} };
    assert.equal(convertMessage(u, convert), false);
    assert.equal(convertMessage(s, convert), false);
    assert.equal(u.mes, '看视频');
    assert.equal(s.mes, '看视频');
});

test('多個 swipe：全部轉換、各自記錄、切換後也能還原', () => {
    const msg = {
        is_user: false,
        mes: '第二个视频',
        swipe_id: 1,
        swipes: ['第一个视频', '第二个视频', '第三个视频'],
        swipe_info: [{ extra: {} }, { extra: {} }, { extra: {} }],
        extra: {},
    };
    assert.equal(convertMessage(msg, convert), true);
    assert.deepEqual(msg.swipes, ['第一個影片', '第二個影片', '第三個影片']);
    assert.equal(msg.mes, '第二個影片');
    assert.equal(msg.swipe_info[0].extra[RECORD_KEY].mes, '第一个视频');
    assert.equal(msg.swipe_info[1].extra[RECORD_KEY].mes, '第二个视频');   // 目前 swipe 同步
    assert.equal(msg.swipe_info[2].extra[RECORD_KEY].mes, '第三个视频');

    // 模擬 SillyTavern 切換到 swipe 0（syncSwipeToMes）
    msg.swipe_id = 0;
    msg.mes = msg.swipes[0];
    msg.extra = structuredClone(msg.swipe_info[0].extra);

    restoreMessage(msg);
    assert.deepEqual(msg.swipes, ['第一个视频', '第二个视频', '第三个视频']);
    assert.equal(msg.mes, '第一个视频');
    assert.equal(hasOriginal(msg), false);
});

test('思考過程一併轉換與還原，可以關掉', () => {
    const msg = { is_user: false, mes: '好', extra: { reasoning: '他想看视频' } };
    convertMessage(msg, convert);
    assert.equal(msg.extra.reasoning, '他想看影片');
    restoreMessage(msg);
    assert.equal(msg.extra.reasoning, '他想看视频');

    const off = { is_user: false, mes: '好', extra: { reasoning: '他想看视频' } };
    convertMessage(off, convert, { reasoning: false });
    assert.equal(off.extra.reasoning, '他想看视频');
});

test('按「繼續」：續寫的部分接在原文後面，還原時不會遺失', () => {
    const msg = { is_user: false, mes: '他看了视频。', extra: {} };
    convertMessage(msg, convert);
    assert.equal(msg.mes, '他看了影片。');

    msg.mes += '然后收到一条信息。';            // SillyTavern 把 AI 續寫的內容接在後面
    convertMessage(msg, convert);
    assert.equal(msg.mes, '他看了影片。然後收到一條訊息。');
    assert.equal(msg.extra[RECORD_KEY].mes, '他看了视频。然后收到一条信息。');

    restoreMessage(msg);
    assert.equal(msg.mes, '他看了视频。然后收到一条信息。');
});

test('轉換後手動改過：還原會跳過，保留使用者的修改', () => {
    const msg = { is_user: false, mes: '看视频', extra: {} };
    convertMessage(msg, convert);
    msg.mes = '我自己改成這樣';
    const r = restoreMessage(msg);
    assert.deepEqual(r, { restored: false, skipped: 1 });
    assert.equal(msg.mes, '我自己改成這樣');
});

test('forgetOriginal：編輯後丟掉原文紀錄', () => {
    const msg = { is_user: false, mes: '看视频', swipe_id: 0, swipes: ['看视频'], swipe_info: [{ extra: {} }], extra: {} };
    convertMessage(msg, convert);
    assert.equal(hasOriginal(msg), true);
    assert.equal(forgetOriginal(msg), true);
    assert.equal(hasOriginal(msg), false);
});

test('原文紀錄經過存檔（JSON）後依然能還原', () => {
    const msg = { is_user: false, mes: '粉丝发现', swipe_id: 0, swipes: ['粉丝发现'], swipe_info: [{ extra: {} }], extra: {} };
    convertMessage(msg, convert);
    const saved = JSON.parse(JSON.stringify(msg));
    restoreMessage(saved);
    assert.equal(saved.mes, '粉丝发现');
    assert.deepEqual(saved.swipes, ['粉丝发现']);
});

test('不需要轉換的訊息不留紀錄', () => {
    const msg = { is_user: false, mes: '已經是台灣用語的影片', swipe_id: 0, swipes: ['已經是台灣用語的影片'], swipe_info: [{ extra: {} }], extra: {} };
    assert.equal(convertMessage(msg, convert), false);
    assert.equal(hasOriginal(msg), false);
    assert.equal(msg.extra[RECORD_KEY], undefined);
});
