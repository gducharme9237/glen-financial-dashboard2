#!/usr/bin/env python3

import json
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SYMBOLS = ["VOO", "FSKAX", "SCHD", "VXUS", "MU"]
OUTPUT = Path("data/prices.json")
API_URL = "https://www.alphavantage.co/query"


def fetch_quote(symbol: str, api_key: str) -> float:
    params = urllib.parse.urlencode(
        {
            "function": "GLOBAL_QUOTE",
            "symbol": symbol,
            "apikey": api_key,
        }
    )

    request = urllib.request.Request(
        f"{API_URL}?{params}",
        headers={"User-Agent": "glen-financial-dashboard/1.0"},
    )

    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)

    quote = payload.get("Global Quote", {})
    raw_price = quote.get("05. price")

    if raw_price:
        price = float(raw_price)
        if price > 0:
            return price

    message = (
        payload.get("Note")
        or payload.get("Information")
        or payload.get("Error Message")
        or f"No quote returned for {symbol}"
    )

    raise RuntimeError(str(message))


def load_previous() -> dict:
    if not OUTPUT.exists():
        return {"prices": {}, "errors": {}}

    try:
        return json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"prices": {}, "errors": {}}


def main() -> int:
    api_key = os.environ.get("ALPHA_VANTAGE_API_KEY", "").strip()

    if not api_key:
        raise RuntimeError("Missing ALPHA_VANTAGE_API_KEY")

    previous = load_previous()
    prices = dict(previous.get("prices", {}))
    errors = {}

    for index, symbol in enumerate(SYMBOLS):
        try:
            prices[symbol] = round(fetch_quote(symbol, api_key), 4)
            print(f"{symbol}: {prices[symbol]}")
        except Exception as exc:
            errors[symbol] = str(exc)
            print(f"{symbol}: {exc}")

        if index < len(SYMBOLS) - 1:
            time.sleep(13)

    result = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "source": "Alpha Vantage GLOBAL_QUOTE",
        "prices": {symbol: prices.get(symbol) for symbol in SYMBOLS},
        "errors": errors,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")

    valid_prices = [
        price
        for price in result["prices"].values()
        if isinstance(price, (int, float)) and price > 0
    ]

    return 0 if valid_prices else 1


if __name__ == "__main__":
    raise SystemExit(main())
