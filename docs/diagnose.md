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

### 最好的做法：在 UI 裡停用，不要動檔案

擴充面板（堆疊方塊圖示）→ 找到該擴充 → **停用**。

這是最乾淨的方式，因為 `activateExtensions()` 是**在載入 script 之前**就檢查的：

```js
const isDisabled = extension_settings.disabledExtensions.includes(name);
if (meetsModuleRequirements && ... && !isDisabled) {
    // 只有到這裡才會 addExtensionScript()
}
```

所以停用之後，那幾 MB 根本不會被下載、不會被 parse，排在它後面的擴充也不再等它。
設定存在 `settings.json` 裡，重啟依然有效，隨時可以再打開。

### 擴充可能裝在三個地方

`/api/extensions/discover` 會掃這三處：

| 位置 | 型別 | 說明 |
|---|---|---|
| `public/scripts/extensions/` | `system` | 內建擴充 |
| `data/<使用者>/extensions/` | `local` | **每位使用者各自的**，優先權最高 |
| `public/scripts/extensions/third-party/` | `global` | 全域第三方 |

三處的網址都長得像 `/scripts/extensions/third-party/<名稱>/`，
所以**光看網址分不出它裝在哪裡**。要動檔案之前先兩邊都找：

```sh
ls -la /home/node/app/public/scripts/extensions/third-party/
ls -la /home/node/app/data/default-user/extensions/
```

同名時 `local` 會蓋過 `global`——你可能刪了 global 那份，實際生效的還是 local 那份。

### 動檔案的測試：搬走再測

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

---

## 陷阱：source map 會讓量測結果嚴重失真

瀏覽器**只有在 DevTools 開著時**才會下載 `.js.map`。而你為了量測，一定是開著 DevTools 的。
如果某個擴充附帶巨大的 source map，你量到的數字會比日常使用慘得多。

實際案例：某擴充的 `dist/` 有 56MB，其中 **42MB 是 `.map`**，
單是 `index.js.map` 就 **16.9MB**（本體 `index.js` 才 4.85MB）。

刪掉那 94 個 `.map` 之後，同一個擴充的「最晚結束」變化：

| | 刪除前 | 刪除後 |
|---|---|---|
| SillyTavern 本體 | 2977ms | 15106ms |
| 該第三方擴充 | 26948ms（落後 **24 秒**） | 15423ms（落後 **0.3 秒**） |
| 排在它後面的內建擴充 | 27120ms | 14976ms |

**離群值完全消失。** 注意不要看絕對數字——刪除後那一輪是重啟後的第一次載入，
整頁都慢（所有項目都擠在 15 秒），所以要看的是**它和本體的差距**。

### 因此

- 量測前先確認目標擴充的 `dist/` 裡有沒有大量 `.map`：
  ```sh
  find <擴充目錄> -name '*.map' | wc -l
  du -sh <擴充目錄>/dist
  ```
- `.map` 純粹是除錯用的對照表，刪掉不影響任何功能：
  ```sh
  find <擴充目錄>/dist -name '*.map' -exec rm -f {} +
  ```
  （Alpine 的 BusyBox `find` 不一定支援 `-delete`，用 `-exec` 比較保險）
- 刪完記得把 `extensions.autoUpdate` 關掉，否則下次更新會全部載回來。
  擴充自己的 `manifest.json` 可能寫著 `"auto_update": true`，
  只能從 SillyTavern 這端擋。

### 判讀原則（重要）

**永遠拿「SillyTavern 本體」的完成時間當基準線，看相對差距，不要看絕對值。**
絕對值會被伺服器冷熱、快取狀態、當下網路影響而大幅跳動；
「某個擴充比本體晚幾秒」才是穩定且可比較的指標。

---

# 另一種慢：介面卡頓

前面整份文件講的是「**打開很慢**」——載入階段的問題。
但還有另一種完全不同的慢：**打開時很順，一點進對話就卡，之後做任何操作都要等好幾秒**。

兩者的成因和解法完全不同，先分清楚：

| 症狀 | 屬於 | 往哪查 |
|---|---|---|
| 打開網址後等很久才看到介面 | 載入慢 | 本文件前半部 |
| 介面出來了但卡在初始化 | 載入慢 | 各擴充體積、最晚結束 |
| **打開很順，點進對話才開始卡** | **介面卡頓** | 以下 |

## 先量規模

在 Console 貼上：

```js
(() => {
  const q = s => document.querySelectorAll(s).length;
  const out = [
    '訊息數        : ' + q('.mes'),
    'iframe 數     : ' + q('iframe'),
    '圖片數        : ' + q('img'),
    '<style> 標籤  : ' + q('style'),
    '總元素數      : ' + document.getElementsByTagName('*').length,
  ].join('\n');
  console.log(out);
  try { copy(out); } catch (e) {}
})()
```

參考值（實測一個會卡的環境）：

```
訊息數        : 101
iframe 數     : 27
圖片數        : 250
<style> 標籤  : 114
總元素數      : 38,592
```

同一環境的閒置長任務總阻塞達 **40 秒**、強制重排 **186ms**。

## 第一順位的解法：減少渲染的訊息數

**User Settings → `# Msg. to Load`（載入訊息數）**，預設 **100**。

SillyTavern 的實作：

```js
export async function printMessages() {
    let count = power_user.chat_truncation || Number.MAX_SAFE_INTEGER;
    if (chat.length > count) {
        startIndex = chat.length - count;
        chatElement.append('<div id="show_more_messages">Show more messages</div>');
    }
```

**它只決定畫面從第幾則開始渲染**，不影響聊天記錄檔案、不影響送給模型的內容（那由上下文長度決定）、也不影響世界書與記憶書（那些讀的是 `chat` 陣列）。

把 100 調成 **10～20**，DOM 規模大約降到五分之一。舊訊息用畫面頂端的
**Show more messages** 按鈕載入。

唯一的實際影響：要對舊訊息操作（編輯、標記記憶場景）時，得先按那個按鈕把它載出來。

## 為什麼訊息數的影響這麼大

主題與模板的成本是**乘以訊息數**的：

- 裝飾性主題會為每則訊息加上外框、紙膠帶、材質等背景圖
  （實測 101 則訊息產生 250 張圖片請求）
- 訊息中的 HTML 區塊會被 SillyTavern 放進 **iframe** 執行；
  每個 iframe 都是獨立文件，各自解析 HTML、套用 CSS、執行 JS、載入圖片

所以同樣一份主題或模板，在 10 則訊息下毫無感覺，在 100 則下就會癱瘓。

> **注意**：iframe 內部的資源**不會**出現在主文件的統計裡。
> 要看進去得用 `iframe.contentDocument`，且沙箱設定可能擋住。

## 陷阱：`/hide` 會讓 Regex 的深度限制失效

Regex 腳本可以設定「最大深度」，限制只套用到最近幾則訊息。但深度是這樣算的：

```js
const usableMessages = chat.map(...).filter(x => !x.message.is_system);
const indexOf = usableMessages.findIndex(x => x.index === Number(messageId));
const depth = messageId >= 0 && indexOf !== -1 ? (usableMessages.length - indexOf - 1) : undefined;
```

而深度檢查是：

```js
if (typeof depth === 'number') {   // undefined 就整段跳過
```

`/hide` 會把訊息標記為 `is_system`，這類訊息被排除在 `usableMessages` 之外，
`findIndex` 回傳 -1，`depth` 成為 `undefined`，**深度檢查被整個跳過**——
於是每一則隱藏訊息都會套用該 Regex。

實測結果：最大深度設為 1，未隱藏時只有最新 2 則生成卡片；
隱藏 150 則之後變成 **27 個 iframe**。

### 兩者可以並存

只要**載入訊息數夠小**，被隱藏的訊息根本不會被渲染，也就不會生成 iframe：

| 設定 | 管什麼 |
|---|---|
| `/hide 0-150` | 模型**讀**幾則（省 token） |
| 載入訊息數 = 10 | 畫面**畫**幾則（省效能） |

反過來說，若日後把載入訊息數調大並捲動到隱藏範圍，卡頓會再度出現。

## 判讀原則

1. **先分清楚是「載入慢」還是「操作卡」**——查錯方向會浪費大量時間。
2. **`buffered: true` 的長任務統計是累計值**，不重新整理就會一直帶著舊帳；
   要量當下狀態請用不帶 buffered 的觀察器，並在量測期間不要操作。
3. **主文件的統計看不到 iframe 內部**，改善了 iframe 內的東西，主文件數字不會變。
4. **成本會乘以訊息數**——先降訊息數，再去優化單則的成本。
