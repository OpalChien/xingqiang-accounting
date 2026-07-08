# 興強科技記帳平台

這是一個為興強科技有限公司設計的 Streamlit 記帳平台，可本機執行，也可部署到 Streamlit Community Cloud。功能包含：

- 進口/出口帳款管理
- 應收、應付、部分付款與逾期狀態
- 獨立「已收已付」頁面，可登記收款/付款日期與本次金額
- 當下結、月結、雙月結、半年結
- 外幣自動抓匯率並換算台幣，也可手動覆寫匯率
- 簡化表單優先，只把訂單、提單、承辦、銀行帳戶等放在進階欄位
- Excel 匯入範本、Excel 對帳報表下載
- 可匯入 ERP 客戶主檔 `.xls`，自動帶出客戶編號、英文名稱、幣別、月結條件與付款天數
- 每次進入先載入上一次下載的 Excel，離開前下載當天日期命名的備份
- SQLite 本機資料庫
- Firebase Hosting 網頁版：內建 ERP 客戶主檔、瀏覽器本機暫存、Firebase 雲端暫存

## 公司資料

- 公司名稱：興強科技有限公司
- 統一編號：54155450
- 聯絡電話：02-27031206
- 公司網站：https://0227031206.tw66.com.tw
- 主要業務：Kerb-Konus 緊固件代理、Uchihashi ELCUT 溫度保險絲代理、電子器材設備批發與零組件銷售

## 本機執行

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
streamlit run streamlit_app.py
```

## 日常使用流程

1. 進入系統後，先上傳上一次下載的 Excel 對帳備份。
2. 若是第一次使用，可先上傳 ERP 客戶主檔，系統會記住客戶編號、幣別與付款天數。
3. 新增帳款時可從「套用 ERP 客戶資料」選客戶，系統會自動帶入常用條件。
4. 登記收款或付款時，請押上實際收付款日期。
5. 關閉視窗前，下載今日 Excel 備份。
6. 下次進入系統時，再上傳最新那份 Excel。

下載檔名格式：

```text
興強科技_對帳備份_YYYY-MM-DD.xlsx
```

## 推到 GitHub

你可以在 GitHub 右上角或 repositories 頁面點 `New`，建立一個新的 repository，例如：

```text
xingqiang-accounting
```

建立後回到本資料夾執行：

```powershell
git init
git add .
git commit -m "Build Xingqiang accounting platform"
git branch -M main
git remote add origin https://github.com/OpalChien/xingqiang-accounting.git
git push -u origin main
```

## 部署到 Streamlit Community Cloud

1. 把本資料夾推到 GitHub repository。
2. 到 Streamlit Community Cloud 建立 app。
3. 選擇 repository、branch，入口檔填 `streamlit_app.py`。
4. Python 版本建議選 3.11 或 3.12。

## 結帳方式

| 結帳方式 | 到期日 |
| --- | --- |
| 當下結 | 交易日 + 付款天數 |
| 月結 | 交易月份月底 + 付款天數 |
| 雙月結 | 該雙月區間最後一天 + 付款天數 |
| 半年結 | 6/30 或 12/31 + 付款天數 |

## 資料庫

預設資料庫在 `data/accounting.db`。如要改位置，可設定環境變數：

```powershell
$env:ACCOUNTING_DB_PATH="C:\AccountingData\accounting.db"
streamlit run streamlit_app.py
```

Streamlit Community Cloud 的檔案系統不適合作為正式長期資料庫；正式營運建議定期下載 Excel 對帳報表備份，或再接雲端資料庫。

## Firebase 網頁版

正式網址：

```text
https://xingqiang-accounting.web.app
```

Firebase 網頁版功能：

- 已內建 `Twn ERP customer data 1150706.xls` 的 125 筆有效客戶清單。
- 新增帳款時選客戶，會自動帶入客戶編號、英文名稱、幣別、Payment Terms/付款天數，並推算到期日。
- Dashboard 會顯示應收/應付未結、逾期未結、到期分布圖表，以及 30 天內要到期的帳款。
- 有帳款在 7 天內到期或已逾期時，開啟網站會跳出提醒清單。
- 客戶主檔可在網站新增、修改、刪除。
- Excel 可匯入/匯出，也可用 Chrome 的「選資料夾另存 Excel」。
- 不需要登入，大家都可以直接使用、修改資料、雲端暫存與下載 Excel。
