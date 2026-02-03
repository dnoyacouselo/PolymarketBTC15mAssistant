import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logFile = path.join(__dirname, 'logs', 'signals.csv');

if (!fs.existsSync(logFile)) {
    console.log(`File ${logFile} not found.`);
    process.exit(1);
}

const content = fs.readFileSync(logFile, 'utf8');
const lines = content.trim().split('\n');

if (lines.length < 2) {
    console.log("Log file is empty or only header.");
    process.exit(0);
}

const header = lines[0].split(',');
const data = lines.slice(1).map(line => {
    const values = line.split(',');
    // Handle quoted values if any (simple implementation)
    return values;
});

// Indices based on header: timestamp,entry_minute,time_left_min,regime,signal,model_up,...
const idxTimestamp = header.indexOf('timestamp');
const idxSignal = header.indexOf('signal');
const idxRec = header.indexOf('recommendation');
const idxModelUp = header.indexOf('model_up');

const parseDate = (d) => new Date(d);

const timestamps = data.map(r => parseDate(r[idxTimestamp])).filter(d => !isNaN(d));
if (timestamps.length === 0) {
    console.log("No valid timestamps found.");
    process.exit(0);
}

const startTime = new Date(Math.min(...timestamps));
const endTime = new Date(Math.max(...timestamps));
const durationMs = endTime - startTime;
const hours = Math.floor(durationMs / 3600000);
const minutes = Math.floor((durationMs % 3600000) / 60000);

console.log(`Analysis Period: ${startTime.toISOString()} to ${endTime.toISOString()}`);
console.log(`Duration: ${hours}h ${minutes}m`);
console.log(`Total Log Entries: ${data.length}`);

const signals = {};
const recommendations = {};
let sumModelUp = 0;
let countModelUp = 0;

data.forEach(row => {
    const sig = row[idxSignal];
    const rec = row[idxRec];
    const modUp = parseFloat(row[idxModelUp]);

    signals[sig] = (signals[sig] || 0) + 1;
    recommendations[rec] = (recommendations[rec] || 0) + 1;
    
    if (!isNaN(modUp)) {
        sumModelUp += modUp;
        countModelUp++;
    }
});

console.log("\n--- Signals Breakdown ---");
console.table(signals);

console.log("\n--- Recommendations Breakdown ---");
console.table(recommendations);

if (countModelUp > 0) {
    console.log(`\nAverage Model Up Probability: ${(sumModelUp / countModelUp).toFixed(4)}`);
}
