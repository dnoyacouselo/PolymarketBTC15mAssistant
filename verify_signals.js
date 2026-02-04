// verify_signals.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const CONFIG = {
    symbol: "BTCUSDT",
    baseUrl: "https://api.binance.com"
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logFile = path.join(__dirname, 'signals.csv');

// 1. Read Signals
if (!fs.existsSync(logFile)) {
    console.error(`File ${logFile} not found.`);
    process.exit(1);
}

const content = fs.readFileSync(logFile, 'utf8');
const lines = content.trim().split('\n');
const header = lines[0].split(',');
const idxTimestamp = header.indexOf('timestamp');
const idxSignal = header.indexOf('signal');
const idxRec = header.indexOf('recommendation');

// Group signals by 15-minute windows
// Window ID = floor(timestamp / 15min)
const windows = {};

console.log("Processing signals...");

lines.slice(1).forEach(line => {
    const parts = line.split(',');
    const tsStr = parts[idxTimestamp];
    if (!tsStr) return;
    
    const ts = new Date(tsStr).getTime();
    if (isNaN(ts)) return;

    // Binance 15m candles start at 00, 15, 30, 45
    // Window Start = ts - (ts % 15*60*1000)
    const windowSize = 15 * 60 * 1000;
    const windowStart = ts - (ts % windowSize);
    
    if (!windows[windowStart]) {
        windows[windowStart] = {
            startTime: windowStart,
            signals: [],
            finalRecommendation: null
        };
    }
    
    const sig = parts[idxSignal];
    const rec = parts[idxRec];
    
    // Only care about strong/actionable signals for accuracy check
    // If recommendation contains "STRONG" or "GOOD", we count it
    if (rec && (rec.includes("STRONG") || rec.includes("GOOD"))) {
        windows[windowStart].signals.push({ ts, sig, rec });
    }
});

// Remove windows with no actionable signals
const activeWindows = Object.values(windows).filter(w => w.signals.length > 0);

if (activeWindows.length === 0) {
    console.log("No actionable signals found (STRONG or GOOD) in the logs.");
    process.exit(0);
}

// Sort by time
activeWindows.sort((a, b) => a.startTime - b.startTime);

const startTime = activeWindows[0].startTime;
const endTime = activeWindows[activeWindows.length - 1].startTime + (15 * 60 * 1000); // end of last window

console.log(`Analyzing signals from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);
console.log(`Found ${activeWindows.length} active 15m windows with signals.`);

// 2. Fetch Binance Klines
async function fetchKlines(start, end) {
    const url = new URL("/api/v3/klines", CONFIG.baseUrl);
    url.searchParams.set("symbol", CONFIG.symbol);
    url.searchParams.set("interval", "15m");
    url.searchParams.set("startTime", start);
    url.searchParams.set("endTime", end);
    // Limit is 1000, usually enough for 8 hours (32 candles)
    url.searchParams.set("limit", "1000");

    console.log(`Fetching prices from Binance...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance error: ${res.status}`);
    const data = await res.json();
    
    // Process into map: startTime -> { open, close }
    const klines = {};
    data.forEach(k => {
        const time = Number(k[0]);
        const open = Number(k[1]);
        const close = Number(k[4]);
        klines[time] = { open, close, result: close > open ? 'UP' : 'DOWN' };
    });
    return klines;
}

(async () => {
    try {
        const klines = await fetchKlines(startTime, endTime);
        
        // 3. Compare Signals vs Reality
        let correct = 0;
        let wrong = 0;
        let total = 0;
        
        console.log("\n--- Verification Results ---");
        console.log("Window (UTC)         | Vote  | Result | Open      | Close     | Outcome");
        console.log("-------------------------------------------------------------------------");

        for (const w of activeWindows) {
            const kline = klines[w.startTime];
            if (!kline) {
                // Candle might actally not exist yet if it's the current live one
                // Or if data is missing
                continue;
            }

            // Determine Bot's Vote for this window
            // Simple logic: Majority vote of STRONG signals, or last STRONG signal
            let upCount = 0;
            let downCount = 0;
            
            w.signals.forEach(s => {
                if (s.sig.includes("UP")) upCount++;
                if (s.sig.includes("DOWN")) downCount++;
            });

            let vote = "NEUTRAL";
            if (upCount > downCount) vote = "UP";
            else if (downCount > upCount) vote = "DOWN";

            if (vote === "NEUTRAL") continue;

            const isCorrect = (vote === kline.result);
            
            const timeStr = new Date(w.startTime).toISOString().slice(11, 16);
            const resIcon = isCorrect ? "✅" : "❌";
            
            console.log(`${timeStr} (15m)        | ${vote.padEnd(4)}  | ${kline.result.padEnd(4)}   | ${kline.open.toFixed(2)} | ${kline.close.toFixed(2)} | ${resIcon}`);
            
            if (isCorrect) correct++;
            else wrong++;
            total++;
        }

        console.log("-------------------------------------------------------------------------");
        console.log(`Total Intervals Verified: ${total}`);
        console.log(`Correct: ${correct}`);
        console.log(`Wrong: ${wrong}`);
        if (total > 0) {
            console.log(`Accuracy: ${((correct / total) * 100).toFixed(2)}%`);
        }

    } catch (err) {
        console.error("Error:", err);
    }
})();
