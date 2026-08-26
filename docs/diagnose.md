# 診斷「打開很慢 / 卡在初始化」

不用猜，直接量。整個過程在瀏覽器裡完成，不用碰伺服器。

---

## 步驟

1. 用**電腦版 Chrome 或 Edge** 打開你的酒館
2. 按 **F12** → **Network（網路）** 分頁 → **勾選 Disable cache**
3. 切到 **Console** 分頁，輸入 `allow pasting` 按 Enter（先解鎖貼上）
4. 按 **Ctrl + Shift + R** 強制重新整理
5. **趁它還在初始化**，馬上把下面整段貼進 Console 按 Enter
6. 不用管它，**網路連續安靜 3 秒**後會自動印出結果並複製到剪貼簿

貼晚了也沒關係，`buffered: true` 會把它啟動前的紀錄補回來。
量測時點由程式自己決定，不再受你手動貼上的快慢影響。

```js
(() => {
  const tasks = [];
  try {
    new PerformanceObserver(l => tasks.push(...l.getEntries()))
      .observe({ type: 'longtask', buffered: true });
  } catch (e) { }

  const report = () => {
    const out = [];
    const P = (...a) => out.push(a.join(' '));
    const ms = v => Math.round(v) + 'ms';
    const mb = v => Math.round(v / 1048576 * 100) / 100 + 'MB';
    const n = performance.getEntriesByType('navigation')[0];
    const r = performance.getEntriesByType('resource').filter(x => x.responseEnd > 0);
    const now = performance.now();
    const lastEnd = r.length ? Math.max(...r.map(x => x.responseEnd)) : 0;
    const tx = r.reduce((a, x) => a + (x.transferSize || 0), 0) + (n.transferSize || 0);
    const dec = r.reduce((a, x) => a + (x.decodedBodySize || 0), 0) + (n.decodedBodySize || 0);

    P('=== 載入性質（先確認兩次量測條件一致）===');
    P('協定     :', n.nextHopProtocol || '?');
    P('實際傳輸 :', mb(tx), ' 原始:', mb(dec));
    P('判定     :', dec < 102400 ? '資料不足'
      : (tx < dec * 0.2 ? '★ 走快取，不是冷啟動' : '冷啟動'));
    P('請求數   :', r.length);

    P('');
    P('=== 時間軸 ===');
    P('TTFB          :', ms(n.responseStart - n.requestStart));
    P('Load 事件     :', ms(n.loadEventEnd));
    P('最後請求結束  :', ms(lastEnd));
    P('量測時點      :', ms(now), '（自動，非手動貼上）');
    P('JS 總阻塞     :', ms(tasks.reduce((a, x) => a + x.duration, 0)),
      '（' + tasks.length + ' 個長任務）');

    const evts = r.map(x => ({ s: x.startTime, e: x.responseEnd, n: x.name }))
      .sort((a, b) => a.s - b.s);
    let cover = 0, gs = 0, gz = 0, ga = '';
    evts.forEach(x => {
      if (x.s - cover > gz) { gz = x.s - cover; gs = cover; ga = x.n; }
      cover = Math.max(cover, x.e);
    });
    P('');
    P('=== 最大網路空窗 ===');
    P('從', ms(gs), '到', ms(gs + gz), ' 長度', ms(gz));
    P('空窗後第一個 :', ga.replace(location.origin, '').slice(0, 66));

    P('');
    P('=== 耗時最久的 10 個請求 ===');
    [...r].sort((a, b) => b.duration - a.duration).slice(0, 10)
      .forEach(x => P('  ', ms(x.duration).padStart(8), ' ',
        x.name.replace(location.origin, '').slice(0, 64)));

    P('');
    P('=== 最晚開始的 8 個請求 ===');
    evts.slice(-8).forEach(x => P('  ', ms(x.s).padStart(8), ms(x.e - x.s).padStart(7),
      ' ', x.n.replace(location.origin, '').slice(0, 60)));

    const txt = out.join('\n');
    console.log(txt);
    try { copy(txt); console.log('↑ 已複製到剪貼簿'); }
    catch (e) { console.log('↑ 請手動選取複製'); }
  };

  // 網路連續安靜 3 秒 = 初始化真的結束了，這時才量
  let timer;
  const arm = () => { clearTimeout(timer); timer = setTimeout(report, 3000); };
  new PerformanceObserver(arm).observe({ type: 'resource', buffered: true });
  arm();

  return '量測中… 網路安靜 3 秒後自動印出結果。';
})()
```

---

## 第二段：量伺服器的實際吞吐量

當你看到「TTFB 很低、CPU 0%、但一堆**靜態檔案**各花好幾百毫秒」，
那通常不是伺服器慢，是**頻寬**。這段直接量。

直接在**已經載入完成**的酒館頁面貼上就好，不用先重整。
它只會挑靜態檔案（`.js` / `.css` / 字型）來測，並且會先確認抓得到才開始計時。

> **判讀注意**：Mbps 是用**解壓後**的位元組數算的。檔案有 gzip 的話，
> 實際在線路上跑的位元組更少，所以這個數字會**高估**線路速率。
> 它適合拿來跟自己的測速結果比大小級距，不適合當精確的線路頻寬。

```js
(async () => {
  const isStatic = u => /\.(js|css|woff2?|ttf|png|jpg|webp|svg)(\?|$)/i.test(u)
    && !u.includes('/api/');
  let cands = performance.getEntriesByType('resource')
    .filter(x => isStatic(x.name) && x.decodedBodySize > 50000)
    .sort((a, b) => b.decodedBodySize - a.decodedBodySize)
    .map(x => new URL(x.name).pathname);
  // 保險：效能紀錄裡挑不到就直接用 SillyTavern 的主 bundle
  if (!cands.length) cands = ['/lib.js'];

  let url = null;
  for (const c of cands.slice(0, 5)) {
    try {
      const probe = await fetch(c + '?probe=' + Date.now(), { cache: 'no-store' });
      if (probe.ok && (await probe.arrayBuffer()).byteLength > 50000) { url = c; break; }
    } catch (e) { }
  }
  if (!url) return '找不到可測的靜態檔，請先強制重整一次再跑';

  const runs = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const res = await fetch(url + '?nocache=' + Date.now() + '-' + i, { cache: 'no-store' });
    if (!res.ok) return '抓取失敗 ' + res.status + '：' + url;
    const buf = await res.arrayBuffer();
    const sec = (performance.now() - t0) / 1000;
    const mb = buf.byteLength / 1048576;
    runs.push({ mb, sec, mbps: mb * 8 / sec });
  }
  const med = [...runs].sort((a, b) => a.mbps - b.mbps)[1];
  const out = [
    '=== 吞吐量測試 ===',
    '測試檔案 : ' + url,
    '檔案大小 : ' + med.mb.toFixed(2) + 'MB',
    ...runs.map((x, i) => '第 ' + (i + 1) + ' 次  : ' + x.sec.toFixed(2) + 's  '
      + x.mbps.toFixed(1) + ' Mbps'),
    '中位數   : ' + med.mbps.toFixed(1) + ' Mbps',
  ].join('\n');
  console.log(out);
  try { copy(out); console.log('↑ 已複製'); } catch (e) { }
})()
```

**接著做對照組**：用 [fast.com](https://fast.com) 或 Speedtest 測一次你自己的網路
（Speedtest 記得手動選**東京**的伺服器）。

| 結果 | 意思 |
|---|---|
| 酒館 ~8 Mbps，你的網路 100+ Mbps | **伺服器端頻寬受限**。換平台，或在前面加 CDN |
| 兩邊差不多都很低 | 是你的網路，不是伺服器 |
| 酒館 50+ Mbps | 頻寬沒問題，回頭查別的 |

### 如果確定是頻寬受限

SillyTavern 冷啟動要傳 **4MB 以上**的 JS/CSS/字型，全部都是**靜態且不會變**的檔案。
在前面加一層 CDN，這些東西就會被快取在離你最近的節點，不再每次都擠伺服器那條窄管：

- Cloudflare 免費方案就夠。把網域的 DNS 交給它，橘色雲朵打開
- 對 `/scripts/*`、`/lib.js`、`/webfonts/*`、`/css/*` 設快取規則
- 注意串流：設定好之後測一下 AI 回覆是不是還逐字出現，
  不是的話把 proxy 關掉再想別的辦法

自架的話，本 repo 的 Caddy 設定已經對這些路徑加了一週的瀏覽器快取，
但**第一次**還是要從伺服器抓，所以頻寬受限的平台換掉才是根治。

---

## 第三段：算出每個擴充各花你多少

**這段要在擴充「開著」的狀態下量**（如果你之前加了
`SILLYTAVERN_EXTENSIONS_ENABLED=false`，先拿掉並重啟）。

強制重整、等載完，然後貼上：

```js
(() => {
  const r = performance.getEntriesByType('resource');
  const groups = {};
  const add = (k, x) => {
    (groups[k] ??= { n: 0, dec: 0, tx: 0, dur: 0, last: 0 });
    groups[k].n++;
    groups[k].dec += x.decodedBodySize || 0;
    groups[k].tx += x.transferSize || 0;
    groups[k].dur += x.duration || 0;
    groups[k].last = Math.max(groups[k].last, x.responseEnd);
  };
  r.forEach(x => {
    const p = new URL(x.name).pathname;
    const m = p.match(/\/scripts\/extensions\/(third-party\/)?([^/]+)\//);
    add(m ? (m[1] ? '★ ' : '') + m[2] : '(SillyTavern 本體)', x);
  });
  const mb = v => (v / 1048576).toFixed(2) + 'MB';
  const rows = Object.entries(groups).sort((a, b) => b[1].dec - a[1].dec);
  const out = ['=== 各擴充的體積（★ = 第三方）===',
    '  解壓後    實際傳輸   檔數  最晚結束  名稱'];
  rows.forEach(([k, v]) => out.push('  ' + mb(v.dec).padStart(8) + '  ' + mb(v.tx).padStart(8)
    + '  ' + String(v.n).padStart(4) + '  ' + (Math.round(v.last) + 'ms').padStart(8) + '  ' + k));
  const ext = rows.filter(x => x[0] !== '(SillyTavern 本體)');
  out.push('');
  out.push('擴充合計 : ' + mb(ext.reduce((a, x) => a + x[1].dec, 0)) + ' 解壓後 / '
    + mb(ext.reduce((a, x) => a + x[1].tx, 0)) + ' 實際傳輸，共 '
    + ext.reduce((a, x) => a + x[1].n, 0) + ' 個檔案');
  const txt = out.join('\n');
  console.log(txt);
  try { copy(txt); console.log('↑ 已複製'); } catch (e) { }
})()
```

**怎麼讀**：

- `解壓後`才是瀏覽器要 parse 和執行的量，**這個數字對 CPU 的負擔最直接**，
  手機上尤其明顯
- `實際傳輸`是走網路的量，跟你的頻寬有關
- `最晚結束`很大的那個，就是**拖住初始化的兇手**

一個擴充如果解壓後超過 1MB，就值得問「這功能值不值這個代價」。
超過 3MB 基本上就是在拿整站的啟動速度換它。

### 怎麼移除某個擴充

在 SillyTavern 裡：擴充面板（堆疊方塊圖示）→ 找到該擴充 → 刪除。

或直接動檔案（Zeabur 的「指令」按鈕可以進容器）：

> 官方 image 是 Alpine，**只有 `sh` 沒有 `bash`**。下面的指令都是 sh 相容的。

```sh
cd /home/node/app/public/scripts/extensions/third-party
du -sh */                 # 各擴充佔多少磁碟
```

**但磁碟大小會騙人**。擴充是用 git clone 裝的，`du` 把 `.git` 也算進去了，
而 `.git` 完全不會送到瀏覽器。要看真正影響載入速度的部分：

```sh
for d in */; do
  echo "--- $d"
  du -sh "$d.git" 2>/dev/null
  du -sh --exclude=.git "$d" 2>/dev/null || du -sh "$d"
done
```

不過 `.git` 很大本身也有代價：`extensions.autoUpdate` 開著的話，
**SillyTavern 版本一變動，下次載入就會對每個擴充做 git 更新，而且是被
`await` 住的**——repo 越大這一次越久。設 `extensions.autoUpdate: false` 可以避免。

### 決定性的測試：搬走再測

```sh
cd /home/node/app/public/scripts/extensions/third-party
mv 擴充名稱 /tmp/          # 先搬走，不要刪
```

重啟服務，開一次看看。變快就是它。要還原就搬回來：

```sh
mv /tmp/擴充名稱 /home/node/app/public/scripts/extensions/third-party/
```

> 注意：如果這個目錄沒有掛持久化磁碟，搬到 `/tmp` 的東西在容器重建後會消失。
> 重要的擴充請先確認它在 GitHub 上還裝得回來，或先備份出來。

---

## 已知瓶頸：`/api/settings/get`

如果你量出來這個 endpoint 特別慢（幾百毫秒以上），那不是你的錯，是它的實作方式：

每一次載入頁面，這個 endpoint 都會**同步**掃過 12 個目錄，把裡面每個 JSON
逐一讀出來並解析——instruct、context、sysprompt、reasoning、themes、
movingUI、QuickReplies、worlds，加上四家 API 的預設集。

光是 SillyTavern 內建的預設就有 **134 個檔案**，還沒算你自己加的。

關鍵在於它用的是 `readdirSync` / `readFileSync`。Node 是單執行緒，
這段期間**整個伺服器是凍住的**，什麼請求都處理不了。

這在本機 SSD 上大概 30ms 無感，但在**網路掛載的雲端磁碟**上，
每個小檔案的讀取都要走一次網路，134 個檔案就會放大成好幾百毫秒。
這也解釋了為什麼你會看到「CPU 用量 0% 但就是很慢」——它不是在算，是在等磁碟。

**能做的**：

- 刪掉用不到的預設集（`instruct` 和 `context` 各有 30 幾個，你大概只用一兩個）
- 刪完之後把 `skipContentCheck` 設成 `true`，否則下次啟動會全部補回來
- 如果雲端平台有「本機磁碟 / SSD」選項，優先選它，不要用網路儲存

> 注意：刪預設集前先備份。這個改善的是每次載入固定的幾百毫秒，
> 如果你的問題是「卡好幾秒」，那主因不在這裡，別先動它。

---

## 已知瓶頸：擴充功能是「一個一個」載入的

`public/scripts/extensions.js` 的 `activateExtensions()`：

```js
for (let entry of extensions) {
    ...
    await promise   // ← 在迴圈裡 await
}
```

擴充是**依序**啟用的，前一個沒跑完 `activate` hook，下一個不會開始。
SillyTavern 內建就有四十幾個擴充，再加上第三方的，只要其中一個在等網路，
後面全部排隊，初始化就會停在那裡。

而且這整段在初始化流程裡是被 `await` 的：

```js
await loadExtensionSettings(settings, isVersionChanged, enableAutoUpdate);
```

擴充沒載完，初始化不會往下走。

### 先確認變數真的生效了

改完環境變數、重啟之後，在 Console 貼這一行：

```js
performance.getEntriesByType('resource').filter(x => x.name.includes('/extensions/')).length
```

- **回傳 `0`** → 擴充真的關掉了，A/B 測試有效
- **回傳幾十** → 變數沒生效，下面的測試結果不算數

會沒生效通常是：環境變數存了但服務沒真正重新啟動（要重新部署，
不是只按重新整理），或是變數加在錯的服務上。

`ENABLE_EXTENSIONS` 是在模組載入時就讀取並固定下來的：

```js
const ENABLE_EXTENSIONS = !!getConfigValue('extensions.enabled', true, 'boolean');
```

所以**一定要重啟 process** 才會重新讀。

### 兩分鐘的 A/B 測試

在平台的環境變數加一條，重新啟動：

```
SILLYTAVERN_EXTENSIONS_ENABLED=false
```

這會讓前端直接跳過整個 `loadExtensionSettings`。

- **變快** → 就是擴充。再一個一個關，找出是哪一個
- **一樣慢** → 擴充無罪，往別的方向查

測完把環境變數刪掉就完全恢復，不會動到任何資料。

> 另外注意 `extensions.autoUpdate`（預設 `true`）：**SillyTavern 版本變動後的
> 第一次載入**，會在初始化過程中對每個第三方擴充做一次 git 更新，而且是
> 被 await 的。那一次會特別久。設成 `false` 可以避免。

---

## 實際案例：一個擴充讓初始化從 3 秒變成 27 秒

某次診斷的實測結果（雲端部署、東京、Gemini）：

```
解壓後   實際傳輸  檔數  最晚結束  名稱
8.57MB   2.05MB     5   26948ms  ★ ST-Prompt-Template
7.41MB   0.14MB   222    2977ms  (SillyTavern 本體)
0.02MB   0.00MB     4   27120ms  regex
0.00MB   0.00MB     1    2827ms  ★ MoonlitEchoesTheme
0.00MB   0.00MB     1    2835ms  ★ JS-Slash-Runner
```

**讀法**：

1. 本體 222 個檔案在 **2977ms** 全部結束。基礎建設沒有問題。
2. 一個第三方擴充解壓後 **8.57MB**，比整個 SillyTavern 本體的 7.41MB 還大，
   而它的載入鏈一路延伸到 **26948ms**。
3. `regex` 本身只有 0.02MB，卻也卡到 **27120ms**——它排在後面，
   被 `activateExtensions()` 迴圈裡的 `await` 擋住了。

**確認不是頻寬**：該擴充實際只傳了 2.05MB。以當時量到的吞吐量，
這些位元組半秒內就該傳完。多出來的二十幾秒是**解析與執行**
8.57MB JavaScript 的成本——行動裝置 CPU 較弱，會更嚴重。

### 這個案例的通用教訓

- **看「最晚結束」，不要只看體積。** 體積小卻結束得晚，代表它被別人擋住了；
  找出那個結束時間相近、體積又大的，才是元兇。
- **和本體的數字對比。** 本體的完成時間就是你的基準線，
  任何遠大於它的項目都值得質疑。
- **傳輸量小但結束得晚 = CPU 問題，不是網路問題。** 加 CDN 或換機房都不會有幫助。
