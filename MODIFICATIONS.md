# 修改說明 / Modifications

本目錄是 [zonde306/ST-Prompt-Template](https://github.com/zonde306/ST-Prompt-Template)
的修改版，授權同為 **AGPL-3.0**（見 `LICENSE`）。原始碼完整保留於 `src/`。

## 為什麼要改

原版把 Monaco Editor（VS Code 的編輯器核心）以**靜態 import** 打包進
`dist/index.js`，因此：

- `dist/index.js` 達 **4.85MB**
- 擴充初始化時 `await cinit()` 一定會執行，Monaco 一定會被解析並初始化
- SillyTavern 的擴充是**依序 await 啟用**的，因此排在後面的擴充全部被卡住
- 而 Monaco 只在 `settings.code_editor` 為 true 時才用得到，**該設定預設是 `false`**

也就是說：絕大多數使用者為一個預設關閉的功能，付出了每次冷啟動數十秒的代價。

實測（雲端部署，SillyTavern 1.18.0）：

| | 完成時間 | 落後本體 |
|---|---|---|
| SillyTavern 本體 | 1930ms | — |
| 原版擴充 | ~27000ms | **+22.5 秒** |
| 本修改版 | 2028ms | **+98ms** |

## 改了什麼

1. **`src/modules/code-editor.ts`**
   - `import * as monaco from 'monaco-editor'` 改為動態 `await import('monaco-editor')`
   - 原本的 `init()` 拆成兩部分：
     - `registerEjsLanguage()`：所有 Monaco API 呼叫（語言註冊、主題、自動完成），
       移到 `ensureMonaco()` 裡，第一次開啟編輯器時才執行
     - `init()`：只保留與 Monaco 無關的世界書按鈕綁定
   - `showEditor()` 開頭加上 `await ensureMonaco()`

2. **`webpack.config.js`**
   - `devtool: 'source-map'` 改為 `false`。原本會產生 94 個 `.map` 共 42MB，
     而瀏覽器在 DevTools 開啟時會下載它們

3. **`package.json`**
   - 補上缺少的 `webpack` devDependency（原本僅有 `webpack-cli`，
     webpack 本體靠其他套件的 peer 傳遞帶入，無法穩定重現建置）

4. **`manifest.json`**
   - `display_name` 與 `version` 加註以便辨識
   - `auto_update` 設為 `false`，避免自動更新覆蓋回原版

## EJS 功能完全不變

只更動載入時機，沒有更動任何模板求值邏輯。`getvar` / `setvar` / `_` (lodash) /
`faker` / EJS 語法全部照舊。程式碼編輯器仍可使用，Monaco 會在你第一次開啟它時載入。

## 重新建置

```sh
npm install --legacy-peer-deps
npm run build
```

## 驗證

於 SillyTavern 1.18.0 實機測試：

- `ST-Prompt-Template initialized` 正常出現
- 初始化期間 `monaco-editor loaded` **不再出現**
- 擴充資源由 8.54MB／落後 22.5 秒，降為 0.62MB／落後 98ms
- Monaco 的 chunk 可經由動態 `import()` 正常載入（webpack 以
  `new URL("./", import.meta.url)` 解析路徑，不需設定 publicPath）
