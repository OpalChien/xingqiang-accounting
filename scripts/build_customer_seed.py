import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import streamlit_app  # noqa: E402

SOURCE = ROOT / "Twn ERP customer data 1150706.xls"
TARGET = ROOT / "public" / "customer_seed.json"


def main() -> None:
    customers = streamlit_app.parse_customer_workbook(SOURCE)
    payload = {
        "source": SOURCE.name,
        "customer_count": len(customers),
        "customers": customers,
    }
    TARGET.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(customers)} customers to {TARGET}")


if __name__ == "__main__":
    main()
