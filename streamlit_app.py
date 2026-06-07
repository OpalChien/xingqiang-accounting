from __future__ import annotations

import calendar
import io
import os
import sqlite3
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd
import streamlit as st


APP_TZ = ZoneInfo("Asia/Taipei")
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
COMPANY_NAME = "興強科技有限公司"
COMPANY_SHORT_NAME = "興強科技"
COMPANY_TAX_ID = "54155450"
COMPANY_PHONE = "02-27031206"
COMPANY_ADDRESS = "台北市大安區和平東路一段242號2F"
COMPANY_WEBSITE = "https://0227031206.tw66.com.tw"
COMPANY_BUSINESS_LINES = [
    "德國 Kerb-Konus Vertriebs 緊固件代理",
    "日本內橋 Uchihashi ELCUT 溫度保險絲代理",
    "電子器材設備批發與零組件銷售",
]

TRADE_FLOWS = ["出口", "進口"]
ACCOUNT_SIDES = ["應收", "應付"]
SETTLEMENT_CYCLES = ["當下結", "月結", "雙月結", "半年結"]
CURRENCIES = ["TWD", "USD", "EUR", "JPY", "CNY", "HKD", "GBP", "AUD", "CAD", "SGD"]

TABLE_COLUMNS = [
    "id",
    "trade_flow",
    "account_side",
    "counterparty",
    "invoice_no",
    "order_no",
    "shipment_no",
    "item_description",
    "currency",
    "amount_original",
    "exchange_rate",
    "amount_twd",
    "settlement_cycle",
    "invoice_date",
    "grace_days",
    "due_date",
    "paid_amount_twd",
    "payment_date",
    "bank_account",
    "owner",
    "notes",
    "created_at",
    "updated_at",
]

DISPLAY_COLUMNS = {
    "id": "ID",
    "trade_flow": "進出口",
    "account_side": "應收/應付",
    "counterparty": "客戶/供應商",
    "invoice_no": "發票號碼",
    "order_no": "訂單號碼",
    "shipment_no": "提單/報關號碼",
    "item_description": "品名/摘要",
    "currency": "幣別",
    "amount_original": "原幣金額",
    "exchange_rate": "匯率",
    "amount_twd": "台幣金額",
    "settlement_cycle": "結帳方式",
    "invoice_date": "交易日期",
    "grace_days": "付款天數",
    "due_date": "到期日",
    "paid_amount_twd": "已收/已付金額",
    "payment_date": "收付款日期",
    "bank_account": "銀行/帳戶",
    "owner": "承辦人",
    "notes": "備註",
    "created_at": "建立時間",
    "updated_at": "更新時間",
    "outstanding_twd": "未結金額",
    "computed_status": "狀態",
    "days_overdue": "逾期天數",
    "settlement_period": "結帳期間",
    "aging_bucket": "帳齡",
}

IMPORT_ALIASES = {
    "ID": "id",
    "id": "id",
    "進出口": "trade_flow",
    "trade_flow": "trade_flow",
    "應收/應付": "account_side",
    "account_side": "account_side",
    "客戶/供應商": "counterparty",
    "客戶": "counterparty",
    "供應商": "counterparty",
    "counterparty": "counterparty",
    "發票號碼": "invoice_no",
    "發票": "invoice_no",
    "invoice_no": "invoice_no",
    "訂單號碼": "order_no",
    "訂單": "order_no",
    "order_no": "order_no",
    "提單/報關號碼": "shipment_no",
    "提單": "shipment_no",
    "報關號碼": "shipment_no",
    "shipment_no": "shipment_no",
    "品名/摘要": "item_description",
    "品名": "item_description",
    "摘要": "item_description",
    "item_description": "item_description",
    "幣別": "currency",
    "currency": "currency",
    "原幣金額": "amount_original",
    "金額": "amount_original",
    "amount_original": "amount_original",
    "匯率": "exchange_rate",
    "exchange_rate": "exchange_rate",
    "台幣金額": "amount_twd",
    "amount_twd": "amount_twd",
    "結帳方式": "settlement_cycle",
    "結帳條件": "settlement_cycle",
    "settlement_cycle": "settlement_cycle",
    "交易日期": "invoice_date",
    "發票日期": "invoice_date",
    "invoice_date": "invoice_date",
    "付款天數": "grace_days",
    "grace_days": "grace_days",
    "到期日": "due_date",
    "due_date": "due_date",
    "已收/已付金額": "paid_amount_twd",
    "已收金額": "paid_amount_twd",
    "已付金額": "paid_amount_twd",
    "paid_amount_twd": "paid_amount_twd",
    "收付款日期": "payment_date",
    "付款日期": "payment_date",
    "payment_date": "payment_date",
    "銀行/帳戶": "bank_account",
    "銀行帳戶": "bank_account",
    "bank_account": "bank_account",
    "承辦人": "owner",
    "owner": "owner",
    "備註": "notes",
    "notes": "notes",
}


def main() -> None:
    st.set_page_config(
        page_title=f"{COMPANY_SHORT_NAME}記帳平台",
        page_icon="帳",
        layout="wide",
        initial_sidebar_state="expanded",
    )
    inject_styles()
    init_db()

    st.title(f"{COMPANY_SHORT_NAME}記帳平台")
    st.caption("進出口代理、應收應付、結帳週期與 Excel 對帳一次整理。")
    render_company_strip()

    raw_df = fetch_transactions()
    enriched_df = enrich_transactions(raw_df)
    filtered_df = render_sidebar_filters(enriched_df)

    tabs = st.tabs(["總覽", "新增與收付款", "明細查詢", "Excel 匯入匯出", "設定"])
    with tabs[0]:
        render_dashboard(filtered_df)
    with tabs[1]:
        render_entry_and_payment(raw_df)
    with tabs[2]:
        render_detail_table(filtered_df)
    with tabs[3]:
        render_excel_tools(raw_df)
    with tabs[4]:
        render_settings()


def render_company_strip() -> None:
    with st.container(border=True):
        col1, col2, col3 = st.columns([1.25, 1, 1])
        with col1:
            st.markdown(f"**{COMPANY_NAME}**")
            st.markdown(
                f"<span class='small-muted'>{COMPANY_BUSINESS_LINES[0]}；{COMPANY_BUSINESS_LINES[1]}</span>",
                unsafe_allow_html=True,
            )
        with col2:
            st.markdown(f"統編：`{COMPANY_TAX_ID}`")
            st.markdown(f"電話：`{COMPANY_PHONE}`")
        with col3:
            st.link_button("公司網站", COMPANY_WEBSITE, use_container_width=True)
            st.markdown(
                f"<span class='small-muted'>{COMPANY_WEBSITE}</span><br>"
                f"<span class='small-muted'>{COMPANY_ADDRESS}</span>",
                unsafe_allow_html=True,
            )


def inject_styles() -> None:
    st.markdown(
        """
        <style>
        .stApp {
            background: #f7f8f5;
            color: #1e2528;
        }
        h1, h2, h3 {
            letter-spacing: 0;
        }
        [data-testid="stMetric"] {
            background: #ffffff;
            border: 1px solid #dde3dd;
            border-radius: 8px;
            padding: 14px 16px;
            box-shadow: 0 1px 2px rgba(31, 38, 35, 0.04);
        }
        [data-testid="stMetricValue"] {
            font-size: 1.35rem;
        }
        div[data-testid="stVerticalBlockBorderWrapper"] {
            border-radius: 8px;
        }
        .status-pill {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 999px;
            border: 1px solid #cad2cb;
            background: #fff;
            font-size: 12px;
        }
        .small-muted {
            color: #62706b;
            font-size: 13px;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def init_db() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS transactions (
                id TEXT PRIMARY KEY,
                trade_flow TEXT NOT NULL,
                account_side TEXT NOT NULL,
                counterparty TEXT NOT NULL,
                invoice_no TEXT,
                order_no TEXT,
                shipment_no TEXT,
                item_description TEXT,
                currency TEXT NOT NULL,
                amount_original REAL NOT NULL,
                exchange_rate REAL NOT NULL,
                amount_twd REAL NOT NULL,
                settlement_cycle TEXT NOT NULL,
                invoice_date TEXT NOT NULL,
                grace_days INTEGER NOT NULL,
                due_date TEXT NOT NULL,
                paid_amount_twd REAL NOT NULL,
                payment_date TEXT,
                bank_account TEXT,
                owner TEXT,
                notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )


def get_connection() -> sqlite3.Connection:
    db_path = Path(os.getenv("ACCOUNTING_DB_PATH", str(DATA_DIR / "accounting.db")))
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def fetch_transactions() -> pd.DataFrame:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM transactions
            ORDER BY date(invoice_date) DESC, datetime(created_at) DESC
            """
        ).fetchall()

    if not rows:
        return pd.DataFrame(columns=TABLE_COLUMNS)

    df = pd.DataFrame([dict(row) for row in rows])
    for col in TABLE_COLUMNS:
        if col not in df.columns:
            df[col] = None
    return df[TABLE_COLUMNS]


def upsert_transaction(record: dict[str, Any]) -> str:
    now = datetime.now(APP_TZ).isoformat(timespec="seconds")
    record_id = str(record.get("id") or uuid.uuid4())
    invoice_date = coerce_date(record.get("invoice_date")) or today()
    grace_days = int(record.get("grace_days") or 0)
    amount_original = safe_float(record.get("amount_original"))
    exchange_rate = safe_float(record.get("exchange_rate"), default=1.0)
    amount_twd = round(amount_original * exchange_rate, 2)
    due_date = calculate_due_date(invoice_date, record.get("settlement_cycle", "月結"), grace_days)
    payment_date = coerce_date(record.get("payment_date"))

    normalized = {
        "id": record_id,
        "trade_flow": normalize_choice(record.get("trade_flow"), TRADE_FLOWS, "出口"),
        "account_side": normalize_choice(record.get("account_side"), ACCOUNT_SIDES, "應收"),
        "counterparty": clean_text(record.get("counterparty")) or "未命名",
        "invoice_no": clean_text(record.get("invoice_no")),
        "order_no": clean_text(record.get("order_no")),
        "shipment_no": clean_text(record.get("shipment_no")),
        "item_description": clean_text(record.get("item_description")),
        "currency": clean_text(record.get("currency")).upper() or "TWD",
        "amount_original": amount_original,
        "exchange_rate": exchange_rate,
        "amount_twd": amount_twd,
        "settlement_cycle": normalize_cycle(record.get("settlement_cycle")),
        "invoice_date": invoice_date.isoformat(),
        "grace_days": grace_days,
        "due_date": due_date.isoformat(),
        "paid_amount_twd": safe_float(record.get("paid_amount_twd")),
        "payment_date": payment_date.isoformat() if payment_date else None,
        "bank_account": clean_text(record.get("bank_account")),
        "owner": clean_text(record.get("owner")),
        "notes": clean_text(record.get("notes")),
        "updated_at": now,
    }

    with get_connection() as conn:
        exists = conn.execute("SELECT 1 FROM transactions WHERE id = ?", (record_id,)).fetchone()
        normalized["created_at"] = (
            conn.execute("SELECT created_at FROM transactions WHERE id = ?", (record_id,)).fetchone()["created_at"]
            if exists
            else now
        )
        conn.execute(
            """
            INSERT INTO transactions (
                id, trade_flow, account_side, counterparty, invoice_no, order_no, shipment_no,
                item_description, currency, amount_original, exchange_rate, amount_twd,
                settlement_cycle, invoice_date, grace_days, due_date, paid_amount_twd,
                payment_date, bank_account, owner, notes, created_at, updated_at
            )
            VALUES (
                :id, :trade_flow, :account_side, :counterparty, :invoice_no, :order_no, :shipment_no,
                :item_description, :currency, :amount_original, :exchange_rate, :amount_twd,
                :settlement_cycle, :invoice_date, :grace_days, :due_date, :paid_amount_twd,
                :payment_date, :bank_account, :owner, :notes, :created_at, :updated_at
            )
            ON CONFLICT(id) DO UPDATE SET
                trade_flow = excluded.trade_flow,
                account_side = excluded.account_side,
                counterparty = excluded.counterparty,
                invoice_no = excluded.invoice_no,
                order_no = excluded.order_no,
                shipment_no = excluded.shipment_no,
                item_description = excluded.item_description,
                currency = excluded.currency,
                amount_original = excluded.amount_original,
                exchange_rate = excluded.exchange_rate,
                amount_twd = excluded.amount_twd,
                settlement_cycle = excluded.settlement_cycle,
                invoice_date = excluded.invoice_date,
                grace_days = excluded.grace_days,
                due_date = excluded.due_date,
                paid_amount_twd = excluded.paid_amount_twd,
                payment_date = excluded.payment_date,
                bank_account = excluded.bank_account,
                owner = excluded.owner,
                notes = excluded.notes,
                updated_at = excluded.updated_at
            """,
            normalized,
        )
    return record_id


def delete_transaction(record_id: str) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM transactions WHERE id = ?", (record_id,))


def replace_transactions(records: list[dict[str, Any]]) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM transactions")
    for record in records:
        upsert_transaction(record)


def append_transactions(records: list[dict[str, Any]]) -> None:
    for record in records:
        upsert_transaction(record)


def calculate_due_date(invoice_date: date, settlement_cycle: str, grace_days: int = 0) -> date:
    cycle = normalize_cycle(settlement_cycle)
    if cycle == "當下結":
        base = invoice_date
    elif cycle == "月結":
        base = month_end(invoice_date.year, invoice_date.month)
    elif cycle == "雙月結":
        end_month = ((invoice_date.month - 1) // 2 + 1) * 2
        base = month_end(invoice_date.year, end_month)
    elif cycle == "半年結":
        base = date(invoice_date.year, 6, 30) if invoice_date.month <= 6 else date(invoice_date.year, 12, 31)
    else:
        base = month_end(invoice_date.year, invoice_date.month)
    return base + timedelta(days=max(int(grace_days), 0))


def month_end(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def settlement_period(invoice_date_value: Any, settlement_cycle: str) -> str:
    invoice_date = coerce_date(invoice_date_value)
    if not invoice_date:
        return ""
    cycle = normalize_cycle(settlement_cycle)
    if cycle == "當下結":
        return invoice_date.isoformat()
    if cycle == "月結":
        return f"{invoice_date.year}-{invoice_date.month:02d}"
    if cycle == "雙月結":
        start_month = ((invoice_date.month - 1) // 2) * 2 + 1
        return f"{invoice_date.year}-{start_month:02d}/{start_month + 1:02d}"
    half = "H1" if invoice_date.month <= 6 else "H2"
    return f"{invoice_date.year}-{half}"


def enrich_transactions(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        empty = pd.DataFrame(columns=list(DISPLAY_COLUMNS.values()))
        return empty

    enriched = df.copy()
    for col in TABLE_COLUMNS:
        if col not in enriched.columns:
            enriched[col] = None

    enriched["invoice_date"] = enriched["invoice_date"].apply(lambda value: coerce_date(value) or today())
    enriched["settlement_cycle"] = enriched["settlement_cycle"].apply(normalize_cycle)
    enriched["grace_days"] = pd.to_numeric(enriched["grace_days"], errors="coerce").fillna(0).astype(int)
    enriched["exchange_rate"] = pd.to_numeric(enriched["exchange_rate"], errors="coerce").fillna(1)
    enriched["amount_original"] = pd.to_numeric(enriched["amount_original"], errors="coerce").fillna(0)
    amount_twd = pd.to_numeric(enriched["amount_twd"], errors="coerce")
    enriched["amount_twd"] = amount_twd.fillna(enriched["amount_original"] * enriched["exchange_rate"])
    enriched["due_date"] = enriched.apply(
        lambda row: coerce_date(row.get("due_date"))
        or calculate_due_date(row["invoice_date"], row["settlement_cycle"], int(row["grace_days"])),
        axis=1,
    )

    for date_col in ["invoice_date", "due_date", "payment_date", "created_at", "updated_at"]:
        if date_col in enriched.columns:
            enriched[date_col] = pd.to_datetime(enriched[date_col], errors="coerce")

    numeric_cols = ["amount_original", "exchange_rate", "amount_twd", "paid_amount_twd", "grace_days"]
    for col in numeric_cols:
        enriched[col] = pd.to_numeric(enriched[col], errors="coerce").fillna(0)

    enriched["outstanding_twd"] = (enriched["amount_twd"] - enriched["paid_amount_twd"]).clip(lower=0).round(2)
    local_today = pd.Timestamp(today())
    due_dates = pd.to_datetime(enriched["due_date"], errors="coerce")
    overdue_days = (local_today - due_dates).dt.days.fillna(0).astype(int)
    enriched["days_overdue"] = overdue_days.where(enriched["outstanding_twd"] > 0, 0).clip(lower=0)
    enriched["computed_status"] = enriched.apply(compute_status, axis=1)
    enriched["settlement_period"] = enriched.apply(
        lambda row: settlement_period(row.get("invoice_date"), row.get("settlement_cycle")),
        axis=1,
    )
    enriched["aging_bucket"] = enriched["days_overdue"].apply(aging_bucket)

    display = enriched.rename(columns=DISPLAY_COLUMNS)
    ordered = [label for label in DISPLAY_COLUMNS.values() if label in display.columns]
    return display[ordered]


def compute_status(row: pd.Series) -> str:
    outstanding = safe_float(row.get("outstanding_twd"))
    paid = safe_float(row.get("paid_amount_twd"))
    days_overdue = int(row.get("days_overdue") or 0)
    if outstanding <= 0:
        return "已結清"
    if days_overdue > 0 and paid > 0:
        return "逾期部分"
    if days_overdue > 0:
        return "逾期"
    if paid > 0:
        return "部分"
    return "未結"


def aging_bucket(days_overdue: int) -> str:
    if days_overdue <= 0:
        return "未到期"
    if days_overdue <= 30:
        return "逾期 1-30"
    if days_overdue <= 60:
        return "逾期 31-60"
    if days_overdue <= 90:
        return "逾期 61-90"
    return "逾期 90+"


def render_sidebar_filters(df: pd.DataFrame) -> pd.DataFrame:
    st.sidebar.header("篩選")
    if df.empty:
        st.sidebar.info("目前沒有資料。")
        return df

    min_date = pd.to_datetime(df["交易日期"], errors="coerce").min()
    max_date = pd.to_datetime(df["交易日期"], errors="coerce").max()
    default_start = min_date.date() if pd.notna(min_date) else today().replace(day=1)
    default_end = max_date.date() if pd.notna(max_date) else today()

    date_range = st.sidebar.date_input("交易日期", value=(default_start, default_end))
    selected_flow = st.sidebar.multiselect("進出口", TRADE_FLOWS, default=TRADE_FLOWS)
    selected_side = st.sidebar.multiselect("應收/應付", ACCOUNT_SIDES, default=ACCOUNT_SIDES)
    selected_cycle = st.sidebar.multiselect("結帳方式", SETTLEMENT_CYCLES, default=SETTLEMENT_CYCLES)
    status_options = sorted(df["狀態"].dropna().unique().tolist())
    selected_status = st.sidebar.multiselect("狀態", status_options, default=status_options)
    counterparty_query = st.sidebar.text_input("客戶/供應商搜尋")

    filtered = df.copy()
    if isinstance(date_range, tuple) and len(date_range) == 2:
        start_date, end_date = date_range
        tx_dates = pd.to_datetime(filtered["交易日期"], errors="coerce").dt.date
        filtered = filtered[(tx_dates >= start_date) & (tx_dates <= end_date)]
    if selected_flow:
        filtered = filtered[filtered["進出口"].isin(selected_flow)]
    if selected_side:
        filtered = filtered[filtered["應收/應付"].isin(selected_side)]
    if selected_cycle:
        filtered = filtered[filtered["結帳方式"].isin(selected_cycle)]
    if selected_status:
        filtered = filtered[filtered["狀態"].isin(selected_status)]
    if counterparty_query:
        filtered = filtered[
            filtered["客戶/供應商"].astype(str).str.contains(counterparty_query, case=False, na=False)
        ]
    return filtered


def render_dashboard(df: pd.DataFrame) -> None:
    if df.empty:
        st.info("尚未有帳款資料，可以先到「新增與收付款」或「Excel 匯入匯出」建立資料。")
        return

    receivable = df[df["應收/應付"] == "應收"]["未結金額"].sum()
    payable = df[df["應收/應付"] == "應付"]["未結金額"].sum()
    overdue = df[df["逾期天數"] > 0]["未結金額"].sum()
    settled = df[df["狀態"] == "已結清"]["台幣金額"].sum()

    kpi1, kpi2, kpi3, kpi4 = st.columns(4)
    kpi1.metric("應收未結", money(receivable))
    kpi2.metric("應付未結", money(payable))
    kpi3.metric("逾期未結", money(overdue))
    kpi4.metric("已結清金額", money(settled))

    left, right = st.columns([1.25, 1])
    with left:
        st.subheader("到期月份")
        monthly = df.copy()
        monthly["到期月份"] = pd.to_datetime(monthly["到期日"], errors="coerce").dt.strftime("%Y-%m")
        monthly_pivot = (
            monthly.pivot_table(
                index="到期月份",
                columns="應收/應付",
                values="未結金額",
                aggfunc="sum",
                fill_value=0,
            )
            .sort_index()
            .tail(12)
        )
        st.bar_chart(monthly_pivot, height=280)

    with right:
        st.subheader("結帳方式")
        cycle_summary = (
            df.pivot_table(
                index="結帳方式",
                columns="應收/應付",
                values="未結金額",
                aggfunc="sum",
                fill_value=0,
            )
            .reindex(SETTLEMENT_CYCLES)
            .fillna(0)
        )
        st.dataframe(format_money_columns(cycle_summary.reset_index()), hide_index=True, use_container_width=True)

    st.subheader("優先對帳")
    priority = df[df["未結金額"] > 0].copy()
    priority = priority.sort_values(["逾期天數", "到期日"], ascending=[False, True]).head(12)
    show_cols = ["狀態", "應收/應付", "客戶/供應商", "發票號碼", "結帳方式", "到期日", "未結金額", "逾期天數"]
    st.dataframe(
        format_money_columns(priority[show_cols]),
        hide_index=True,
        use_container_width=True,
    )


def render_entry_and_payment(raw_df: pd.DataFrame) -> None:
    add_tab, edit_tab = st.tabs(["新增帳款", "編輯與收付款"])
    with add_tab:
        saved = render_transaction_form(None, "add_record")
        if saved:
            st.success("已新增帳款。")
            st.rerun()

    with edit_tab:
        if raw_df.empty:
            st.info("目前沒有可編輯的帳款。")
            return
        options = build_record_options(raw_df)
        selected_label = st.selectbox("選擇帳款", list(options.keys()))
        selected_id = options[selected_label]
        selected_row = raw_df[raw_df["id"] == selected_id].iloc[0].to_dict()
        saved = render_transaction_form(selected_row, "edit_record")
        if saved:
            st.success("已更新帳款。")
            st.rerun()

        st.divider()
        confirm_delete = st.checkbox("確認刪除此筆帳款")
        if st.button("刪除選取帳款", disabled=not confirm_delete, type="secondary"):
            delete_transaction(selected_id)
            st.success("已刪除。")
            st.rerun()


def render_transaction_form(existing: dict[str, Any] | None, form_key: str) -> bool:
    existing = existing or {}
    with st.form(form_key, clear_on_submit=existing == {}):
        col1, col2, col3 = st.columns(3)
        with col1:
            trade_flow = st.selectbox(
                "進出口",
                TRADE_FLOWS,
                index=index_of(TRADE_FLOWS, existing.get("trade_flow"), 0),
            )
            default_side = "應收" if trade_flow == "出口" else "應付"
            account_side = st.selectbox(
                "應收/應付",
                ACCOUNT_SIDES,
                index=index_of(ACCOUNT_SIDES, existing.get("account_side"), ACCOUNT_SIDES.index(default_side)),
            )
            counterparty = st.text_input("客戶/供應商", value=existing.get("counterparty", ""))
            invoice_no = st.text_input("發票號碼", value=existing.get("invoice_no", ""))
        with col2:
            order_no = st.text_input("訂單號碼", value=existing.get("order_no", ""))
            shipment_no = st.text_input("提單/報關號碼", value=existing.get("shipment_no", ""))
            item_description = st.text_input("品名/摘要", value=existing.get("item_description", ""))
            owner = st.text_input("承辦人", value=existing.get("owner", ""))
        with col3:
            currency_default = clean_text(existing.get("currency")).upper() or "TWD"
            currency_options = CURRENCIES if currency_default in CURRENCIES else [currency_default] + CURRENCIES
            currency = st.selectbox("幣別", currency_options, index=0 if currency_default not in CURRENCIES else CURRENCIES.index(currency_default))
            amount_original = st.number_input(
                "原幣金額",
                min_value=0.0,
                value=float(existing.get("amount_original") or 0),
                step=1000.0,
                format="%.2f",
            )
            exchange_rate = st.number_input(
                "匯率",
                min_value=0.0,
                value=float(existing.get("exchange_rate") or 1),
                step=0.01,
                format="%.6f",
            )
            st.metric("台幣金額", money(amount_original * exchange_rate))

        col4, col5, col6 = st.columns(3)
        with col4:
            invoice_date = st.date_input("交易日期", value=coerce_date(existing.get("invoice_date")) or today())
            settlement_cycle = st.selectbox(
                "結帳方式",
                SETTLEMENT_CYCLES,
                index=index_of(SETTLEMENT_CYCLES, existing.get("settlement_cycle"), 1),
            )
        with col5:
            grace_days = st.number_input(
                "付款天數",
                min_value=0,
                value=int(existing.get("grace_days") or 0),
                step=1,
            )
            projected_due = calculate_due_date(invoice_date, settlement_cycle, int(grace_days))
            st.metric("到期日", projected_due.isoformat())
        with col6:
            paid_amount_twd = st.number_input(
                "已收/已付金額",
                min_value=0.0,
                value=float(existing.get("paid_amount_twd") or 0),
                step=1000.0,
                format="%.2f",
            )
            has_payment_date = st.checkbox("填寫收付款日期", value=bool(existing.get("payment_date")))
            payment_date = None
            if has_payment_date:
                payment_date = st.date_input("收付款日期", value=coerce_date(existing.get("payment_date")) or today())

        bank_account = st.text_input("銀行/帳戶", value=existing.get("bank_account", ""))
        notes = st.text_area("備註", value=existing.get("notes", ""), height=84)

        submitted = st.form_submit_button("儲存帳款", type="primary")
        if not submitted:
            return False
        if not clean_text(counterparty):
            st.error("請填寫客戶/供應商。")
            return False
        upsert_transaction(
            {
                "id": existing.get("id"),
                "trade_flow": trade_flow,
                "account_side": account_side,
                "counterparty": counterparty,
                "invoice_no": invoice_no,
                "order_no": order_no,
                "shipment_no": shipment_no,
                "item_description": item_description,
                "currency": currency,
                "amount_original": amount_original,
                "exchange_rate": exchange_rate,
                "settlement_cycle": settlement_cycle,
                "invoice_date": invoice_date,
                "grace_days": int(grace_days),
                "paid_amount_twd": paid_amount_twd,
                "payment_date": payment_date,
                "bank_account": bank_account,
                "owner": owner,
                "notes": notes,
            }
        )
        return True


def build_record_options(df: pd.DataFrame) -> dict[str, str]:
    options: dict[str, str] = {}
    enriched = enrich_transactions(df)
    for _, row in enriched.iterrows():
        label = (
            f"{row['交易日期'].date() if pd.notna(row['交易日期']) else ''} | "
            f"{row['客戶/供應商']} | {row['發票號碼'] or '無發票'} | "
            f"{row['應收/應付']} {money(row['未結金額'])}"
        )
        options[label] = row["ID"]
    return options


def render_detail_table(df: pd.DataFrame) -> None:
    if df.empty:
        st.info("沒有符合條件的明細。")
        return

    st.subheader("交易明細")
    visible_cols = [
        "狀態",
        "進出口",
        "應收/應付",
        "客戶/供應商",
        "發票號碼",
        "訂單號碼",
        "提單/報關號碼",
        "幣別",
        "原幣金額",
        "匯率",
        "台幣金額",
        "結帳方式",
        "結帳期間",
        "交易日期",
        "到期日",
        "已收/已付金額",
        "未結金額",
        "逾期天數",
        "承辦人",
        "備註",
    ]
    view = df[[col for col in visible_cols if col in df.columns]].copy()
    st.dataframe(format_money_columns(view), hide_index=True, use_container_width=True, height=520)

    st.subheader("客戶/供應商彙總")
    summary = (
        df.pivot_table(
            index=["客戶/供應商", "應收/應付"],
            values=["台幣金額", "已收/已付金額", "未結金額"],
            aggfunc="sum",
            fill_value=0,
        )
        .reset_index()
        .sort_values("未結金額", ascending=False)
    )
    st.dataframe(format_money_columns(summary), hide_index=True, use_container_width=True)


def render_excel_tools(raw_df: pd.DataFrame) -> None:
    col1, col2 = st.columns(2)
    with col1:
        st.download_button(
            "下載 Excel 匯入範本",
            data=build_template_workbook(),
            file_name="進出口記帳匯入範本.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            use_container_width=True,
        )
    with col2:
        report_df = enrich_transactions(raw_df)
        st.download_button(
            "下載完整對帳 Excel",
            data=build_report_workbook(report_df),
            file_name=f"{COMPANY_SHORT_NAME}_進出口對帳報表_{today().isoformat()}.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            use_container_width=True,
            disabled=report_df.empty,
        )

    st.divider()
    uploaded = st.file_uploader("上傳 Excel", type=["xlsx", "xls"])
    import_mode = st.radio("匯入模式", ["追加或更新", "取代全部資料"], horizontal=True)
    if uploaded is not None:
        try:
            records = parse_uploaded_workbook(uploaded)
            preview = enrich_transactions(pd.DataFrame(records))
            st.dataframe(preview.head(20), hide_index=True, use_container_width=True)
            if st.button("確認匯入", type="primary"):
                if import_mode == "取代全部資料":
                    replace_transactions(records)
                else:
                    append_transactions(records)
                st.success(f"已匯入 {len(records)} 筆資料。")
                st.rerun()
        except Exception as exc:
            st.error(f"匯入失敗：{exc}")


def parse_uploaded_workbook(uploaded_file: Any) -> list[dict[str, Any]]:
    workbook = pd.ExcelFile(uploaded_file)
    sheet_name = "交易明細" if "交易明細" in workbook.sheet_names else workbook.sheet_names[0]
    df = pd.read_excel(workbook, sheet_name=sheet_name)
    df = df.dropna(how="all")
    if df.empty:
        raise ValueError("Excel 沒有可匯入的資料。")

    normalized_columns = {}
    for col in df.columns:
        key = clean_text(col)
        if key in IMPORT_ALIASES:
            normalized_columns[col] = IMPORT_ALIASES[key]
    df = df.rename(columns=normalized_columns)

    missing = [col for col in ["counterparty", "amount_original", "invoice_date"] if col not in df.columns]
    if missing:
        labels = ", ".join(DISPLAY_COLUMNS[col] for col in missing)
        raise ValueError(f"缺少必要欄位：{labels}")

    records: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        if row.dropna().empty:
            continue
        trade_flow = normalize_choice(row.get("trade_flow"), TRADE_FLOWS, "出口")
        default_side = "應收" if trade_flow == "出口" else "應付"
        invoice_date = coerce_date(row.get("invoice_date")) or today()
        settlement_cycle = normalize_cycle(row.get("settlement_cycle"))
        grace_days = int(safe_float(row.get("grace_days")))
        exchange_rate = safe_float(row.get("exchange_rate"), default=1.0)
        amount_original = safe_float(row.get("amount_original"))
        amount_twd = safe_float(row.get("amount_twd"), default=amount_original * exchange_rate)
        if amount_original <= 0 and amount_twd <= 0:
            continue
        if amount_original <= 0 and exchange_rate > 0:
            amount_original = round(amount_twd / exchange_rate, 2)

        records.append(
            {
                "id": clean_text(row.get("id")) or str(uuid.uuid4()),
                "trade_flow": trade_flow,
                "account_side": normalize_choice(row.get("account_side"), ACCOUNT_SIDES, default_side),
                "counterparty": clean_text(row.get("counterparty")) or "未命名",
                "invoice_no": clean_text(row.get("invoice_no")),
                "order_no": clean_text(row.get("order_no")),
                "shipment_no": clean_text(row.get("shipment_no")),
                "item_description": clean_text(row.get("item_description")),
                "currency": clean_text(row.get("currency")).upper() or "TWD",
                "amount_original": amount_original,
                "exchange_rate": exchange_rate,
                "settlement_cycle": settlement_cycle,
                "invoice_date": invoice_date,
                "grace_days": grace_days,
                "paid_amount_twd": safe_float(row.get("paid_amount_twd")),
                "payment_date": coerce_date(row.get("payment_date")),
                "bank_account": clean_text(row.get("bank_account")),
                "owner": clean_text(row.get("owner")),
                "notes": clean_text(row.get("notes")),
            }
        )
    if not records:
        raise ValueError("Excel 沒有可匯入的有效金額資料。")
    return records


def build_template_workbook() -> bytes:
    columns = [
        "進出口",
        "應收/應付",
        "客戶/供應商",
        "發票號碼",
        "訂單號碼",
        "提單/報關號碼",
        "品名/摘要",
        "幣別",
        "原幣金額",
        "匯率",
        "結帳方式",
        "交易日期",
        "付款天數",
        "已收/已付金額",
        "收付款日期",
        "銀行/帳戶",
        "承辦人",
        "備註",
    ]
    template = pd.DataFrame(columns=columns)
    field_notes = pd.DataFrame(
        [
            ["進出口", "出口或進口"],
            ["應收/應付", "出口通常是應收，進口通常是應付，可依實際情況調整"],
            ["結帳方式", "當下結、月結、雙月結、半年結"],
            ["付款天數", "結帳日後再加幾天付款，例如月結 30 天填 30"],
            ["匯率", "台幣金額會以原幣金額乘以匯率計算"],
            ["ID", "匯出後若保留 ID，再匯入會更新同一筆資料"],
        ],
        columns=["欄位", "說明"],
    )
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        template.to_excel(writer, sheet_name="交易明細", index=False)
        field_notes.to_excel(writer, sheet_name="欄位說明", index=False)
        apply_workbook_style(writer.book)
    return output.getvalue()


def build_report_workbook(df: pd.DataFrame) -> bytes:
    output = io.BytesIO()
    if df.empty:
        with pd.ExcelWriter(output, engine="openpyxl") as writer:
            pd.DataFrame(columns=["目前沒有資料"]).to_excel(writer, sheet_name="交易明細", index=False)
            apply_workbook_style(writer.book)
        return output.getvalue()

    report = make_excel_safe(df.copy())
    summary = build_reconciliation_summary(report)
    aging = (
        report.pivot_table(
            index=["應收/應付", "帳齡"],
            values="未結金額",
            aggfunc="sum",
            fill_value=0,
        )
        .reset_index()
        .sort_values(["應收/應付", "帳齡"])
    )
    cycle = (
        report.pivot_table(
            index=["結帳方式", "結帳期間", "應收/應付"],
            values=["台幣金額", "已收/已付金額", "未結金額"],
            aggfunc="sum",
            fill_value=0,
        )
        .reset_index()
        .sort_values(["結帳方式", "結帳期間", "應收/應付"])
    )
    counterparty = (
        report.pivot_table(
            index=["客戶/供應商", "應收/應付"],
            values=["台幣金額", "已收/已付金額", "未結金額"],
            aggfunc="sum",
            fill_value=0,
        )
        .reset_index()
        .sort_values("未結金額", ascending=False)
    )

    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        summary.to_excel(writer, sheet_name="對帳總表", index=False)
        report.to_excel(writer, sheet_name="交易明細", index=False)
        aging.to_excel(writer, sheet_name="帳齡分析", index=False)
        cycle.to_excel(writer, sheet_name="結帳週期", index=False)
        counterparty.to_excel(writer, sheet_name="客戶供應商", index=False)
        apply_workbook_style(writer.book)
    return output.getvalue()


def make_excel_safe(df: pd.DataFrame) -> pd.DataFrame:
    safe = df.copy()
    for col in safe.columns:
        if pd.api.types.is_datetime64_any_dtype(safe[col]):
            if getattr(safe[col].dt, "tz", None) is not None:
                safe[col] = safe[col].dt.tz_localize(None)
        elif safe[col].dtype == "object":
            safe[col] = safe[col].apply(strip_timezone)
    return safe


def strip_timezone(value: Any) -> Any:
    if isinstance(value, pd.Timestamp):
        return value.tz_localize(None) if value.tz is not None else value
    if isinstance(value, datetime) and value.tzinfo is not None:
        return value.replace(tzinfo=None)
    return value


def build_reconciliation_summary(df: pd.DataFrame) -> pd.DataFrame:
    receivable = df[df["應收/應付"] == "應收"]["未結金額"].sum()
    payable = df[df["應收/應付"] == "應付"]["未結金額"].sum()
    overdue = df[df["逾期天數"] > 0]["未結金額"].sum()
    settled = df[df["狀態"] == "已結清"]["台幣金額"].sum()
    return pd.DataFrame(
        [
            ["公司名稱", COMPANY_NAME, ""],
            ["統一編號", COMPANY_TAX_ID, ""],
            ["聯絡電話", COMPANY_PHONE, ""],
            ["報表日期", today().isoformat(), ""],
            ["交易筆數", len(df), ""],
            ["應收未結", receivable, "應收帳款尚未收款"],
            ["應付未結", payable, "應付帳款尚未付款"],
            ["淨部位", receivable - payable, "應收未結減應付未結"],
            ["逾期未結", overdue, "超過到期日仍未結清"],
            ["已結清金額", settled, "已完全收/付完成的台幣金額"],
        ],
        columns=["項目", "數值", "說明"],
    )


def apply_workbook_style(workbook: Any) -> None:
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    header_fill = PatternFill("solid", fgColor="284B46")
    header_font = Font(color="FFFFFF", bold=True)
    money_headers = {"原幣金額", "台幣金額", "已收/已付金額", "未結金額", "數值"}

    for ws in workbook.worksheets:
        ws.freeze_panes = "A2"
        ws.sheet_view.showGridLines = False
        if ws.max_row >= 1 and ws.max_column >= 1:
            ws.auto_filter.ref = ws.dimensions
        for cell in ws[1]:
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")
        for col_idx, column_cells in enumerate(ws.columns, start=1):
            header = column_cells[0].value
            max_len = max(len(str(cell.value)) if cell.value is not None else 0 for cell in column_cells)
            ws.column_dimensions[get_column_letter(col_idx)].width = min(max(max_len + 2, 12), 34)
            if header in money_headers:
                for cell in column_cells[1:]:
                    cell.number_format = '#,##0.00'
            if "日期" in str(header) or header in {"交易日期", "到期日", "收付款日期", "建立時間", "更新時間"}:
                for cell in column_cells[1:]:
                    cell.number_format = "yyyy-mm-dd"


def render_settings() -> None:
    st.subheader("公司資訊")
    company_info = pd.DataFrame(
        [
            ["公司名稱", COMPANY_NAME],
            ["統一編號", COMPANY_TAX_ID],
            ["聯絡電話", COMPANY_PHONE],
            ["公司地址", COMPANY_ADDRESS],
            ["公司網站", COMPANY_WEBSITE],
            ["營業項目", "、".join(COMPANY_BUSINESS_LINES)],
        ],
        columns=["項目", "內容"],
    )
    st.dataframe(company_info, hide_index=True, use_container_width=True)

    st.subheader("結帳規則")
    rules = pd.DataFrame(
        [
            ["當下結", "交易日當天", "交易日 + 付款天數"],
            ["月結", "交易月份最後一天", "月底 + 付款天數"],
            ["雙月結", "1-2、3-4、5-6、7-8、9-10、11-12 月分組", "該雙月最後一天 + 付款天數"],
            ["半年結", "1-6 月、7-12 月分組", "6/30 或 12/31 + 付款天數"],
        ],
        columns=["結帳方式", "結帳日", "到期日算法"],
    )
    st.dataframe(rules, hide_index=True, use_container_width=True)

    st.subheader("本機資料庫")
    db_path = Path(os.getenv("ACCOUNTING_DB_PATH", str(DATA_DIR / "accounting.db")))
    st.code(str(db_path), language="text")

    st.subheader("示範資料")
    if st.button("載入示範資料", type="secondary"):
        append_transactions(sample_records())
        st.success("已載入示範資料。")
        st.rerun()


def sample_records() -> list[dict[str, Any]]:
    base = today()
    return [
        {
            "trade_flow": "出口",
            "account_side": "應收",
            "counterparty": "Tokyo Trading Co.",
            "invoice_no": "EX-2026-001",
            "order_no": "SO-26001",
            "shipment_no": "BL-TYO-001",
            "item_description": "電子零件",
            "currency": "USD",
            "amount_original": 18500,
            "exchange_rate": 32.15,
            "settlement_cycle": "月結",
            "invoice_date": base.replace(day=5),
            "grace_days": 30,
            "paid_amount_twd": 0,
            "owner": "業務部",
            "notes": "樣本資料",
        },
        {
            "trade_flow": "進口",
            "account_side": "應付",
            "counterparty": "Shenzhen Supply Ltd.",
            "invoice_no": "IM-2026-019",
            "order_no": "PO-26019",
            "shipment_no": "DECL-26019",
            "item_description": "包材",
            "currency": "CNY",
            "amount_original": 72000,
            "exchange_rate": 4.42,
            "settlement_cycle": "雙月結",
            "invoice_date": base - timedelta(days=46),
            "grace_days": 15,
            "paid_amount_twd": 120000,
            "owner": "採購部",
            "notes": "樣本資料",
        },
        {
            "trade_flow": "出口",
            "account_side": "應收",
            "counterparty": "Pacific Buyer Inc.",
            "invoice_no": "EX-2026-002",
            "order_no": "SO-26002",
            "shipment_no": "BL-LAX-002",
            "item_description": "機械配件",
            "currency": "USD",
            "amount_original": 42000,
            "exchange_rate": 32.1,
            "settlement_cycle": "半年結",
            "invoice_date": base - timedelta(days=85),
            "grace_days": 30,
            "paid_amount_twd": 0,
            "owner": "業務部",
            "notes": "樣本資料",
        },
    ]


def format_money_columns(df: pd.DataFrame) -> pd.DataFrame:
    formatted = df.copy()
    for col in formatted.columns:
        if col in {"原幣金額", "台幣金額", "已收/已付金額", "未結金額", "應收", "應付"}:
            formatted[col] = formatted[col].apply(money)
    return formatted


def money(value: Any) -> str:
    return f"{safe_float(value):,.0f}"


def today() -> date:
    return datetime.now(APP_TZ).date()


def clean_text(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    return str(value).strip()


def safe_float(value: Any, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        if pd.isna(value):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def coerce_date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    parsed = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed):
        return None
    return parsed.date()


def normalize_choice(value: Any, choices: list[str], default: str) -> str:
    cleaned = clean_text(value)
    return cleaned if cleaned in choices else default


def normalize_cycle(value: Any) -> str:
    cleaned = clean_text(value)
    aliases = {
        "現結": "當下結",
        "即期": "當下結",
        "當日結": "當下結",
        "每月結": "月結",
        "二月結": "雙月結",
        "雙月份結": "雙月結",
        "半年度結": "半年結",
    }
    cleaned = aliases.get(cleaned, cleaned)
    return cleaned if cleaned in SETTLEMENT_CYCLES else "月結"


def index_of(options: list[str], value: Any, fallback: int) -> int:
    cleaned = clean_text(value)
    return options.index(cleaned) if cleaned in options else fallback


if __name__ == "__main__":
    main()
