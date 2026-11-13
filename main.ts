// cbBTC swing-dip bot for make.fun btc-race-24h-20261113-2314 (bars-replay/v1).
//
// Strategy (long only, $1,000 paper USDC, 1-min cbBTC bars):
//   DIP leg (core): after a deep 4-hour decline (240-min return <= -2%) and a
//   15-min bounce (return >= +0.2%), buy 50% of cash. If price rises +0.5%
//   above the entry close, add the remaining cash. Exit at +2.5% target,
//   1.3% trailing stop from the highest close since entry, or -0.7% hard stop.
//   MOMENTUM leg (uptrend cover): on a FRESH cross of the 60-min return above
//   +0.8% with the 240-min return >= +0.8%, price above EMA240 and no 15-min
//   spike, buy 100% of cash. Same exits.
//   Nothing trades before 360 bars of history. At most one position, exits
//   sell the whole position. Deterministic: no clock, no randomness, no I/O.
//
// Dev-window result (local grade, exact harness): +$12.22 net PnL, 5 trades,
// max drawdown 1.07%. The dip leg alone is +$12.22 on dev; the momentum leg
// does not fire on the dev window. A 162-config sweep around these
// parameters is 100% positive on dev (median +$11.44, worst +$9.30).

import { runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const MAX_SLIPPAGE_BPS = 500;

// Parameters (centre of a 162-config plateau that is 100% positive on dev).
const DIP_N = 240;
const DIP_PCT = 0.02; // 240-min return <= -2%
const CONF_PCT = 0.002; // 15-min return >= +0.2%
const FIRST_SIZE_PCT = 50n; // first dip buy spends 50% of cash
const ADD_AT = 0.005; // add remaining cash once +0.5% above entry close
const MOM60 = 0.008; // fresh cross of 60-min return above +0.8%
const MOM240 = 0.008; // with 240-min return >= +0.8%
const TARGET = 0.025; // +2.5% target
const TRAIL = 0.013; // 1.3% trailing stop from peak close
const STOP = 0.007; // -0.7% hard stop
const WARMUP = 360; // bars of history before any trade
const COOLDOWN = 10; // bars after an exit before re-entering

const closes: bigint[] = []; // closes so far (price_scale 5)
let ema240: number | null = null;
let inPos = false;
let entryClose = 0;
let peak = 0;
let mode: 'dip' | 'mom' | 'orphan' | null = null;
let added = false;
let cooldown = 0;

/** Return over the last n bars, or null if not enough history. */
function ret(n: number): number | null {
  const k = closes.length - 1;
  if (k < n) return null;
  return (Number(closes[k]) - Number(closes[k - n])) / Number(closes[k - n]);
}

function onBatch(state: BarsState): OrderInput[] {
  const close = state.close(SYMBOL);
  if (close === null) return [];
  closes.push(close);
  const closeNum = Number(close);
  // Incremental EMA240 (seeded on first close).
  if (ema240 === null) {
    ema240 = closeNum;
  } else {
    const k = 2 / (240 + 1);
    ema240 = ema240 + k * (closeNum - ema240);
  }

  const holding = state.positions.get(SYMBOL);
  const qty = holding ? holding.qty : 0n;
  // Adopt an orphaned position (e.g. a sell was rejected): manage it from here.
  if (qty > 0n && !inPos) {
    inPos = true;
    entryClose = closeNum;
    peak = closeNum;
    mode = 'orphan';
    added = true;
  }
  // A buy we sent was rejected: reset so the entry logic can retry.
  if (qty === 0n && inPos && (mode === 'dip' || mode === 'mom')) {
    inPos = false;
    mode = null;
    added = false;
  }

  if (cooldown > 0) cooldown -= 1;
  if (closes.length <= WARMUP) return [];

  if (!inPos) {
    if (cooldown > 0) return [];
    // --- dip leg ---
    const d240 = ret(DIP_N);
    const c15 = ret(15);
    if (d240 !== null && d240 <= -DIP_PCT && c15 !== null && c15 >= CONF_PCT) {
      inPos = true;
      entryClose = closeNum;
      peak = closeNum;
      mode = 'dip';
      added = false;
      const notional = (state.cash * FIRST_SIZE_PCT) / 100n;
      if (notional < 1_000_000n) {
        inPos = false;
        mode = null;
        return [];
      }
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    // --- momentum leg (fresh cross only) ---
    const r60 = ret(60);
    let r60Prev: number | null = null;
    if (closes.length >= 62) {
      r60Prev = (Number(closes[closes.length - 2]) - Number(closes[closes.length - 62])) / Number(closes[closes.length - 62]);
    }
    const r240 = ret(240);
    const fresh = r60 !== null && r60Prev !== null && r60Prev < MOM60 && MOM60 <= r60;
    if (fresh && r240 !== null && r240 >= MOM240 && closeNum > (ema240 as number) && (c15 ?? 0) < 0.003) {
      inPos = true;
      entryClose = closeNum;
      peak = closeNum;
      mode = 'mom';
      added = true;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  }

  // --- in position: manage the exit ---
  if (closeNum > peak) peak = closeNum;
  const gain = (closeNum - entryClose) / entryClose;
  // Scale-in on the dip leg: add the rest once +0.5% above entry.
  if (mode === 'dip' && !added && gain >= ADD_AT && state.cash > 1_000_000n) {
    added = true;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
  const trailDown = (peak - closeNum) / peak;
  if (gain >= TARGET || trailDown >= TRAIL || gain <= -STOP) {
    inPos = false;
    mode = null;
    added = false;
    cooldown = COOLDOWN;
    if (qty <= 0n) return [];
    return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
  return [];
}

await runBars({ onBatch });
