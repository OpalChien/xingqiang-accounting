from pathlib import Path

import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path.cwd()
ASSET_DIR = ROOT / "outputs" / "tutorial-assets"
OUT_DIR = ROOT / "outputs"
OUT_DIR.mkdir(exist_ok=True)

VIDEO_PATH = OUT_DIR / "xingqiang_accounting_tutorial_2026-07-19.mp4"
THUMB_PATH = OUT_DIR / "xingqiang_accounting_tutorial_cover.png"

W, H = 1920, 1080
FPS = 12
SLIDE_SECONDS = 4

FONT_PATH = Path("C:/Windows/Fonts/msjh.ttc")
FONT_BOLD_PATH = Path("C:/Windows/Fonts/msjhbd.ttc")
if not FONT_BOLD_PATH.exists():
    FONT_BOLD_PATH = FONT_PATH


def font(size, bold=False):
    return ImageFont.truetype(str(FONT_BOLD_PATH if bold else FONT_PATH), size)


TITLE = font(54, True)
SUBTITLE = font(32)
BODY = font(30)
SMALL = font(24)
TAG = font(26, True)

SLIDES = [
    {
        "kind": "title",
        "image": "01-dashboard.png",
        "title": "興強科技記帳平台",
        "subtitle": "教育訓練：雲端暫存、帳款 keyin、收付款、Excel 對帳",
        "bullets": ["開啟網站會自動讀取 Firebase 最新資料", "結束前記得下載 Excel 備份到本機"],
    },
    {
        "image": "01-dashboard.png",
        "step": "1",
        "title": "Dashboard 總覽",
        "bullets": ["查看應收未結、應付未結、逾期未結", "即將到期帳款會列在右側表格", "7 天內到期或逾期會跳提醒"],
    },
    {
        "image": "02-entry.png",
        "step": "2",
        "title": "新增帳款",
        "bullets": ["先選 ERP 客戶，客戶編號、幣別與付款天數會自動帶入", "輸入交易日期、金額與匯率", "系統會依 Payment Terms 自動推算到期日"],
    },
    {
        "image": "03-payments.png",
        "step": "3",
        "title": "登記已收已付",
        "bullets": ["選擇未結帳款", "輸入本次收款或付款金額", "押上收付款日期，系統會更新剩餘未結金額"],
    },
    {
        "image": "04-details.png",
        "step": "4",
        "title": "明細查詢與修改",
        "bullets": ["可用客戶、發票、訂單或備註搜尋", "選取帳款後載入表單修改", "資料錯誤時可刪除後重新 keyin"],
    },
    {
        "image": "05-customers.png",
        "step": "5",
        "title": "客戶主檔維護",
        "bullets": ["已建入 Excel 的 125 筆客戶清單", "可新增、刪除、修改客戶與付款條件", "下次 key 帳時會套用最新客戶資料"],
    },
    {
        "image": "06-excel.png",
        "step": "6",
        "title": "雲端暫存與 Excel 備份",
        "bullets": ["儲存雲端暫存：寫到 Firebase 後會重新讀回確認", "讀取雲端暫存：抓公司共用的最新資料", "下載 Excel：檔名會押當天日期，方便老闆對帳"],
    },
    {
        "kind": "closing",
        "image": "01-dashboard.png",
        "title": "每日使用流程",
        "bullets": ["開啟網站，自動讀取雲端", "新增帳款或登記已收已付", "按儲存雲端暫存", "下載 Excel 備份後再關閉網站"],
    },
]


def fit_cover(img, size):
    target_w, target_h = size
    scale = max(target_w / img.width, target_h / img.height)
    new = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)
    left = (new.width - target_w) // 2
    top = (new.height - target_h) // 2
    return new.crop((left, top, left + target_w, top + target_h))


def fit_contain(img, size):
    target_w, target_h = size
    scale = min(target_w / img.width, target_h / img.height)
    new = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, "#f3f5f1")
    canvas.paste(new, ((target_w - new.width) // 2, (target_h - new.height) // 2))
    return canvas


def rounded_rect(draw, xy, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def draw_text_block(draw, x, y, title, bullets, step=None):
    if step:
        rounded_rect(draw, (x, y, x + 84, y + 58), 12, "#0f4b42")
        draw.text((x + 28, y + 10), step, font=TAG, fill="white")
        x_title = x + 110
    else:
        x_title = x
    draw.text((x_title, y - 2), title, font=TITLE, fill="#10211e")
    by = y + 82
    for bullet in bullets:
        draw.ellipse((x + 4, by + 12, x + 16, by + 24), fill="#bc7410")
        draw.text((x + 32, by), bullet, font=BODY, fill="#263633")
        by += 52


def make_slide(spec):
    raw = Image.open(ASSET_DIR / spec["image"]).convert("RGB")
    bg = fit_cover(raw, (W, H)).filter(ImageFilter.GaussianBlur(10))
    overlay = Image.new("RGBA", (W, H), (243, 245, 241, 218))
    frame = Image.alpha_composite(bg.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(frame)

    if spec.get("kind") == "title":
        screenshot = fit_contain(raw, (1260, 710))
        rounded_rect(draw, (520, 280, 1810, 1020), 18, "#ffffff", "#d8e0da", 2)
        frame.paste(screenshot, (535, 295))
        rounded_rect(draw, (90, 90, 720, 835), 18, "#ffffff", "#d8e0da", 2)
        draw.text((130, 135), spec["title"], font=TITLE, fill="#10211e")
        draw.text((130, 215), spec["subtitle"], font=SUBTITLE, fill="#4a5b57")
        y = 330
        for bullet in spec["bullets"]:
            draw.ellipse((135, y + 12, 149, y + 26), fill="#bc7410")
            draw.text((170, y), bullet, font=BODY, fill="#263633")
            y += 62
        draw.text((130, 745), "網址：https://xingqiang-accounting.web.app", font=SMALL, fill="#0f4b42")
        return frame

    if spec.get("kind") == "closing":
        rounded_rect(draw, (250, 130, 1670, 890), 22, "#ffffff", "#d8e0da", 2)
        draw.text((315, 215), spec["title"], font=TITLE, fill="#10211e")
        y = 335
        for i, bullet in enumerate(spec["bullets"], start=1):
            rounded_rect(draw, (320, y - 4, 380, y + 56), 10, "#0f4b42")
            draw.text((340, y + 6), str(i), font=TAG, fill="white")
            draw.text((410, y + 4), bullet, font=SUBTITLE, fill="#263633")
            y += 96
        draw.text((315, 790), "提醒：關閉網站前，先下載一份 Excel 備份。", font=BODY, fill="#bc3a3a")
        return frame

    rounded_rect(draw, (70, 70, 730, 1010), 20, "#ffffff", "#d8e0da", 2)
    draw_text_block(draw, 120, 130, spec["title"], spec["bullets"], spec.get("step"))
    draw.text((120, 900), "興強科技記帳平台", font=SMALL, fill="#0f4b42")

    screenshot = fit_contain(raw, (1040, 780))
    rounded_rect(draw, (800, 145, 1850, 935), 18, "#ffffff", "#d8e0da", 2)
    frame.paste(screenshot, (805, 150))
    return frame


def main():
    frames = [make_slide(slide) for slide in SLIDES]
    frames[0].save(THUMB_PATH)

    writer = imageio.get_writer(VIDEO_PATH, fps=FPS, codec="libx264", quality=8, macro_block_size=1)
    try:
        for frame in frames:
            arr = np.asarray(frame)
            for _ in range(FPS * SLIDE_SECONDS):
                writer.append_data(arr)
    finally:
        writer.close()

    print(VIDEO_PATH)
    print(THUMB_PATH)


if __name__ == "__main__":
    main()
