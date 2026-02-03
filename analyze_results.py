import pandas as pd
import os

log_file = 'logs/signals.csv'

if not os.path.exists(log_file):
    print(f"File {log_file} not found.")
    exit()

try:
    df = pd.read_csv(log_file)
except Exception as e:
    print(f"Error reading CSV: {e}")
    exit()

# Basic stats
if df.empty:
    print("Log file is empty.")
    exit()

df['timestamp'] = pd.to_datetime(df['timestamp'])
start_time = df['timestamp'].min()
end_time = df['timestamp'].max()
duration = end_time - start_time

print(f"Analysis Period: {start_time} to {end_time}")
print(f"Duration: {duration}")
print(f"Total Log Entries: {len(df)}")

print("\n--- Signals Breakdown ---")
print(df['signal'].value_counts())

print("\n--- Recommendations Breakdown ---")
print(df['recommendation'].value_counts())

print("\n--- Average Confidence (Model Up) ---")
print(df['model_up'].mean())

# Filter for actual trades (assuming 'BUY UP' or 'BUY DOWN')
trades = df[df['signal'].isin(['BUY UP', 'BUY DOWN'])]
if not trades.empty:
    print("\n--- Trade Signals ---")
    print(f"Total Trade Signals: {len(trades)}")
    
    # Group by consecutive signals to estimate unique trade opportunities (simple heuristic)
    # If timestamps are close (e.g. < 5 min), count as 1 event?
    # Or just show signal count
    print("First trade signal:", trades['timestamp'].min())
    print("Last trade signal:", trades['timestamp'].max())
else:
    print("\nNo BUY signals found.")
