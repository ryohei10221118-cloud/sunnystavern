# 改良版 ST-Prompt-Template（Monaco 延遲載入）

放在本 repo 的 **`prompt-template-lazymonaco`** 分支。
它是 [zonde306/ST-Prompt-Template](https://github.com/zonde306/ST-Prompt-Template)
的修改版，授權沿用 AGPL-3.0，修改內容記載在該分支的 `MODIFICATIONS.md`。

---

## 解決什麼問題

原版把 Monaco Editor（VS Code 的編輯器核心）用**靜態 import** 打包進
`dist/index.js`，所以：

- `dist/index.js` 高達 **4.85MB**
- 擴充初始化時 `await cinit()` 必定執行，Monaco 必定被解析與初始化
- SillyTavern 的擴充是在 `activateExtensions()` 迴圈裡**逐一 await** 啟用的，
  排在後面的擴充全部被卡住
- 但 Monaco 只有在 `settings.code_editor` 為 true 時才用得到，
  **而這個設定預設是 `false`**

也就是說：多數使用者為一個沒開啟的功能，付出每次冷啟動數十秒的代價。

## 實測差異

於 SillyTavern 1.18.0 實機測試（同一台機器、同一份設定）：

| | 資源量 | 完成時間 | 落後本體 |
|---|---|---|---|
| SillyTavern 本體 | 7.68MB / 221 檔 | 1930ms | — |
| **原版擴充** | 8.54MB / 5 檔 | ~27000ms | **+22.5 秒** |
| **改良版** | 0.62MB / 3 檔 | 2028ms | **+98ms** |

`dist/index.js` 由 5,084,215 bytes 降為 642,016 bytes（**減少 87.4%**）。

## 功能有沒有變

沒有。只更動**載入時機**，沒有更動任何模板求值邏輯：

- EJS 語法、`getvar` / `setvar`、lodash (`_`)、faker 全部照舊
- 程式碼編輯器仍然可用，Monaco 會在你**第一次打開它**時才載入

---

## 安裝

SillyTavern 的擴充安裝介面只能裝 repo 的預設分支，所以要用指令安裝。
在 Zeabur 的「指令」（或你的伺服器 SSH）執行：

```sh
cd /home/node/app/public/scripts/extensions/third-party

# 先備份原版，確認沒問題再刪
mv ST-Prompt-Template /tmp/ST-Prompt-Template.orig 2>/dev/null

git clone --depth 1 -b prompt-template-lazymonaco \
  https://github.com/ryohei10221118-cloud/sunnystavern.git \
  ST-Prompt-Template

# 確認裝對了
cat ST-Prompt-Template/manifest.json | grep version
ls -la ST-Prompt-Template/dist/index.js
```

`version` 應該顯示 `1.17.8.1-lazymonaco`，`index.js` 應該是 **642016 bytes** 左右。

然後重新啟動服務。

### 一定要關掉自動更新

```
SILLYTAVERN_EXTENSIONS_AUTOUPDATE=false
```

不關的話，SillyTavern 會在版本變動時對這個擴充做 git 更新，把改良版覆蓋掉。
（`manifest.json` 裡的 `auto_update` 也已設為 `false`，但兩層都關比較保險。）

### 還原成原版

```sh
cd /home/node/app/public/scripts/extensions/third-party
rm -rf ST-Prompt-Template
mv /tmp/ST-Prompt-Template.orig ST-Prompt-Template
```

或直接從上游重裝：擴充面板 → Install extension →
`https://github.com/zonde306/ST-Prompt-Template`

---

## 維護

這是一份**分岔的版本**，不會自動跟上游同步。上游有重要更新時，需要重新套用修改：

```sh
git clone https://github.com/zonde306/ST-Prompt-Template.git
cd ST-Prompt-Template
# 依 MODIFICATIONS.md 重新套用四處改動
npm install --legacy-peer-deps
npm run build
```

比較根本的解法是向上游回報，請作者把 Monaco 改成延遲載入 ——
那樣所有人都受惠，也不用再自己維護分支。
