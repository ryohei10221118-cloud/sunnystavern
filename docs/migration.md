# 從舊酒館搬到新酒館

把你原本 Zeabur（或任何一台）上的角色卡、聊天記錄、世界書、預設全部搬過來。

---

## 先看這裡：三件會踩到的事

1. **內建備份 zip 不含 API key。** SillyTavern 匯出備份時會刻意排除 `secrets.json`，
   所以搬完之後你要**重新輸入一次 Gemini API key**。這是設計如此，不是搬壞了。
2. **搬檔案前一定要先把新酒館停掉。** SillyTavern 跑的時候會一直寫 `settings.json`，
   你邊放檔案它邊覆蓋，結果會很混亂。
3. **舊版還原到新版可以，新版還原到舊版不行。** SillyTavern 會自動升級舊的設定格式，
   但不會降級。所以搬家方向要是「舊 → 新」。

---

## 方法 A：整包搬（推薦，不用碰指令）

適用於**舊酒館還打得開**的情況。這是最完整的做法，連聊天記錄的資料夾結構都一模一樣。

### A-1. 從舊酒館下載備份

1. 打開舊酒館
2. 右上角**齒輪**圖示 → **User Settings**
3. 在 User Settings 面板裡找到 **Account** 按鈕（人像盾牌圖示）並點開
4. 彈出視窗裡往下捲到 **Account Actions** → 點 **Download Backup**
5. 會下載一個 `default-user-2026xxxx-xxxxxx.zip`

> 沒開多人帳號模式也看得到這個按鈕，不用特地去開帳號功能。

> 如果 Download Backup 按了沒反應，去看伺服器 log。可能是 `backups.allowFullDataBackup`
> 被設成 `false`，改成 `true` 再重啟就好。

### A-2. 把 zip 傳到新伺服器

在你自己的電腦上：

```bash
scp ~/Downloads/default-user-2026xxxx-xxxxxx.zip root@新伺服器IP:~/
```

（Windows 的話用 WinSCP 或 FileZilla 拖進去也可以。）

### A-3. 停掉新酒館，放進去

SSH 進新伺服器：

```bash
cd sunnystavern

# 1. 停掉 SillyTavern（Caddy 可以繼續跑）
docker compose stop sillytavern

# 2. 先把新酒館現有的資料留一份，萬一放錯還救得回來
mv data/default-user data/default-user.new 2>/dev/null || true
mkdir -p data/default-user

# 3. 解壓進去
apt-get install -y unzip   # 沒裝過的話
unzip ~/default-user-2026xxxx-xxxxxx.zip -d data/default-user

# 4. 確認長相正確：應該要看到 characters / chats / worlds / settings.json
ls data/default-user

# 5. 開回來
docker compose start sillytavern
docker compose logs -f sillytavern
```

### A-4. 回去補 API key

打開新酒館 → 插頭圖示（API Connections）→ Chat Completion → Google AI Studio →
貼上 Gemini key → Connect。

### A-5. 確認清單

逐項對一下，都在就成功了：

- [ ] 角色卡都在（左邊人像圖示）
- [ ] 隨便點一個角色，聊天記錄接得上
- [ ] 世界書 / Lorebook 還在（地球圖示）
- [ ] AI Response Configuration 裡的預設還在
- [ ] Persona 還在
- [ ] API 顯示 Connected，實際發一句話有回應

全部確認完之後，才把備份刪掉：

```bash
rm -rf data/default-user.new
```

---

## 方法 B：舊酒館已經開不起來，但摸得到檔案

如果 Zeabur 的服務還在、有掛 volume，而且平台給你 terminal / console：

```bash
# 在舊主機的容器裡
cd /home/node/app
tar czf /tmp/old-tavern.tar.gz data/default-user
```

然後用平台的檔案下載功能把 `/tmp/old-tavern.tar.gz` 拉下來，傳到新伺服器：

```bash
cd sunnystavern
docker compose stop sillytavern
mv data/default-user data/default-user.new 2>/dev/null || true
tar xzf ~/old-tavern.tar.gz -C data --strip-components=0
ls data/default-user
docker compose start sillytavern
```

這個方法**會**把 `secrets.json` 一起搬過來，所以 API key 不用重打。
但也代表這個 tar 檔裡有你的金鑰，傳完記得刪掉，不要留在下載資料夾。

---

## 方法 C：只想搬一部分

不想整包搬，只要幾張角色卡的話，全部都能在網頁 UI 上逐項匯出匯入：

| 要搬什麼 | 舊酒館怎麼匯出 | 新酒館怎麼匯入 |
|---|---|---|
| **角色卡** | 角色列表 → 點角色 → **Export and Download** → 選 `png`（PNG 會把資料嵌在圖裡） | 角色列表 → **Import Character** → 選檔案 |
| **聊天記錄** | 角色的聊天管理 → 該筆對話的匯出鈕 → 選 `jsonl` | 同一個面板 → Import → 選 `.jsonl` |
| **世界書 / Lorebook** | World Info 面板 → **Export** | World Info 面板 → **Import** |
| **預設 (Preset)** | AI Response Configuration → Preset 下拉旁的匯出鈕 → `json` | 同位置的匯入鈕 |
| **Persona** | User Settings → Persona Management → **Backup** | 同位置 → **Restore** |

**角色卡選 PNG，聊天記錄選 JSONL。** PNG 格式相容性最好，別的酒館也吃得下。

缺點是主題、UI 設定、統計數字這些搬不過去，而且角色多的話會點到手軟。
超過十張角色卡就直接走方法 A 比較快。

---

## 疑難排解

### 搬完之後角色卡是空的

檢查解壓的層級對不對。`data/default-user/` **底下**應該直接就是 `characters`、`chats`
這些資料夾，而不是又多包了一層：

```bash
# 對的
data/default-user/characters/

# 錯的（多包了一層）
data/default-user/default-user/characters/
```

錯了的話把裡面那層搬上來：

```bash
mv data/default-user/default-user/* data/default-user/
rmdir data/default-user/default-user
docker compose restart sillytavern
```

### log 出現 permission denied

如果你有在 `docker-compose.yml` 裡設 `PUID` / `PGID`，解壓出來的檔案擁有者對不上。修正：

```bash
sudo chown -R 1000:1000 data
docker compose restart sillytavern
```

（本 repo 的預設設定沒有設 PUID/PGID，容器裡是 root 在跑，通常不會遇到這個。）

### 聊天記錄在，但點進去是空白

聊天檔案是照**角色名稱**分資料夾放的（`chats/角色名/xxx.jsonl`）。
如果角色卡沒搬過來，或角色名稱不一樣，就對不上。先確認 `characters/` 裡的檔案有到齊。

### 想搬到一半反悔

方法 A 的第 2 步有先把原本的資料改名成 `data/default-user.new`，換回來就好：

```bash
docker compose stop sillytavern
rm -rf data/default-user
mv data/default-user.new data/default-user
docker compose start sillytavern
```

---

## 搬完之後

舊的 Zeabur 服務**先別急著刪**。跑個幾天，確認新酒館一切正常、聊天記錄都接得上，
再回去把舊的關掉。同時記得把手上的備份 zip 收好，那是你唯一的還原點。

之後的定期備份用：

```bash
bash deploy/update.sh    # 更新時會自動先備份
```

或手動：

```bash
tar czf ~/tavern-$(date +%F).tar.gz data config
```
