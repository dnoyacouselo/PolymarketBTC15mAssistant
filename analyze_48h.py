#!/usr/bin/env python3
"""
Analisis ultimas 48 horas - Post cambios (nuevos indicadores + scoring por regimen)
"""

import pandas as pd
import requests
from datetime import datetime, timezone
from collections import defaultdict

SYMBOL = "BTCUSDT"
BINANCE_URL = "https://api.binance.com/api/v3/klines"
SIGNAL_FILE = "signals (4).csv"

FILTER_FROM = "2026-02-12T00:00:00Z"

def load_signals():
    df = pd.read_csv(SIGNAL_FILE)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    return df

def get_window_start(ts):
    ts_ms = int(ts.timestamp() * 1000)
    window_size = 15 * 60 * 1000
    return ts_ms - (ts_ms % window_size)

def group_signals_by_window(df):
    windows = defaultdict(list)
    for _, row in df.iterrows():
        rec = str(row['recommendation'])
        if 'STRONG' in rec or 'GOOD' in rec:
            window_start = get_window_start(row['timestamp'])
            windows[window_start].append({
                'signal': row['signal'],
                'rec': rec,
                'model_up': row['model_up'],
                'model_down': row['model_down'],
                'edge_up': row['edge_up'],
                'edge_down': row['edge_down'],
                'regime': row['regime']
            })
    return windows

def fetch_binance_klines(start_time, end_time):
    all_klines = {}
    current_start = start_time
    while current_start < end_time:
        params = {
            'symbol': SYMBOL, 'interval': '15m',
            'startTime': current_start,
            'endTime': min(current_start + 1000 * 15 * 60 * 1000, end_time),
            'limit': 1000
        }
        response = requests.get(BINANCE_URL, params=params)
        if response.status_code != 200:
            break
        data = response.json()
        if not data:
            break
        for k in data:
            open_time = int(k[0])
            all_klines[open_time] = {
                'open': float(k[1]), 'close': float(k[4]),
                'result': 'UP' if float(k[4]) > float(k[1]) else 'DOWN'
            }
        current_start = max(all_klines.keys()) + 15 * 60 * 1000
    return all_klines

def determine_vote(signals):
    up = sum(1 for s in signals if 'UP' in s['signal'])
    dn = sum(1 for s in signals if 'DOWN' in s['signal'])
    if up > dn: return 'UP'
    if dn > up: return 'DOWN'
    return 'NEUTRAL'

def main():
    print("=" * 80)
    print("ANALISIS 12-FEB - Post ajuste MID + scoring regimen + leading indicators")
    print("=" * 80)

    df = load_signals()
    filter_date = pd.to_datetime(FILTER_FROM)
    df_new = df[df['timestamp'] >= filter_date].copy()

    if len(df_new) == 0:
        print("No hay datos desde", FILTER_FROM)
        return

    start_time = df_new['timestamp'].min()
    end_time = df_new['timestamp'].max()
    duration = end_time - start_time

    print(f"\n[PERIODO]  {start_time} -> {end_time}")
    print(f"[DURACION] {duration}")
    print(f"[REGISTROS] {len(df_new):,}")

    # --- Distribucion ---
    print("\n" + "-" * 80)
    print("DISTRIBUCION")
    print("-" * 80)
    sig_counts = df_new['signal'].value_counts()
    for sig, cnt in sig_counts.items():
        pct = cnt / len(df_new) * 100
        print(f"   {sig}: {cnt:,} ({pct:.1f}%)")

    print("\n[TOP RECOMENDACIONES]")
    rec_counts = df_new['recommendation'].value_counts()
    for rec, cnt in list(rec_counts.items())[:15]:
        print(f"   {rec}: {cnt:,}")

    print("\n[REGIMENES]")
    reg_counts = df_new['regime'].value_counts()
    for reg, cnt in reg_counts.items():
        pct = cnt / len(df_new) * 100
        print(f"   {reg}: {cnt:,} ({pct:.1f}%)")

    # --- Agrupar por ventanas ---
    windows = group_signals_by_window(df_new)
    active = {k: v for k, v in windows.items() if len(v) > 0}
    print(f"\n[VENTANAS ACTIVAS] {len(active)} con senales STRONG/GOOD")

    if not active:
        print("Sin senales accionables!")
        return

    sorted_wins = sorted(active.keys())
    fetch_start = sorted_wins[0]
    fetch_end = sorted_wins[-1] + 15 * 60 * 1000

    print("\nObteniendo precios de Binance...")
    klines = fetch_binance_klines(fetch_start, fetch_end)
    print(f"   Velas: {len(klines)}")

    # --- Verificacion ---
    results = {
        'total': {'c': 0, 'w': 0, 'details': []},
        'STRONG': {'c': 0, 'w': 0}, 'GOOD': {'c': 0, 'w': 0}, 'OPTIONAL': {'c': 0, 'w': 0},
        'EARLY': {'c': 0, 'w': 0}, 'MID': {'c': 0, 'w': 0}, 'LATE': {'c': 0, 'w': 0},
        'UP_vote': {'c': 0, 'w': 0}, 'DOWN_vote': {'c': 0, 'w': 0},
        'TREND_UP': {'c': 0, 'w': 0}, 'TREND_DOWN': {'c': 0, 'w': 0},
        'RANGE': {'c': 0, 'w': 0}, 'CHOP': {'c': 0, 'w': 0},
        'by_hour': defaultdict(lambda: {'c': 0, 'w': 0}),
        'by_day': defaultdict(lambda: {'c': 0, 'w': 0})
    }

    print("\n" + "=" * 80)
    print("RESULTADOS")
    print("=" * 80)
    print(f"\n{'Fecha':<12}{'Hora':<7}| {'Voto':<6} | {'Real':<6} | {'Open':>12} | {'Close':>12} | OK?")
    print("-" * 72)

    for ws in sorted_wins:
        kl = klines.get(ws)
        if not kl: continue
        sigs = active[ws]
        vote = determine_vote(sigs)
        if vote == 'NEUTRAL': continue

        ok = vote == kl['result']
        dt = datetime.fromtimestamp(ws / 1000, tz=timezone.utc)
        date_str = dt.strftime("%m-%d")
        time_str = dt.strftime("%H:%M")
        icon = "[OK]" if ok else "[X]"

        print(f"{date_str:<12}{time_str:<7}| {vote:<6} | {kl['result']:<6} | {kl['open']:>12.2f} | {kl['close']:>12.2f} | {icon}")

        results['total']['details'].append({
            'time': ws, 'vote': vote, 'result': kl['result'], 'correct': ok
        })

        bucket = 'c' if ok else 'w'
        results['total'][bucket] += 1
        results[f'{vote}_vote'][bucket] += 1
        results['by_hour'][dt.hour][bucket] += 1
        results['by_day'][date_str][bucket] += 1

        for s in sigs:
            rec = s['rec']
            regime = s.get('regime', '')
            for k in ['STRONG', 'GOOD', 'OPTIONAL']:
                if k in rec:
                    results[k][bucket] += 1
                    break
            for k in ['EARLY', 'MID', 'LATE']:
                if k in rec:
                    results[k][bucket] += 1
                    break
            if regime in results:
                results[regime][bucket] += 1

    # --- Resumen ---
    print("-" * 72)
    total = results['total']['c'] + results['total']['w']

    print(f"\n{'='*80}")
    print("RESUMEN")
    print(f"{'='*80}")

    if total == 0:
        print("\nNo hay intervalos verificables")
        return

    acc = results['total']['c'] / total * 100
    print(f"\n>>> PRECISION GLOBAL: {results['total']['c']}/{total} = {acc:.2f}% <<<")

    def show(label, d):
        t = d['c'] + d['w']
        if t > 0:
            a = d['c'] / t * 100
            print(f"   {label}: {d['c']}/{t} = {a:.1f}%")

    print("\n[POR FUERZA]")
    for k in ['STRONG', 'GOOD', 'OPTIONAL']:
        show(k, results[k])

    print("\n[POR TIMING]")
    for k in ['EARLY', 'MID', 'LATE']:
        show(k, results[k])

    print("\n[POR DIRECCION]")
    show("Votos UP", results['UP_vote'])
    show("Votos DOWN", results['DOWN_vote'])

    print("\n[POR REGIMEN]")
    for k in ['TREND_UP', 'TREND_DOWN', 'RANGE', 'CHOP']:
        show(k, results[k])

    print("\n[POR DIA]")
    for day in sorted(results['by_day'].keys()):
        show(day, results['by_day'][day])

    print("\n[POR HORA (UTC)]")
    for h in sorted(results['by_hour'].keys()):
        d = results['by_hour'][h]
        t = d['c'] + d['w']
        if t > 0:
            a = d['c'] / t * 100
            bar = "#" * int(a / 5)
            print(f"   {h:02d}:00 : {d['c']}/{t} ({a:5.1f}%) {bar}")

    # Rachas
    details = results['total']['details']
    mw = ml = cw = cl = 0
    for d in details:
        if d['correct']:
            cw += 1; cl = 0; mw = max(mw, cw)
        else:
            cl += 1; cw = 0; ml = max(ml, cl)
    print(f"\n[RACHAS]")
    print(f"   Mejor ganadora: {mw}")
    print(f"   Peor perdedora: {ml}")

    # --- Comparacion historica ---
    print(f"\n{'='*80}")
    print("COMPARACION HISTORICA")
    print(f"{'='*80}")

    gs = results['GOOD']['c'] + results['GOOD']['w']
    ss = results['STRONG']['c'] + results['STRONG']['w']
    ua = results['UP_vote']['c'] + results['UP_vote']['w']
    da = results['DOWN_vote']['c'] + results['DOWN_vote']['w']

    print(f"""
    METRICA              v1 (45h pre)   v2 (48h post)
    ---------------------------------------------------
    Precision Global     44.68%         {acc:.2f}%
    STRONG               27.5%          {results['STRONG']['c']/max(1,ss)*100:.1f}%
    GOOD                 56.6%          {results['GOOD']['c']/max(1,gs)*100:.1f}%
    Votos UP             25.5%          {results['UP_vote']['c']/max(1,ua)*100:.1f}%
    Votos DOWN           55.3%          {results['DOWN_vote']['c']/max(1,da)*100:.1f}%
    Total operaciones    154 en 44h     {total} en {duration}
    """)

    print("=" * 80)
    if acc >= 60:
        print("[VERDE] SISTEMA RENTABLE")
    elif acc >= 55:
        print("[VERDE-AMARILLO] SISTEMA CON EDGE")
    elif acc >= 50:
        print("[AMARILLO] SISTEMA MARGINAL")
    elif acc > 45:
        print("[NARANJA] LIGERA MEJORA")
    else:
        print("[ROJO] SIN MEJORA")
    print("=" * 80)

if __name__ == "__main__":
    main()
