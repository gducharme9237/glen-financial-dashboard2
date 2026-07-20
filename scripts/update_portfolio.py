#!/usr/bin/env python3
"""Update portfolio balances and write today's history snapshot."""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PORTFOLIO_PATH = Path("data/portfolio.json")
PRICES_PATH = Path("data/prices.json")
HISTORY_PATH = Path("data/history.json")


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Required file not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")


def positive_number(value: str, field_name: str) -> float:
    try:
        number = float(value)
    except ValueError as exc:
        raise ValueError(f"{field_name} must be a number.") from exc
    if not math.isfinite(number) or number <= 0:
        raise ValueError(f"{field_name} must be greater than zero.")
    return number


def nonnegative_number(value: str, field_name: str) -> float:
    try:
        number = float(value)
    except ValueError as exc:
        raise ValueError(f"{field_name} must be a number.") from exc
    if not math.isfinite(number) or number < 0:
        raise ValueError(f"{field_name} cannot be negative.")
    return number


def update_brokerage(portfolio: dict[str, Any], ticker: str, shares: str, price: str) -> str:
    ticker = ticker.strip().upper()
    holdings = portfolio.get("holdings", {})
    if ticker not in holdings:
        allowed = ", ".join(sorted(holdings))
        raise ValueError(f"{ticker} is not an existing holding. Choose one of: {allowed}")

    added_shares = positive_number(shares, "Shares purchased")
    purchase_price = positive_number(price, "Purchase price")

    holding = holdings[ticker]
    old_shares = float(holding.get("shares", 0))
    old_cost_basis = float(holding.get("cost_basis", 0))
    purchase_cost = added_shares * purchase_price

    holding["shares"] = round(old_shares + added_shares, 6)
    holding["cost_basis"] = round(old_cost_basis + purchase_cost, 2)

    return (
        f"{ticker}: added {added_shares:g} shares at ${purchase_price:,.2f}; "
        f"new total {holding['shares']:g} shares, cost basis ${holding['cost_basis']:,.2f}"
    )


def update_hys(portfolio: dict[str, Any], transaction_type: str, amount: str, note: str) -> str:
    transaction_type = transaction_type.strip().lower()
    if transaction_type not in {"deposit", "interest", "withdrawal"}:
        raise ValueError("Transaction type must be deposit, interest, or withdrawal.")

    value = positive_number(amount, "Amount")
    hys = portfolio["hys"]
    old_balance = float(hys.get("balance", 0))
    new_balance = old_balance - value if transaction_type == "withdrawal" else old_balance + value

    if new_balance < 0:
        raise ValueError("Withdrawal exceeds the current HYS balance.")

    hys["balance"] = round(new_balance, 2)

    transaction = {
        "date": datetime.now(timezone.utc).date().isoformat(),
        "type": transaction_type,
        "amount": round(value, 2),
    }
    if note.strip():
        transaction["note"] = note.strip()

    hys.setdefault("transactions", []).append(transaction)

    return (
        f"HYS: {transaction_type} ${value:,.2f}; "
        f"new balance ${hys['balance']:,.2f}"
    )


def update_401k(portfolio: dict[str, Any], balance: str) -> str:
    value = nonnegative_number(balance, "401(k) balance")
    portfolio["retirement_401k"]["balance"] = round(value, 2)
    return f"401(k): new balance ${value:,.2f}"


def write_history_snapshot(portfolio: dict[str, Any]) -> None:
    prices_data = load_json(PRICES_PATH)
    prices = prices_data.get("prices", {})

    brokerage_value = 0.0
    for ticker, holding in portfolio.get("holdings", {}).items():
        price = float(prices.get(ticker, 0) or 0)
        brokerage_value += price * float(holding.get("shares", 0))

    micron = portfolio.get("micron", {})
    micron_price = float(prices.get(micron.get("ticker", "MU"), 0) or 0)
    micron_value = micron_price * float(micron.get("vested_shares", 0))

    retirement_value = float(portfolio.get("retirement_401k", {}).get("balance", 0))
    hys_value = float(portfolio.get("hys", {}).get("balance", 0))
    tracked_assets = brokerage_value + micron_value + retirement_value + hys_value

    if HISTORY_PATH.exists():
        history = load_json(HISTORY_PATH)
    else:
        history = {"snapshots": []}

    snapshot = {
        "date": datetime.now(timezone.utc).date().isoformat(),
        "tracked_assets": round(tracked_assets, 2),
        "brokerage_value": round(brokerage_value, 2),
        "retirement_401k_value": round(retirement_value, 2),
        "micron_value": round(micron_value, 2),
        "hys_value": round(hys_value, 2),
    }

    snapshots = history.setdefault("snapshots", [])
    snapshots = [row for row in snapshots if row.get("date") != snapshot["date"]]
    snapshots.append(snapshot)
    snapshots.sort(key=lambda row: row.get("date", ""))

    history["snapshots"] = snapshots
    history["updated_at"] = datetime.now(timezone.utc).isoformat()
    save_json(HISTORY_PATH, history)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    brokerage = subparsers.add_parser("brokerage")
    brokerage.add_argument("--ticker", required=True)
    brokerage.add_argument("--shares", required=True)
    brokerage.add_argument("--price", required=True)

    hys = subparsers.add_parser("hys")
    hys.add_argument("--type", required=True, dest="transaction_type")
    hys.add_argument("--amount", required=True)
    hys.add_argument("--note", default="")

    retirement = subparsers.add_parser("401k")
    retirement.add_argument("--balance", required=True)

    return parser


def main() -> None:
    args = build_parser().parse_args()
    portfolio = load_json(PORTFOLIO_PATH)

    if args.command == "brokerage":
        message = update_brokerage(portfolio, args.ticker, args.shares, args.price)
    elif args.command == "hys":
        message = update_hys(
            portfolio,
            args.transaction_type,
            args.amount,
            args.note,
        )
    else:
        message = update_401k(portfolio, args.balance)

    portfolio["updated_at"] = datetime.now(timezone.utc).isoformat()
    save_json(PORTFOLIO_PATH, portfolio)
    write_history_snapshot(portfolio)
    print(message)
    print("Today's history snapshot was refreshed.")


if __name__ == "__main__":
    main()
