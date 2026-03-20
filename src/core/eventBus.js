/**
 * Centralised event bus for the trading system.
 *
 * Events:
 *   "price:binance"    – { price, timestamp }
 *   "price:chainlink"  – { price, updatedAt, source }
 *   "price:polymarket" – { price, updatedAt }
 *   "orderbook:update" – { up, down }
 *   "market:new"       – { market }
 *   "signal:evaluate"  – triggers a full indicator + decision cycle
 *   "signal:result"    – { rec, edge, blended, regime, vpin, ... }
 */

import { EventEmitter } from "node:events";

export const bus = new EventEmitter();
bus.setMaxListeners(30);

/**
 * Throttled event listener.
 *
 * Calls handler at most once every `ms` milliseconds.
 * When events arrive during the cooldown window the latest
 * payload is held and dispatched when the window expires —
 * so no event is silently dropped.
 *
 * @param {string}   event
 * @param {Function} handler
 * @param {number}   ms - throttle window (default 500)
 * @returns {Function} the wrapped handler (for removeListener)
 */
export function onThrottled(event, handler, ms = 500) {
  let timer = null;
  let latestArgs = null;

  const wrapped = (...args) => {
    latestArgs = args;
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        if (latestArgs) {
          handler(...latestArgs);
          latestArgs = null;
        }
      }, ms);
    }
  };

  bus.on(event, wrapped);
  return wrapped;
}
