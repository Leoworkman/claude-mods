# claude-mods

Claude Code 的介面小工具（mods）。每個都是獨立的 plugin，挑想要的裝就好，沒裝的不會載入。

| Mod | 做什麼 |
| --- | --- |
| **task-progress** | 輸入框上方列出各對話正在跑的任務：進度條、百分比、預估剩餘時間。點任務名稱跳回該對話，按 × 收起。 |
| **usage-band** | 輸入框上方一行顯示 context 占用、5 小時用量與重置時間、每週用量。按 × 隱藏，輸入 `/usage-pin` 再顯示。 |

## 安裝

先加入這個目錄（只需一次）：

```bash
claude plugin marketplace add Leoworkman/claude-mods
```

再挑想要的安裝：

```bash
claude plugin install task-progress@leoworkman-mods
claude plugin install usage-band@leoworkman-mods
```

裝好後重開 Claude Code（或新開一個對話）就會出現。

## 更新與移除

```bash
claude plugin marketplace update leoworkman-mods
claude plugin update task-progress@leoworkman-mods
claude plugin uninstall usage-band@leoworkman-mods
```

暫時不想用可以 `claude plugin disable <名稱>@leoworkman-mods`，之後再 `enable`。

## 需求與說明

- 需要較新版的 Claude Code（支援 function hooks 的版本）。Claude 桌面版內建的版本可直接使用；終端機的 `claude` 若版本太舊會載入失敗，請先 `claude update`。
- **task-progress**
  - 進度依 Claude 回報的步驟（待辦清單）計算；沒有步驟時依經過時間估算，且不顯示剩餘時間。
  - 只顯示正在跑、或 30 分鐘內剛完成的任務；20 秒內就答完的一問一答不顯示。
  - 各對話透過 `~/.claude/task-progress/` 下的小 JSON 檔分享進度。
  - 點名稱跳回對話使用桌面版的連結，在純終端機中不會跳轉。
- **usage-band**
  - 5 小時與每週用量來自最近一次 API 回應；剛開的對話會先顯示上一次記下的數字，送出訊息後更新。
  - 任一項超過 90% 時以紅色顯示。

## 開發

每個 mod 都有測試：

```bash
claude plugin validate plugins/usage-band
claude plugin test plugins/usage-band
```
