/**
 * Inventory tracker for Polymarket binary contracts.
 *
 * Tracks current position (UP / DOWN contracts held),
 * persists to a JSON file, and provides net inventory (q)
 * for the Avellaneda-Stoikov reservation price model.
 */

import fs from "node:fs";
import path from "node:path";

const INVENTORY_FILE = path.resolve("./logs/inventory.json");

let inventory = { up: 0, down: 0 };

function persist() {
  try {
    fs.mkdirSync(path.dirname(INVENTORY_FILE), { recursive: true });
    fs.writeFileSync(INVENTORY_FILE, JSON.stringify(inventory, null, 2), "utf8");
  } catch { /* ignore */ }
}

export function loadInventory() {
  try {
    if (fs.existsSync(INVENTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(INVENTORY_FILE, "utf8"));
      inventory.up = Number(data.up) || 0;
      inventory.down = Number(data.down) || 0;
    }
  } catch { /* ignore */ }
  return { ...inventory };
}

export function getInventory() {
  return { ...inventory };
}

/**
 * Net inventory: positive = long UP exposure, negative = long DOWN exposure.
 * Used as `q` in the Avellaneda-Stoikov reservation price formula.
 */
export function netInventory() {
  return inventory.up - inventory.down;
}

/**
 * Record a fill.
 * @param {"UP"|"DOWN"} side
 * @param {number} contracts - positive = bought, negative = sold/expired
 */
export function updateInventory(side, contracts) {
  if (side === "UP") inventory.up += contracts;
  else if (side === "DOWN") inventory.down += contracts;

  inventory.up = Math.max(0, inventory.up);
  inventory.down = Math.max(0, inventory.down);
  persist();
}

/**
 * Reset inventory to zero (e.g. after market settlement).
 */
export function resetInventory() {
  inventory = { up: 0, down: 0 };
  persist();
}
