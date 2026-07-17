import argparse
import json
from pathlib import Path


PORTFOLIO_FILE = Path("data/portfolio.json")


def parse_balance(value: str) -> float:
    cleaned = value.replace("$", "").replace(",", "").strip()

    try:
        balance = float(cleaned)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            "Balance must be a valid number, such as 842500.25"
        ) from exc

    if balance < 0:
        raise argparse.ArgumentTypeError("Balance cannot be negative.")

    return round(balance, 2)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Update the dashboard's current 401(k) balance."
    )
    parser.add_argument("balance", type=parse_balance)
    args = parser.parse_args()

    if not PORTFOLIO_FILE.exists():
        raise FileNotFoundError(f"Could not find {PORTFOLIO_FILE}")

    with PORTFOLIO_FILE.open("r", encoding="utf-8") as file:
        portfolio = json.load(file)

    retirement = portfolio.get("retirement_401k")

    if not isinstance(retirement, dict):
        raise KeyError(
            "data/portfolio.json does not contain a retirement_401k section."
        )

    previous_balance = retirement.get("balance")
    retirement["balance"] = args.balance

    with PORTFOLIO_FILE.open("w", encoding="utf-8") as file:
        json.dump(portfolio, file, indent=2)
        file.write("\n")

    print(f"Updated 401(k) balance: {previous_balance} → {args.balance}")


if __name__ == "__main__":
    main()
