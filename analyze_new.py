#!/usr/bin/env python3
"""
Analisis de datos nuevos (desde ayer) - Post cambios
"""

import pandas as pd
import requests
from datetime import datetime, timezone
from collections import defaultdict

SYMBOL = "BTCUSDT"
BINANCE_URL = "https://api.binance.com/api/v3/klines"
SIGNAL_FILE = "signals (2).csv"

# Filtrar desde esta fecha (ayer = 2026-02-04)
FILTER_FROM = "2026-02-04T00:00:00Z"

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
            'symbol': SYMBOL,
            'interval': '15m',
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
                'open': float(k[1]),
                'close': float(k[4]),
                'result': 'UP' if float(k[4]) > float(k[1]) else 'DOWN'
            }
        
        current_start = max(all_klines.keys()) + 15 * 60 * 1000
    
    return all_klines

def determine_vote(signals):
    up_count = sum(1 for s in signals if 'UP' in s['signal'])
    down_count = sum(1 for s in signals if 'DOWN' in s['signal'])
    
    if up_count > down_count:
        return 'UP'
    elif down_count > up_count:
        return 'DOWN'
    return 'NEUTRAL'

def main():
    print("=" * 80)
    print("ANALISIS POST-CAMBIOS - Datos desde ayer (2026-02-04)")
    print("=" * 80)
    
    # Cargar datos
    print("\nCargando datos...")
    df = load_signals()
    
    # Filtrar desde ayer
    filter_date = pd.to_datetime(FILTER_FROM)
    df_new = df[df['timestamp'] >= filter_date].copy()
    
    print(f"Total registros: {len(df):,}")
    print(f"Registros desde {FILTER_FROM}: {len(df_new):,}")
    
    if len(df_new) == 0:
        print("No hay datos nuevos!")
        return
    
    start_time = df_new['timestamp'].min()
    end_time = df_new['timestamp'].max()
    duration = end_time - start_time
    
    print(f"\n[PERIODO ANALIZADO]")
    print(f"   Desde: {start_time}")
    print(f"   Hasta: {end_time}")
    print(f"   Duracion: {duration}")
    
    # Estadisticas de senales
    print("\n" + "-" * 80)
    print("DISTRIBUCION DE SENALES (nuevos datos)")
    print("-" * 80)
    
    signal_counts = df_new['signal'].value_counts()
    for sig, count in signal_counts.items():
        pct = count / len(df_new) * 100
        print(f"   {sig}: {count:,} ({pct:.1f}%)")
    
    print("\n[TOP RECOMENDACIONES]")
    rec_counts = df_new['recommendation'].value_counts()
    for rec, count in list(rec_counts.items())[:12]:
        print(f"   {rec}: {count:,}")
    
    # Agrupar por ventanas
    windows = group_signals_by_window(df_new)
    active_windows = {k: v for k, v in windows.items() if len(v) > 0}
    
    print(f"\n[VENTANAS ACTIVAS] {len(active_windows)} intervalos con senales STRONG/GOOD")
    
    if len(active_windows) == 0:
        print("No hay senales accionables!")
        return
    
    # Obtener precios
    sorted_windows = sorted(active_windows.keys())
    fetch_start = sorted_windows[0]
    fetch_end = sorted_windows[-1] + (15 * 60 * 1000)
    
    print("\nObteniendo precios de Binance...")
    klines = fetch_binance_klines(fetch_start, fetch_end)
    print(f"   Velas obtenidas: {len(klines)}")
    
    # Analizar
    results = {
        'total': {'correct': 0, 'wrong': 0, 'details': []},
        'STRONG': {'correct': 0, 'wrong': 0},
        'GOOD': {'correct': 0, 'wrong': 0},
        'EARLY': {'correct': 0, 'wrong': 0},
        'MID': {'correct': 0, 'wrong': 0},
        'LATE': {'correct': 0, 'wrong': 0},
        'UP_vote': {'correct': 0, 'wrong': 0},
        'DOWN_vote': {'correct': 0, 'wrong': 0},
        'TREND_UP': {'correct': 0, 'wrong': 0},
        'TREND_DOWN': {'correct': 0, 'wrong': 0},
    }
    
    print("\n" + "=" * 80)
    print("RESULTADOS DE VERIFICACION")
    print("=" * 80)
    print(f"\n{'Hora UTC':<10} | {'Voto':<6} | {'Real':<6} | {'Open':>12} | {'Close':>12} | OK?")
    print("-" * 65)
    
    for window_start in sorted_windows:
        kline = klines.get(window_start)
        if not kline:
            continue
        
        signals = active_windows[window_start]
        vote = determine_vote(signals)
        
        if vote == 'NEUTRAL':
            continue
        
        is_correct = vote == kline['result']
        
        time_str = datetime.fromtimestamp(window_start / 1000, tz=timezone.utc).strftime("%m-%d %H:%M")
        icon = "[OK]" if is_correct else "[X]"
        
        print(f"{time_str:<10} | {vote:<6} | {kline['result']:<6} | {kline['open']:>12.2f} | {kline['close']:>12.2f} | {icon}")
        
        results['total']['details'].append({
            'time': window_start,
            'vote': vote,
            'result': kline['result'],
            'correct': is_correct
        })
        
        if is_correct:
            results['total']['correct'] += 1
        else:
            results['total']['wrong'] += 1
        
        # Por direccion
        key = f"{vote}_vote"
        if is_correct:
            results[key]['correct'] += 1
        else:
            results[key]['wrong'] += 1
        
        # Por tipo de senal
        for s in signals:
            rec = s['rec']
            regime = s.get('regime', '')
            
            # Fuerza
            if 'STRONG' in rec:
                if is_correct:
                    results['STRONG']['correct'] += 1
                else:
                    results['STRONG']['wrong'] += 1
            elif 'GOOD' in rec:
                if is_correct:
                    results['GOOD']['correct'] += 1
                else:
                    results['GOOD']['wrong'] += 1
            
            # Timing
            for timing in ['EARLY', 'MID', 'LATE']:
                if timing in rec:
                    if is_correct:
                        results[timing]['correct'] += 1
                    else:
                        results[timing]['wrong'] += 1
            
            # Regimen
            if regime in ['TREND_UP', 'TREND_DOWN']:
                if is_correct:
                    results[regime]['correct'] += 1
                else:
                    results[regime]['wrong'] += 1
    
    # Resumen
    print("-" * 65)
    total = results['total']['correct'] + results['total']['wrong']
    
    print(f"\n{'='*80}")
    print("RESUMEN DE RESULTADOS")
    print(f"{'='*80}")
    
    if total > 0:
        accuracy = results['total']['correct'] / total * 100
        print(f"\n>>> PRECISION GLOBAL: {results['total']['correct']}/{total} = {accuracy:.2f}% <<<")
    else:
        print("\nNo hay suficientes datos para calcular precision")
        return
    
    print("\n[POR FUERZA DE SENAL]")
    for key in ['STRONG', 'GOOD']:
        c = results[key]['correct']
        w = results[key]['wrong']
        t = c + w
        if t > 0:
            acc = c / t * 100
            print(f"   {key}: {c}/{t} = {acc:.1f}%")
        else:
            print(f"   {key}: Sin datos")
    
    print("\n[POR TIMING]")
    for key in ['EARLY', 'MID', 'LATE']:
        c = results[key]['correct']
        w = results[key]['wrong']
        t = c + w
        if t > 0:
            acc = c / t * 100
            print(f"   {key}: {c}/{t} = {acc:.1f}%")
    
    print("\n[POR DIRECCION DEL VOTO]")
    for key in ['UP_vote', 'DOWN_vote']:
        c = results[key]['correct']
        w = results[key]['wrong']
        t = c + w
        if t > 0:
            acc = c / t * 100
            label = key.replace('_vote', '')
            print(f"   Votos {label}: {c}/{t} = {acc:.1f}%")
    
    print("\n[POR REGIMEN]")
    for key in ['TREND_UP', 'TREND_DOWN']:
        c = results[key]['correct']
        w = results[key]['wrong']
        t = c + w
        if t > 0:
            acc = c / t * 100
            print(f"   {key}: {c}/{t} = {acc:.1f}%")
    
    # Comparacion con datos anteriores
    print("\n" + "=" * 80)
    print("COMPARACION CON DATOS ANTERIORES")
    print("=" * 80)
    print("""
    METRICA              ANTES (45h)    AHORA
    ----------------------------------------
    Precision Global     44.68%         {:.2f}%
    STRONG               36.7%          {:.1f}%
    GOOD                 62.5%          {:.1f}%
    Votos UP             36.5%          {:.1f}%
    Votos DOWN           51.3%          {:.1f}%
    """.format(
        accuracy,
        results['STRONG']['correct'] / max(1, results['STRONG']['correct'] + results['STRONG']['wrong']) * 100,
        results['GOOD']['correct'] / max(1, results['GOOD']['correct'] + results['GOOD']['wrong']) * 100,
        results['UP_vote']['correct'] / max(1, results['UP_vote']['correct'] + results['UP_vote']['wrong']) * 100,
        results['DOWN_vote']['correct'] / max(1, results['DOWN_vote']['correct'] + results['DOWN_vote']['wrong']) * 100
    ))
    
    # Evaluacion
    print("=" * 80)
    if accuracy >= 60:
        print("[VERDE] MEJORA SIGNIFICATIVA - Sistema rentable")
    elif accuracy >= 55:
        print("[VERDE-AMARILLO] MEJORA - Sistema con edge positivo")
    elif accuracy >= 50:
        print("[AMARILLO] MEJORA MARGINAL - Necesita mas ajustes")
    elif accuracy > 44.68:
        print("[AMARILLO] PEQUENA MEJORA vs anterior (44.68%)")
    else:
        print("[ROJO] SIN MEJORA - Revisar cambios")
    print("=" * 80)

if __name__ == "__main__":
    main()
