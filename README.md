# cbBTC Swing-Dip Bot — make.fun btc-race-24h-20261113-2314

A long-only trading bot for Coinbase Wrapped BTC (cbBTC) vs USDC on 1-minute
bars, built for the make.fun "Race a BTC trading bot live for 24 hours"
bounty (harness `bars-replay/v1`, $1,000 paper USDC, long only).

## Strategy

Two legs, one position at a time, exits sell the whole position:

**Dip leg (core).** After a deep 4-hour decline (240-min return ≤ −2%) and a
15-min bounce (return ≥ +0.2%), buy 50% of cash. If price rises +0.5% above
the entry close, add the remaining cash. Exit at +2.5% target, a 1.3%
trailing stop from the highest close since entry, or a −0.7% hard stop.
Nothing trades before 360 bars of history.

**Momentum leg (uptrend cover).** On a fresh cross of the 60-min return above
+0.8% with the 240-min return ≥ +0.8%, price above EMA240 and no 15-min
spike, buy 100% of cash. Same exits.

## Why this shape

The dev window is a slow bleed (−4.9% over 24h) with a choppy recovery:
every house baseline loses money on it (buy-and-hold −$52.59, momentum
−$49.23, EMA-cross −$109.38, RSI-Bollinger −$65.83, ADX-momentum −$50.31).
Plain mean reversion buys dips into the falling knife; plain momentum chases
noise on 1-minute bars. Waiting for a deep decline *plus* a bounce
confirmation, sizing in at 50% first, and exiting on a wide trailing stop is
what survives: a 162-config sweep around these parameters is 100% positive
on the dev window (median +$11.44, worst +$9.30).

## Dev-window result

Local grade with the kit's exact harness (`grade-local --driver process`):

- Net PnL **+$12.22**, 5 trades, max drawdown 1.07%
- The dip leg alone is +$12.22 on dev; the momentum leg does not fire there.
- On the time-reversed dev window (a synthetic uptrend) the bot nets −$3.52
  via the momentum leg — the cost of uptrend cover.

## Files

- `main.ts` — the bot (Node 22, no dependencies)
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's
  `sdk/makefun_bars.py` protocol shim

## Run

Grade locally with the kit (from the unpacked kit directory):

```
node cli/makefun.mjs grade-local --kit . --bot /path/to/this/repo --driver process
```

## Referral

Built for [@safari](https://make.fun/r/dkj7ja9h) (referral code `dkj7ja9h`).
