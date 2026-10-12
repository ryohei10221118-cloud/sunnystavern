# 第三方授權

本擴充內含以下第三方內容，各自依原授權條款使用：

| 檔案 | 來源 | 授權 |
|---|---|---|
| `lib/opencc-cn2t.js` | [opencc-js](https://github.com/nk2028/opencc-js) 1.0.5（The nk2028 Project） | MIT，全文見 `lib/LICENSE-opencc-js.txt` |
| `lib/opencc-cn2t.js` 內含的詞典資料 | [OpenCC](https://github.com/BYVoid/OpenCC) | Apache License 2.0 |
| `data/opencc-shared-chars.json` | 由 [OpenCC](https://github.com/BYVoid/OpenCC) 的 `STCharacters.txt` 計算出的繁簡共用字清單 | Apache License 2.0 |
| `data/dictionary.json` | [角色卡台灣繁中工具](https://github.com/orchidtea/st-card-zhtw)（OrchidTea）詞庫，版本 2026-09-26 | MIT，全文見 `data/LICENSE-dictionary.txt` |

`data/extra-rules.json`、`converter.js`、`message.js`、`index.js`、`style.css` 為本擴充原創。

沿用 OrchidTea 的詞庫，是為了讓「用該工具轉換過的角色卡」與「本擴充轉換的聊天內容」用字一致。
詞庫更新時，把新版 `dictionary.json` 覆蓋 `data/dictionary.json` 即可。
