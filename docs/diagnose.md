# 診斷「打開很慢 / 卡在初始化」

不用猜，直接量。整個過程在瀏覽器裡完成，不用碰伺服器。

---

## 步驟

1. 用**電腦版 Chrome 或 Edge**打開你的酒館網址
2. 按 **F12** 開開發者工具，切到 **Console（主控台）** 分頁
3. 按 **Ctrl + Shift + R**（Mac 是 Cmd + Shift + R）**強制重新整理**
4. **等到酒館完全載入完**（初始化跑完、角色列表出來為止）
5. 回到 Console，把下面整段貼進去按 Enter

> Chrome 可能會擋你貼上，並要你先手動輸入 `allow pasting` 再按 Enter。照做就好。

```js
(() => {
  const n = performance.getEntriesByType('navigation')[0];
  const r = performance.getEntriesByType('resource');
  const ms = v => Math.round(v) + 'ms';
  const kb = v => Math.round((v || 0) / 1024) + 'KB';
  const out = [];
  const P = (...a) => out.push(a.join(' '));

  P('=== 主文件 ===');
  P('HTTP 協定 :', n.nextHopProtocol || '(不明)');
  P('DNS       :', ms(n.domainLookupEnd - n.domainLookupStart));
  P('TCP       :', ms(n.connectEnd - n.connectStart));
  P('TLS       :', n.secureConnectionStart ? ms(n.connectEnd - n.secureConnectionStart) : '(非 HTTPS)');
  P('TTFB 等待 :', ms(n.responseStart - n.requestStart));
  P('下載 HTML :', ms(n.responseEnd - n.responseStart), kb(n.transferSize), '(原始', kb(n.decodedBodySize) + ')');
  P('DOM 完成  :', ms(n.domContentLoadedEventEnd));
  P('Load 完成 :', ms(n.loadEventEnd));

  P('');
  P('=== 資源總覽 ===');
  P('請求數    :', r.length);
  P('總傳輸量  :', Math.round(r.reduce((a, x) => a + (x.transferSize || 0), 0) / 1048576 * 100) / 100 + 'MB');
  const proto = {};
  r.forEach(x => { const k = x.nextHopProtocol || '(快取)'; proto[k] = (proto[k] || 0) + 1; });
  P('協定分布  :', JSON.stringify(proto));
  const noEnc = r.filter(x => x.decodedBodySize > 10240 && x.encodedBodySize >= x.decodedBodySize).length;
  P('沒被壓縮的大檔 :', noEnc);

  P('');
  P('=== 最慢的 10 個資源 ===');
  [...r].sort((a, b) => b.duration - a.duration).slice(0, 10)
    .forEach(x => P(' ', ms(x.duration).padStart(8), kb(x.transferSize).padStart(8), ' ', x.name.replace(location.origin, '').slice(0, 70)));

  P('');
  P('=== 最慢的 10 個 API 呼叫 ===');
  [...r].filter(x => ['xmlhttprequest', 'fetch'].includes(x.initiatorType))
    .sort((a, b) => b.duration - a.duration).slice(0, 10)
    .forEach(x => P(' ', ms(x.duration).padStart(8), kb(x.transferSize).padStart(8), ' ', x.name.replace(location.origin, '').slice(0, 70)));

  const txt = out.join('\n');
  console.log(txt);
  let copied = false;
  try { copy(txt); copied = true; } catch (e) {}
  return copied ? '↑ 結果已複製到剪貼簿，直接貼出來即可' : '↑ 請把上面整段結果選取複製';
})()
```

6. 結果會印在 Console，**同時也自動複製到剪貼簿了**，直接貼出來就好

---

## 第二段：量「初始化」卡在哪

上面那段量的是**網路**。但如果網路數字都很漂亮、Load 也在一秒內，
你卻還是覺得卡很久，那時間就是花在 **JS 執行**上——這在資源計時裡完全看不到。

一樣的操作（強制重新整理 → 等完全載入完 → 貼進 Console）：

```js
(() => {
  const out = [];
  const P = (...a) => out.push(a.join(' '));
  const ms = v => Math.round(v) + 'ms';
  const n = performance.getEntriesByType('navigation')[0];
  const r = performance.getEntriesByType('resource');

  // 這次是不是走快取？沒有這一行，數字會被誤讀
  const transferred = r.reduce((a, x) => a + (x.transferSize || 0), 0) + (n.transferSize || 0);
  const decoded = r.reduce((a, x) => a + (x.decodedBodySize || 0), 0) + (n.decodedBodySize || 0);
  P('=== 這次載入的性質 ===');
  P('實際傳輸 :', Math.round(transferred / 1048576 * 100) / 100 + 'MB');
  P('原始大小 :', Math.round(decoded / 1048576 * 100) / 100 + 'MB');
  P('判定     :', decoded < 102400 ? '資料不足' : (transferred < decoded * 0.2 ? '★ 走快取（不是冷啟動，數字會偏樂觀）' : '冷啟動（真實首次載入）'));

  P('');
  P('=== 時間軸 ===');
  P('Load 事件    :', ms(n.loadEventEnd));
  P('現在         :', ms(performance.now()));
  P('Load 後又花了:', ms(performance.now() - n.loadEventEnd), '← 初始化如果卡，卡在這段');

  // longtask 只能透過 observer 的 callback 拿，getEntriesByType 不支援
  const tasks = [];
  try {
    new PerformanceObserver(list => tasks.push(...list.getEntries()))
      .observe({ type: 'longtask', buffered: true });
  } catch (e) { }
  setTimeout(() => {
    P('');
    P('=== JS 卡住的長任務（>50ms）===');
    if (!tasks.length) {
      P('  取不到（Chrome 才支援，或這次沒有長任務）');
    } else {
      const total = tasks.reduce((a, x) => a + x.duration, 0);
      P('  數量:', tasks.length, ' 總阻塞:', ms(total));
      [...tasks].sort((a, b) => b.duration - a.duration).slice(0, 8)
        .forEach(x => P('  ', ms(x.duration).padStart(8), '@', ms(x.startTime)));
    }
    const txt = out.join('\n');
    console.log(txt);
    let ok = false;
    try { copy(txt); ok = true; } catch (e) { }
    console.log(ok ? '↑ 已複製到剪貼簿' : '↑ 請手動選取複製');
  }, 300);
  return '量測中，0.3 秒後印出結果…';
})()
```

**要看的**：

- `判定` 那行如果是「走快取」，代表這次不是真實的首次載入，
  要開 DevTools 的 **Network 分頁 → 勾選 Disable cache**，保持 DevTools 開著再重整一次
- `Load 後又花了` 如果是好幾秒，那就是 **JS 在跑**，不是網路問題
- `總阻塞` 很大 → 有擴充功能或大量資料在拖累初始化

---

## 怎麼讀這些數字

### `HTTP 協定` 這一行最關鍵

| 值 | 意思 |
|---|---|
| `h2` 或 `h3` | 好。可以多路複用，幾百個檔案能同時抓 |
| `http/1.1` | **這就是元兇**。瀏覽器對同一網域最多只開 6 條連線，幾百個檔案要排隊，距離越遠放大越明顯 |

### `TTFB 等待`

- **< 100ms** — 伺服器很健康，問題不在它
- **100–500ms** — 主要是距離造成的往返時間
- **> 1000ms** — 伺服器真的在忙或在等別的東西，要往回查

### `請求數` 和 `協定分布`

SillyTavern 首頁大約會發 **200–400 個請求**。如果協定分布裡 `http/1.1` 佔了絕大多數，
而 `TTFB` 又很低，那就百分之百是連線數瓶頸，跟伺服器效能無關。

### `最慢的 10 個 API 呼叫`

如果某個 `/api/...` 卡了好幾秒，那就是**初始化在等它**，跟前端檔案數量無關，
要另外查那個 endpoint 在幹嘛。常見的是擴充功能自動更新、模型自動下載。

### `沒被壓縮的大檔`

應該是 **0**。不是 0 的話代表中間有東西把 SillyTavern 的 gzip 拆掉了。

---

## 對照：怎麼修

| 量出來的結果 | 意思 | 怎麼修 |
|---|---|---|
| `http/1.1` + TTFB 低 + 請求數幾百 | 連線數瓶頸 | 換一個支援 HTTP/2 的入口（自架 Caddy 預設就是 h2/h3），或在前面加 CDN |
| TTFB > 1s | 伺服器在等別的東西 | 看伺服器 log，通常是啟動時的 git pull / 模型下載 |
| 某個 `/api/` 卡好幾秒 | 特定功能拖住初始化 | 關掉 `extensions.autoUpdate` 和 `extensions.models.autoDownload` |
| 全部都很快但體感還是慢 | 資料量太大 | 開 `performance.lazyLoadCharacters`，清掉舊備份 |
| `沒被壓縮的大檔` > 0 | 壓縮被中間層拆掉 | 檢查反向代理設定 |

---

## 補充：手機上也能量

手機不方便開 Console，但你可以用這個方式間接判斷：
**用手機的行動網路（不要用同一個 Wi-Fi）再開一次**。

- 行動網路明顯更慢 → 是「檔案多 + 連線數少」的問題，頻寬和延遲一放大就爆
- 兩邊一樣慢 → 是伺服器端在等東西，跟你的網路無關

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
