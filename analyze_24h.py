#!/usr/bin/env python3
"""
Analisis completo de 24+ horas de datos del bot Polymarket BTC 15m
"""

import pandas as pd
import sqlite3
import requests
from datetime import datetime
from collections import defaultdict
import os

# Configuracion
SYMBOL = "BTCUSDT"
BINANCE_URL = "https://api.binance.com/api/v3/klines"
SIGNAL_FILE = "signals (1).csv"
DB_FILE = "backtest.db"

def load_signals():
    """Cargar archivo de senales"""
    df = pd.read_csv(SIGNAL_FILE)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    return df

def load_database():
    """Cargar datos de la base de datos SQLite"""
    if not os.path.exists(DB_FILE):
        return None, None, None
    
    conn = sqlite3.connect(DB_FILE)
    
    try:
        snapshots = pd.read_sql_query("SELECT * FROM snapshots", conn)
        snapshots['timestamp'] = pd.to_datetime(snapshots['timestamp'])
    except:
        snapshots = None
    
    try:
        outcomes = pd.read_sql_query("SELECT * FROM market_outcomes", conn)
    except:
        outcomes = None
    
    try:
        trades = pd.read_sql_query("SELECT * FROM simulated_trades", conn)
    except:
        trades = None
    
    conn.close()
    return snapshots, outcomes, trades

def get_window_start(ts):
    """Obtener inicio de ventana de 15 minutos"""
    ts_ms = int(ts.timestamp() * 1000)
    window_size = 15 * 60 * 1000
    return ts_ms - (ts_ms % window_size)

def group_signals_by_window(df):
    """Agrupar senales por ventanas de 15 minutos"""
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
    """Obtener velas de Binance (en bloques si es necesario)"""
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
            print(f"Error Binance: {response.status_code}")
            break
        
        data = response.json()
        if not data:
            break
        
        for k in data:
            open_time = int(k[0])
            all_klines[open_time] = {
                'open': float(k[1]),
                'high': float(k[2]),
                'low': float(k[3]),
                'close': float(k[4]),
                'volume': float(k[5]),
                'result': 'UP' if float(k[4]) > float(k[1]) else 'DOWN'
            }
        
        current_start = max(all_klines.keys()) + 15 * 60 * 1000
    
    return all_klines

def determine_vote(signals):
    """Determinar voto por mayoria"""
    up_count = 0
    down_count = 0
    
    for s in signals:
        if 'UP' in s['signal']:
            up_count += 1
        elif 'DOWN' in s['signal']:
            down_count += 1
    
    if up_count > down_count:
        return 'UP'
    elif down_count > up_count:
        return 'DOWN'
    return 'NEUTRAL'

def analyze_signals(df, klines):
    """Analisis principal de senales"""
    windows = group_signals_by_window(df)
    active_windows = {k: v for k, v in windows.items() if len(v) > 0}
    
    results = {
        'total': {'correct': 0, 'wrong': 0, 'details': []},
        'STRONG': {'correct': 0, 'wrong': 0},
        'GOOD': {'correct': 0, 'wrong': 0},
        'EARLY': {'correct': 0, 'wrong': 0},
        'MID': {'correct': 0, 'wrong': 0},
        'LATE': {'correct': 0, 'wrong': 0},
        'TREND_UP': {'correct': 0, 'wrong': 0},
        'TREND_DOWN': {'correct': 0, 'wrong': 0},
        'RANGE': {'correct': 0, 'wrong': 0},
        'CHOP': {'correct': 0, 'wrong': 0},
        'UP_vote': {'correct': 0, 'wrong': 0},
        'DOWN_vote': {'correct': 0, 'wrong': 0},
        'by_hour': defaultdict(lambda: {'correct': 0, 'wrong': 0})
    }
    
    for window_start in sorted(active_windows.keys()):
        kline = klines.get(window_start)
        if not kline:
            continue
        
        signals = active_windows[window_start]
        vote = determine_vote(signals)
        
        if vote == 'NEUTRAL':
            continue
        
        is_correct = vote == kline['result']
        hour = datetime.utcfromtimestamp(window_start / 1000).hour
        
        results['total']['details'].append({
            'time': window_start,
            'vote': vote,
            'result': kline['result'],
            'correct': is_correct,
            'open': kline['open'],
            'close': kline['close']
        })
        
        if is_correct:
            results['total']['correct'] += 1
        else:
            results['total']['wrong'] += 1
        
        # Por tipo de voto
        if vote == 'UP':
            if is_correct:
                results['UP_vote']['correct'] += 1
            else:
                results['UP_vote']['wrong'] += 1
        else:
            if is_correct:
                results['DOWN_vote']['correct'] += 1
            else:
                results['DOWN_vote']['wrong'] += 1
        
        # Por hora
        if is_correct:
            results['by_hour'][hour]['correct'] += 1
        else:
            results['by_hour'][hour]['wrong'] += 1
        
        # Categorizar por tipo de senal
        for s in signals:
            rec = s['rec']
            regime = s.get('regime', 'UNKNOWN')
            
            # Por fuerza
            if 'STRONG' in rec:
                key = 'STRONG'
            elif 'GOOD' in rec:
                key = 'GOOD'
            else:
                continue
            
            if is_correct:
                results[key]['correct'] += 1
            else:
                results[key]['wrong'] += 1
            
            # Por timing
            if 'EARLY' in rec:
                timing = 'EARLY'
            elif 'MID' in rec:
                timing = 'MID'
            elif 'LATE' in rec:
                timing = 'LATE'
            else:
                continue
            
            if is_correct:
                results[timing]['correct'] += 1
            else:
                results[timing]['wrong'] += 1
            
            # Por regimen
            if regime in results:
                if is_correct:
                    results[regime]['correct'] += 1
                else:
                    results[regime]['wrong'] += 1
    
    return results

def print_results(results, df):
    """Imprimir resultados"""
    print("=" * 80)
    print("ANALISIS COMPLETO - Bot Polymarket BTC 15m (24+ horas)")
    print("=" * 80)
    
    start_time = df['timestamp'].min()
    end_time = df['timestamp'].max()
    duration = end_time - start_time
    
    print(f"\n[PERIODO] {start_time} -> {end_time}")
    print(f"[DURACION] {duration}")
    print(f"[TOTAL REGISTROS] {len(df):,}")
    
    # Distribucion de senales
    print("\n" + "-" * 80)
    print("DISTRIBUCION DE SENALES")
    print("-" * 80)
    
    signal_counts = df['signal'].value_counts()
    for sig, count in signal_counts.items():
        pct = count / len(df) * 100
        print(f"   {sig}: {count:,} ({pct:.1f}%)")
    
    # Distribucion de recomendaciones
    print("\n[TOP 15 RECOMENDACIONES]")
    rec_counts = df['recommendation'].value_counts()
    for rec, count in list(rec_counts.items())[:15]:
        print(f"   {rec}: {count:,}")
    
    # Resultados principales
    print("\n" + "=" * 80)
    print("RESULTADOS DE PRECISION")
    print("=" * 80)
    
    total = results['total']['correct'] + results['total']['wrong']
    if total > 0:
        accuracy = results['total']['correct'] / total * 100
        print(f"\n>>> PRECISION GLOBAL: {results['total']['correct']}/{total} = {accuracy:.2f}% <<<")
    
    # Por fuerza de senal
    print("\n[POR FUERZA DE SENAL]")
    for key in ['STRONG', 'GOOD']:
        c = results[key]['correct']
        w = results[key]['wrong']
        t = c + w
        if t > 0:
            acc = c / t * 100
            print(f"   {key}: {c}/{t} = {acc:.1f}%")
    
    # Por timing
    print("\n[POR TIMING DE ENTRADA]")
    for key in ['EARLY', 'MID', 'LATE']:
        c = results[key]['correct']
        w = results[key]['wrong']
        t = c + w
        if t > 0:
            acc = c / t * 100
            print(f"   {key}: {c}/{t} = {acc:.1f}%")
    
    # Por regimen
    print("\n[POR REGIMEN DE MERCADO]")
    for key in ['TREND_UP', 'TREND_DOWN', 'RANGE', 'CHOP']:
        c = results[key]['correct']
        w = results[key]['wrong']
        t = c + w
        if t > 0:
            acc = c / t * 100
            print(f"   {key}: {c}/{t} = {acc:.1f}%")
    
    # Por direccion del voto
    print("\n[POR DIRECCION DEL VOTO]")
    for key in ['UP_vote', 'DOWN_vote']:
        c = results[key]['correct']
        w = results[key]['wrong']
        t = c + w
        if t > 0:
            acc = c / t * 100
            label = key.replace('_vote', '')
            print(f"   Votos {label}: {c}/{t} = {acc:.1f}%")
    
    # Por hora del dia (UTC)
    print("\n[POR HORA DEL DIA (UTC)]")
    hour_data = []
    for hour in sorted(results['by_hour'].keys()):
        c = results['by_hour'][hour]['correct']
        w = results['by_hour'][hour]['wrong']
        t = c + w
        if t > 0:
            acc = c / t * 100
            hour_data.append((hour, c, t, acc))
            bar = "#" * int(acc / 5)
            print(f"   {hour:02d}:00 UTC: {c}/{t} ({acc:5.1f}%) {bar}")
    
    # Rachas
    print("\n[RACHAS]")
    details = results['total']['details']
    max_win = max_lose = current_win = current_lose = 0
    
    for d in details:
        if d['correct']:
            current_win += 1
            current_lose = 0
            max_win = max(max_win, current_win)
        else:
            current_lose += 1
            current_win = 0
            max_lose = max(max_lose, current_lose)
    
    print(f"   Mejor racha ganadora: {max_win}")
    print(f"   Peor racha perdedora: {max_lose}")
    
    # Ultimos 20 resultados
    print("\n[ULTIMOS 20 INTERVALOS]")
    print(f"{'Hora UTC':<10} | {'Voto':<6} | {'Real':<6} | {'Open':>12} | {'Close':>12} | OK?")
    print("-" * 65)
    
    for d in details[-20:]:
        time_str = datetime.utcfromtimestamp(d['time'] / 1000).strftime("%H:%M")
        icon = "[OK]" if d['correct'] else "[X]"
        print(f"{time_str:<10} | {d['vote']:<6} | {d['result']:<6} | {d['open']:>12.2f} | {d['close']:>12.2f} | {icon}")
    
    # Evaluacion final
    print("\n" + "=" * 80)
    if total > 0:
        if accuracy >= 60:
            print("[VERDE] SISTEMA RENTABLE - Precision > 60%")
        elif accuracy >= 55:
            print("[VERDE-AMARILLO] SISTEMA CON EDGE - Precision 55-60%")
        elif accuracy >= 50:
            print("[AMARILLO] SISTEMA MARGINAL - Precision 50-55%")
        else:
            print("[ROJO] SISTEMA NO RENTABLE - Precision < 50%")
    print("=" * 80)
    
    return accuracy if total > 0 else 0

def analyze_database(snapshots, outcomes, trades):
    """Analizar datos de la base de datos"""
    print("\n" + "=" * 80)
    print("ANALISIS DE BASE DE DATOS (backtest.db)")
    print("=" * 80)
    
    if outcomes is not None and len(outcomes) > 0:
        print(f"\n[MARKET OUTCOMES] {len(outcomes)} mercados resueltos")
        
        if 'outcome' in outcomes.columns:
            outcome_counts = outcomes['outcome'].value_counts()
            print("   Resultados:")
            for outcome, count in outcome_counts.items():
                print(f"      {outcome}: {count}")
    
    if trades is not None and len(trades) > 0:
        print(f"\n[SIMULATED TRADES] {len(trades)} trades simulados")
        
        if 'outcome' in trades.columns:
            trade_outcomes = trades['outcome'].value_counts()
            print("   Resultados de trades:")
            for outcome, count in trade_outcomes.items():
                print(f"      {outcome}: {count}")
        
        if 'pnl' in trades.columns:
            total_pnl = trades['pnl'].sum()
            avg_pnl = trades['pnl'].mean()
            print(f"   PnL Total: {total_pnl:.4f}")
            print(f"   PnL Promedio: {avg_pnl:.4f}")
        
        if 'side' in trades.columns:
            side_counts = trades['side'].value_counts()
            print("   Por lado:")
            for side, count in side_counts.items():
                print(f"      {side}: {count}")
    
    if snapshots is not None and len(snapshots) > 0:
        print(f"\n[SNAPSHOTS] {len(snapshots):,} snapshots guardados")

def main():
    print("Cargando datos...")
    
    # Cargar senales
    df = load_signals()
    print(f"   Senales cargadas: {len(df):,}")
    
    # Cargar database
    snapshots, outcomes, trades = load_database()
    
    # Agrupar por ventanas
    windows = group_signals_by_window(df)
    active_windows = {k: v for k, v in windows.items() if len(v) > 0}
    print(f"   Ventanas activas (STRONG/GOOD): {len(active_windows)}")
    
    if len(active_windows) == 0:
        print("No hay senales accionables!")
        return
    
    # Obtener precios de Binance
    sorted_windows = sorted(active_windows.keys())
    fetch_start = sorted_windows[0]
    fetch_end = sorted_windows[-1] + (15 * 60 * 1000)
    
    print(f"   Obteniendo precios de Binance...")
    klines = fetch_binance_klines(fetch_start, fetch_end)
    print(f"   Velas obtenidas: {len(klines)}")
    
    # Analizar
    results = analyze_signals(df, klines)
    
    # Imprimir resultados
    accuracy = print_results(results, df)
    
    # Analizar database
    analyze_database(snapshots, outcomes, trades)
    
    return accuracy

if __name__ == "__main__":
    main()
