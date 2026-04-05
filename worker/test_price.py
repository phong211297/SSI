import logging
import sys

logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(message)s")

from crawlers.price import get_active_tickers, fetch_prices_from_vci

tickers = get_active_tickers()
print(f"Active tickers ({len(tickers)}): {tickers}")

prices = fetch_prices_from_vci(tickers)
print(f"\n=== {len(prices)} records from VCI ===")
for p in prices:
    code = p.get("code", "?")
    o    = p.get("open", "N/A")
    h    = p.get("high", "N/A")
    l    = p.get("low", "N/A")
    c    = p.get("close", "N/A")
    vol  = p.get("volume", 0)
    pct  = p.get("percentPriceChange", 0)
    ref  = p.get("pricePreviousClose", "N/A")
    print(f"  {code:6s} | ref={ref} O={o} H={h} L={l} C={c} | vol={vol:,} | chg={pct:+.2f}%")

print("\nDone.")
