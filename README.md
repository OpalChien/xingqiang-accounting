# 興強科技記帳平台

這是一個為興強科技有限公司設計的 Streamlit 記帳平台，可本機執行，也可部署到 Streamlit Community Cloud。功能包含：

- 進口/出口帳款管理
- 應收、應付、部分付款與逾期狀態
- 獨立「已收已付」頁面，可登記收款/付款日期與本次金額
- 當下結、月結、雙月結、半年結
- 外幣自動抓匯率並換算台幣，也可手動覆寫匯率
- 簡化表單優先，只把訂單、提單、承辦、銀行帳戶等放在進階欄位
- Excel 匯入範本、Excel 對帳報表下載
- 每次進入先載入上一次下載的 Excel，離開前下載當天日期命名的備份
- SQLite 本機資料庫

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
2. 新增帳款、登記收款或付款。
3. 關閉視窗前，下載今日 Excel 備份。
4. 下次進入系統時，再上傳最新那份 Excel。

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
