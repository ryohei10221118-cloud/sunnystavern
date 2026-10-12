# 台灣繁中即時轉換（zhtw-live）

SillyTavern 擴充。AI 每則回覆生成完，自動把**簡體／中國用語**轉成**台灣繁中**，並**存回聊天紀錄**。
模型下一輪在歷史裡看到的也是台灣用語，越聊越不會冒出中國用語。原文另外保存，隨時可以還原。

```
他打开手机看视频，发现信息太多了，屏幕一直弹出窗口。
→ 他打開手機看影片，發現訊息太多了，螢幕一直彈出窗口。
```

## 安裝（Zeabur）

到 Zeabur 服務的「指令」貼上整段執行，完成後**重新整理網頁**即可（不用重啟服務）：

```sh
cd /tmp && rm -rf zhtw-src && git clone --depth 1 -b claude/silly-tavern-setup-w23pkw https://github.com/ryohei10221118-cloud/sunnystavern.git zhtw-src && mkdir -p /home/node/app/data/default-user/extensions && rm -rf /home/node/app/data/default-user/extensions/zhtw-live && cp -r zhtw-src/st-extensions/zhtw-live /home/node/app/data/default-user/extensions/ && rm -rf /home/node/app/data/default-user/extensions/zhtw-live/test zhtw-src && echo "安裝完成" && ls /home/node/app/data/default-user/extensions/zhtw-live
```

裝在 `data` 資料夾裡，重新部署也不會消失。更新＝再貼一次同一段。

### 移除

先到設定按「還原目前聊天」（想保留繁中就不用按），再貼：

```sh
rm -rf /home/node/app/data/default-user/extensions/zhtw-live && echo "已移除"
```

## 使用

擴充（積木圖示）→「台灣繁中即時轉換」。

| 功能 | 說明 |
|---|---|
| 新訊息自動轉換 | 每則 AI 回覆生成完就轉換並存檔（含所有 swipe、按「繼續」續寫的部分） |
| 一併轉換思考過程 | 摺疊的思考內容也轉 |
| 轉換目前聊天 | 把舊聊天一次全部轉換 |
| 還原目前聊天 | 改回 AI 原文。轉換後你手動改過的訊息會保留你的修改 |
| 自訂替換 | 每行「原文=替換」 |
| 不轉換的詞 | 例如想維持簡體的角色名 |
| 試轉看看 | 貼一段文字先看效果，不會改到聊天 |

**不會被轉換的東西**：你自己打的字、`{{巨集}}`、網址、HTML 標籤與中文標籤名（`<状态栏>`）、
`<script>`／`<style>`，以及**角色卡／預設／全域正則裡出現的中文詞**（例如 `【小剧场】`），
所以狀態列、小劇場這類正則美化轉換後照常運作。

## 會不會拖慢開頁？

不會。開頁時只載入約 30KB 的程式；約 1MB（壓縮後約 430KB）的字典等到第一則訊息要轉換時才下載。

SillyTavern 1.18.0 實測（各 3 輪 × 7 次，交錯量測，從開頁到介面可用）：

| | 平均開頁時間 |
|---|---|
| 沒裝 | 3.41 秒 |
| 有裝 | 3.42 秒 |

差距在每次載入本身的浮動範圍內（同一個設定單次就會差 0.3～1 秒）。

## 轉換規則

1. [OpenCC](https://github.com/BYVoid/OpenCC) 簡體 → 台灣字形（只換字形，不用會轉過頭的詞彙模式）。
   已經是繁體的行不再轉一次，避免「托盤」被轉錯成「託盤」。
2. [OrchidTea 角色卡台灣繁中工具](https://orchidtea.github.io/st-card-zhtw/)的詞庫，
   用同一套詞庫，卡片和聊天的用字才會一致。
3. 本擴充補充的用語與前後文規則（`data/extra-rules.json`）。

第三方授權見 [NOTICE.md](NOTICE.md)。

## 開發

```sh
node --test test/run.mjs
```
