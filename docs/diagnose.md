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
