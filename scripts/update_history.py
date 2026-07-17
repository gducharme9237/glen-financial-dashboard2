#!/usr/bin/env python3
"""Create or replace today's financial-dashboard history snapshot."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

PORTFOLIO_PATH = Path("data/portfolio.json")
PRICES_PATH = Path("data/prices.json")
HISTORY_PATH = Path("data/history.json")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def valid_price(prices: dict, ticker: str) -> float:
    value = prices.get(ticker)
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if number > 0 else 0.0


def main() -> int:
    portfolio = read_json(PORTFOLIO_PATH)
    price_data = read_json(PRICES_PATH)
    prices = price_data.get("prices", {})

    holdings_values: dict[str, float] = {}
    brokerage_value = 0.0
    brokerage_cost_basis = 0.0

    for ticker, holding in portfolio["holdings"].items():
        value = valid_price(prices, ticker) * float(holding["shares"])
        holdings_values[ticker] = round(value, 2)
        brokerage_value += value
        brokerage_cost_basis += float(holding["cost_basis"])

    mu_price = valid_price(prices, portfolio["micron"]["ticker"])
    mu_value = mu_price * float(portfolio["micron"]["vested_shares"])
    hys_value = float(portfolio["hys"]["balance"])
    retirement_value = float(portfolio["retirement_401k"]["balance"])
    tracked_assets = brokerage_value + mu_value + hys_value + retirement_value

    now = datetime.now(timezone.utc)
    snapshot = {
        "date": now.date().isoformat(),
        "captured_at": now.isoformat(),
        "tracked_assets": round(tracked_assets, 2),
        "brokerage_value": round(brokerage_value, 2),
        "brokerage_cost_basis": round(brokerage_cost_basis, 2),
        "brokerage_gain_loss": round(brokerage_value - brokerage_cost_basis, 2),
        "hys_value": round(hys_value, 2),
        "mu_value": round(mu_value, 2),
        "mu_shares": float(portfolio["micron"]["vested_shares"]),
        "retirement_401k_value": round(retirement_value, 2),
        "holdings": holdings_values,
    }

    if HISTORY_PATH.exists():
        history = read_json(HISTORY_PATH)
    else:
        history = {"updated_at": None, "snapshots": []}

    snapshots = history.get("snapshots", [])
    snapshots = [row for row in snapshots if row.get("date") != snapshot["date"]]
    snapshots.append(snapshot)
    snapshots.sort(key=lambda row: row.get("date", ""))

    # Keep ten years of weekday snapshots at most.
    snapshots = snapshots[-2600:]

    result = {
        "updated_at": now.isoformat(),
        "snapshots": snapshots,
    }
    HISTORY_PATH.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(
        f"Saved {snapshot['date']}: tracked assets "
        f"${snapshot['tracked_assets']:,.2f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
