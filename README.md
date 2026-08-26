# SunnyTavern — 雲端 SillyTavern 架設指南

一整套可以直接用的雲端 SillyTavern 部署設定，針對「**台灣連線速度**」和「**公開在網路上的安全性**」調校過。

目前對應 SillyTavern **1.18.0**，API 用 **Google Gemini（Google AI Studio）**。

---

## 目錄

1. [先講結論：你在 Zeabur 上為什麼慢](#1-先講結論你在-zeabur-上為什麼慢)
2. [三條路，怎麼選](#2-三條路怎麼選)
3. [路線 A：東京 VPS + Docker（推薦）](#3-路線-a東京-vps--docker推薦)
4. [路線 B：把你原本的 Zeabur 修好](#4-路線-b把你原本的-zeabur-修好)
5. [設定 Gemini API Key](#5-設定-gemini-api-key)
6. [推薦的 Gemini 參數](#6-推薦的-gemini-參數)
7. [日常維護：更新、備份、加人](#7-日常維護更新備份加人)
8. [疑難排解](#8-疑難排解)

---

## 1. 先講結論：你在 Zeabur 上為什麼慢

「loading 很慢」通常不是單一原因，而是下面幾個疊在一起。先分清楚是哪一種，才知道要修哪裡：

| 症狀 | 真正的原因 | 怎麼修 |
|---|---|---|
| **隔一陣子沒用，第一次打開要等 30 秒以上；之後就正常** | 容器休眠了（免費 / Serverless 方案沒流量就把容器關掉），你這一次的請求在等它冷啟動 | 換成常駐的方案，或直接換 VPS |
| **每次打開都慢，連按鈕都鈍鈍的** | 伺服器在美國或歐洲。SillyTavern 首頁要載入幾百個 JS/CSS 檔，每一個都要跨太平洋來回一趟 | 把伺服器搬到東京 / 大阪 / 新加坡 |
| **第一次打開特別久，之後就好一點** | 首頁本身很肥（實測 HTML 就 **734 KB**，壓縮後 86 KB），加上幾百個 JS/CSS 要抓。距離遠的時候這些請求的往返時間會被放大好幾倍 | 縮短距離（換區域）+ 讓瀏覽器快取靜態檔（本 repo 的 Caddy 已設好） |
| **重新部署後角色卡和聊天記錄不見了** | 沒有掛持久化磁碟，容器重建就整個消失 | 一定要掛 volume 到 `data` 目錄 |
| **每次 deploy 都要等好幾分鐘** | 用了 Node.js buildpack 從原始碼 build，每次都重跑 `npm ci` 和 webpack | 改用官方預先做好的 Docker image |
| **啟動要等很久才有反應** | SillyTavern 預設會在啟動時 `git pull` 所有第三方擴充、下載 HuggingFace 模型和 tokenizer | 本 repo 的 `config/config.yaml` 已經把這些關掉了 |
| **AI 回覆不是逐字出現，是等很久然後一次全部跳出來** | 反向代理把串流回應緩衝住了 | Caddy 要設 `flush_interval -1`（本 repo 已設好） |

> **關於壓縮**：SillyTavern 本身就內建了 gzip 壓縮（`compression` middleware，預設開啟），
> 所以這一項通常不是你的問題。要注意的是**不要讓中間的代理把它拆掉**——
> 本 repo 的 Caddy 設定是直接把上游壓好的內容原樣轉出去，不會重壓也不會解壓。

還有一個容易被忽略的：**伺服器的位置也會影響 AI 回覆速度**。SillyTavern 是由伺服器去呼叫 Gemini，不是你的瀏覽器直接打。所以伺服器在美國的話，你的每一句話都要「台灣 → 美國 → Google → 美國 → 台灣」跑一圈。

> **一句話總結**：Zeabur 本身沒問題，慢的是「免費方案會休眠」+「區域太遠」+「沒掛持久磁碟」這三件事。你可以付費把它修好（路線 B），也可以花差不多的錢換一台完全屬於自己的機器（路線 A）。

---

## 2. 三條路，怎麼選

| | 路線 A：東京 VPS | 路線 B：修好 Zeabur | 路線 C：Hugging Face Space |
|---|---|---|---|
| 月費 | US$5–6，或 Oracle 免費方案 $0 | 看方案，約 US$5 起 | $0 |
| 從台灣的延遲 | 最低（東京約 30–50ms） | 看你選的區域 | 高，而且不固定 |
| 資料會不會掉 | 不會 | 掛了 volume 就不會 | **會**，重啟就沒了 |
| 會不會休眠 | 不會 | 付費方案不會 | 會 |
| 難度 | 中（要會用一點 Linux 指令） | 低 | 低 |
| 適合 | 想長期穩定用、資料重要 | 想用最少力氣改善現況 | 只是想試玩 |

**我的建議**：既然你已經願意花時間弄，直接走**路線 A**。一台東京的小 VPS 一個月不到兩百塊台幣，速度、穩定度、資料安全都是另一個等級，而且以後想加什麼功能都不受平台限制。

如果你想先用零成本試試看，**Oracle Cloud 的 Always Free ARM 機器**（東京或大阪區）給到 4 核 24GB，跑 SillyTavern 綽綽有餘，而且官方 image 有 arm64 版本可以直接跑。缺點是註冊比較麻煩、偶爾搶不到機器。

---

## 3. 路線 A：東京 VPS + Docker（推薦）

### 3.1 開一台機器

任選一家，開機時**區域一定要選東京（Tokyo / ap-northeast）**：

- **Vultr** — US$6/月，1 vCPU / 1GB。介面簡單，開機一分鐘。
- **DigitalOcean** — US$6/月，1 vCPU / 1GB，新戶常有 $200 額度。
- **Linode (Akamai)** — US$5/月，1 vCPU / 1GB。
- **Oracle Cloud** — Always Free，ARM Ampere 最多 4 核 / 24GB，$0。

系統選 **Ubuntu 24.04 LTS**。記憶體 1GB 就夠跑，但如果你之後想開向量資料庫之類的擴充，建議 2GB。

### 3.2 把網域指過來

你需要一個網域（Cloudflare / Namecheap / Gandi 買，一年幾百塊；`.xyz` 之類的第一年幾十塊）。

到 DNS 設定加一筆：

```
類型   名稱      值
A     tavern    你的伺服器 IP
```

這樣 `tavern.你的網域.com` 就會指到伺服器。等個幾分鐘生效。

> 如果你用 Cloudflare 管 DNS，**第一次部署請先把橘色雲朵關掉（DNS only）**，讓 Caddy 順利申請憑證。成功之後要不要打開再說（見 [8.4](#84-要不要掛-cloudflare)）。

### 3.3 SSH 進去，裝環境

```bash
ssh root@你的伺服器IP

# 抓這個 repo
git clone https://github.com/ryohei10221118-cloud/sunnystavern.git
cd sunnystavern

# 裝 Docker、開防火牆（一鍵）
bash deploy/bootstrap-ubuntu.sh
```

如果剛剛腳本提示你要重新登入才能不用 sudo 跑 docker，就 `exit` 再 `ssh` 進來一次。

### 3.4 填設定

```bash
cp .env.example .env
nano .env
```

三個東西要填：

```bash
ST_DOMAIN=tavern.你的網域.com
ST_USER=sunny
ST_PASSWORD=貼上一組長密碼
```

密碼可以這樣產生一組：

```bash
openssl rand -base64 24
```

**這組帳密是你整個酒館唯一的門鎖**，網址是公開的，密碼弱就等於沒鎖。存檔離開（`Ctrl+O`, `Enter`, `Ctrl+X`）。

### 3.5 啟動

```bash
docker compose up -d
docker compose logs -f
```

看到類似這樣就成功了：

```
SillyTavern is listening on: http://0.0.0.0:8000
```

`Ctrl+C` 離開 log（容器會繼續在背景跑）。

現在用瀏覽器打開 `https://tavern.你的網域.com`，會先跳出帳號密碼視窗，輸入你剛剛設的那組，就進到 SillyTavern 了。

> 第一次開啟因為要申請憑證，可能要多等 10–30 秒。如果一直轉，看 `docker compose logs caddy` 有沒有憑證錯誤。

### 3.6 收尾：鎖上 Host 白名單

確認網域可以正常連之後，回頭改一下 `config/config.yaml`：

```yaml
hostWhitelist:
  enabled: true
  scan: true
  hosts:
    - tavern.你的網域.com
```

然後 `docker compose restart sillytavern`。這樣別人拿你的 IP 直接掃就進不來了。

---

## 4. 路線 B：把你原本的 Zeabur 修好

如果你想留在 Zeabur，照這四點改，速度問題大部分會消失：

**1. 別從原始碼 build，改用官方 image**

在 Zeabur 新增服務時選「Docker Image」，填：

```
ghcr.io/sillytavern/sillytavern:latest
```

Port 填 `8000`。這樣每次部署不用重跑 `npm ci` 和 webpack，快非常多。

**2. 掛持久化 Volume**

至少要掛這兩個，不然重啟資料全沒：

```
/home/node/app/data      ← 角色卡、聊天記錄、API key
/home/node/app/config    ← 設定檔
```

**3. 選亞洲區域，並確認方案不會休眠**

Zeabur 的區域在專案設定裡選，挑**東京**或**香港**。同時確認你的方案是常駐的，不是沒流量就睡著的那種——這是「隔很久第一次打開超慢」的元凶。

**4. 用環境變數把設定灌進去**

SillyTavern 的每個設定都能用環境變數覆蓋，規則是「路徑轉大寫、點換底線、加 `SILLYTAVERN_` 前綴」。在 Zeabur 的環境變數頁面加上：

```
SILLYTAVERN_LISTEN=true
SILLYTAVERN_WHITELISTMODE=false
SILLYTAVERN_BASICAUTHMODE=true
SILLYTAVERN_BASICAUTHUSER_USERNAME=sunny
SILLYTAVERN_BASICAUTHUSER_PASSWORD=你的長密碼
SILLYTAVERN_BROWSERLAUNCH_ENABLED=false
SILLYTAVERN_EXTENSIONS_AUTOUPDATE=false
SILLYTAVERN_EXTENSIONS_MODELS_AUTODOWNLOAD=false
SILLYTAVERN_PERFORMANCE_LAZYLOADCHARACTERS=true
SILLYTAVERN_PERFORMANCE_USEDISKCACHE=true
SILLYTAVERN_LOGGING_ENABLEACCESSLOG=false
SILLYTAVERN_FORWARDEDHEADERS_XFORWARDEDFOR=true
SILLYTAVERN_HEARTBEATINTERVAL=30
```

> `BASICAUTHMODE=true` 不是選配。SillyTavern 偵測到 `listen: true` 但沒有任何一種驗證機制時，會**直接拒絕啟動**。這是它的保護設計，不要用 `securityOverride` 繞過去。

同樣的環境變數也可以用在 Railway、Render、Fly.io、Hugging Face Space 上，做法一模一樣。

---

## 5. 設定 Gemini API Key

API key **不要**寫進設定檔或環境變數，直接在網頁裡輸入就好，它會存在 `data/default-user/secrets.json`（有掛 volume 就不會掉）。

1. 到 [Google AI Studio](https://aistudio.google.com/apikey) 拿你的 key（`AIza...` 開頭）
2. 在 SillyTavern 左上角點**插頭圖示**（API Connections）
3. **API** 選 `Chat Completion`
4. **Chat Completion Source** 選 **`Google AI Studio`**
   （這個選項在舊版叫 MakerSuite，是同一個東西）
5. **Google AI Studio API Key** 貼上你的 key，按 **Connect**
6. **Google Model** 選一個模型（建議見下一節）

右上角變綠色的 `Connected` 就成功了。

> **注意**：Google AI Studio 的免費層級有「你的內容可能被用於改善產品」的條款，而且有每分鐘/每日請求上限。如果你在意隱私或會用得很兇，考慮綁定帳單改用付費層級，或改走 Vertex AI。

---

## 6. 推薦的 Gemini 參數

SillyTavern 1.18.0 內建的 Gemini 模型清單裡，實用的幾個：

| 模型 | 適合 |
|---|---|
| `gemini-3-pro-preview` | 品質最好，長對話的連貫性最強，但比較慢也比較貴 |
| `gemini-3-flash-preview` | **日常首選**。速度和品質的平衡點 |
| `gemini-2.5-flash` | 穩定的正式版，額度寬鬆，適合大量對話 |
| `gemini-2.5-pro` | 想要 2.x 系列的最高品質時用 |
| `gemini-2.5-flash-lite` | 最便宜最快，適合當摘要 / 翻譯的副模型 |

在 **AI Response Configuration**（左邊滑桿圖示）裡幾個值得調的：

- **Temperature** — 角色扮演建議 `0.9 ~ 1.1`。太低會很制式，太高會語無倫次。
- **Streaming** — **開啟**。這樣文字會逐字出現，體感速度差非常多（本 repo 的 Caddy 設定已經確保串流不會被緩衝）。
- **Context Size** — Gemini 的上下文很大，但**不要無腦拉滿**。每次請求都要重送整個上下文，拉滿會讓每一句都變慢也變貴。`32000 ~ 64000` 對一般對話很夠。
- **Max Response Length** — `500 ~ 1000` tokens。太大會讓 AI 寫落落長。

安全設定（Google 的內容過濾）在同一頁往下找 **Google Safety Settings**，可以逐項調整。

---

## 7. 日常維護：更新、備份、加人

### 更新到最新版

```bash
cd sunnystavern
bash deploy/update.sh
```

這個腳本會先把 `data` 和 `config` 打包備份，再拉新 image 重啟。

### 手動備份（重要，定期做）

你所有的心血都在 `data` 目錄裡。定期抓回自己電腦：

```bash
# 在伺服器上打包
tar czf ~/tavern-backup.tar.gz data config

# 在自己電腦上抓回來
scp root@你的伺服器IP:~/tavern-backup.tar.gz .
```

SillyTavern 內建也可以在網頁 UI 匯出完整資料備份（User Settings → Backup），不想碰指令的話用那個。

### 想開給朋友一起用

改 `config/config.yaml`：

```yaml
enableUserAccounts: true
enableDiscreetLogin: true   # 登入頁不列出使用者名單
```

重啟後第一次進去會要你建立管理員帳號，之後可以在管理面板加使用者。每個人有各自的角色卡和聊天記錄。

---

## 8. 疑難排解

### 8.1 容器起不來，log 說 configuration is insecure

```
Your current SillyTavern configuration is insecure (listening to non-localhost).
```

代表 `listen: true` 但沒開任何驗證。確認 `.env` 裡的 `ST_USER` / `ST_PASSWORD` 有填，而且 `config/config.yaml` 裡 `basicAuthMode: true`。

**不要**用 `securityOverride: true` 繞過去——那等於把你的酒館和 API key 開放給全世界。

### 8.2 Caddy 拿不到憑證

依序檢查：

```bash
# 1. DNS 真的指對了嗎？
dig +short tavern.你的網域.com

# 2. 80 / 443 通嗎？
curl -I http://tavern.你的網域.com

# 3. 看 Caddy 在抱怨什麼
docker compose logs caddy | tail -50
```

最常見的三個原因：DNS 還沒生效、雲端商的安全群組沒開 80/443（Oracle Cloud 特別容易踩）、Cloudflare 橘色雲朵開著。

### 8.3 AI 回覆卡住，等很久才一次全部跳出來

串流被緩衝了。確認 `Caddyfile` 裡有 `flush_interval -1`，改完 `docker compose restart caddy`。如果前面還有 Cloudflare，也可能是它造成的，先關掉 proxy 測測看。

### 8.4 要不要掛 Cloudflare

**好處**：靜態檔案在邊緣節點快取，第二次之後開站更快；隱藏真實 IP；免費防 DDoS。

**壞處**：可能干擾 SSE 串流；免費方案有 100 秒的請求逾時，長回應可能被砍斷。

**建議**：先不掛，把 VPS 放東京就已經夠快了。真的要掛的話，記得同時把 `config/config.yaml` 裡的 `forwardedHeaders.cfConnectingIp` 改成 `true`，SillyTavern 才讀得到真實 IP。

### 8.5 想確認到底慢在哪

在自己電腦上量一下：

```bash
# 從你這裡到伺服器的延遲
ping tavern.你的網域.com

# 完整的請求時間拆解
curl -o /dev/null -s -w "DNS: %{time_namelookup}s\nTCP: %{time_connect}s\nTLS: %{time_appconnect}s\n首個位元組: %{time_starttransfer}s\n總計: %{time_total}s\n" \
  -u "帳號:密碼" https://tavern.你的網域.com/
```

- `ping` 超過 150ms → 伺服器離你太遠，換區域
- `首個位元組` 很久但 `TLS` 很快 → 伺服器本身在忙（CPU 不夠，或冷啟動）
- 都很快但瀏覽器還是慢 → 是前端資源太多，確認 Caddy 的 `encode` 有生效：
  ```bash
  curl -s -D - -o /dev/null -H "Accept-Encoding: gzip" \
    -u "帳號:密碼" https://tavern.你的網域.com/ | grep -i content-encoding
  ```
  應該要看到 `content-encoding: gzip` 或 `zstd`。

  > 這裡要用 `-D -`（印出 header）而不是 `-I`。`-I` 是 HEAD 請求，不會觸發壓縮，
  > 你會看到「沒有 content-encoding」而誤判。

### 8.6 每個請求都回 500，log 出現 `Invalid value used as weak map key`

`config.yaml` 裡的 `hostWhitelist.hosts` 被寫成空值了：

```yaml
hostWhitelist:
  hosts:          # ← 這樣 YAML 會解析成 null，不是空清單
```

改成明確的空清單就好：

```yaml
hostWhitelist:
  hosts: []
```

（本 repo 的設定檔已經是正確的寫法，這條是給你之後手動改壞的時候對照用。）

### 8.7 容器狀態怎麼看

```bash
docker compose ps              # 兩個服務都要是 running / healthy
docker compose logs -f sillytavern
docker stats                   # 看 CPU / 記憶體有沒有吃滿
df -h                          # 磁碟滿了也會讓一切變慢
```

---

## 檔案說明

```
.
├── docker-compose.yml          SillyTavern + Caddy 兩個容器
├── Caddyfile                   HTTPS、壓縮、靜態檔快取、串流不緩衝
├── .env.example                網域和帳密（複製成 .env 再填）
├── config/
│   └── config.yaml             調校過的 SillyTavern 設定
├── deploy/
│   ├── bootstrap-ubuntu.sh     全新 Ubuntu 一鍵裝 Docker + 防火牆
│   └── update.sh               備份 + 更新到最新版
└── data/                       （執行時產生）你的角色卡和聊天記錄，不進 git
```

---

## 參考

- [SillyTavern 官方文件](https://docs.sillytavern.app/)
- [SillyTavern GitHub](https://github.com/SillyTavern/SillyTavern)
- [Google AI Studio](https://aistudio.google.com/apikey)
- [Caddy 文件](https://caddyserver.com/docs/)
