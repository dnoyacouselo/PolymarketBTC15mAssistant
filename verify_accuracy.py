#!/usr/bin/env python3
"""
Verificacion de eficacia del bot de senales de Polymarket BTC 15m
Compara las senales generadas con los precios reales de Binance
"""

import pandas as pd
import requests
from datetime import datetime
from collections import defaultdict

# Configuracion
SYMBOL = "BTCUSDT"
BINANCE_URL = "https://api.binance.com/api/v3/klines"
SIGNAL_FILE = "signals.csv"

def load_signals():
    """Cargar y procesar el archivo de senales"""
    df = pd.read_csv(SIGNAL_FILE)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    return df

def get_window_start(ts):
    """Obtener el inicio de la ventana de 15 minutos para un timestamp"""
    # Binance 15m candles empiezan en :00, :15, :30, :45
    ts_ms = int(ts.timestamp() * 1000)
    window_size = 15 * 60 * 1000
    return ts_ms - (ts_ms % window_size)

def group_signals_by_window(df):
    """Agrupar senales por ventanas de 15 minutos, solo las accionables"""
    windows = defaultdict(list)
    
    for _, row in df.iterrows():
        rec = str(row['recommendation'])
        # Solo senales STRONG o GOOD
        if 'STRONG' in rec or 'GOOD' in rec:
            window_start = get_window_start(row['timestamp'])
            windows[window_start].append({
                'signal': row['signal'],
                'rec': rec,
                'model_up': row['model_up'],
                'model_down': row['model_down'],
                'edge_up': row['edge_up']
            })
    
    return windows

def fetch_binance_klines(start_time, end_time):
    """Obtener velas de 15m de Binance"""
    params = {
        'symbol': SYMBOL,
        'interval': '15m',
        'startTime': start_time,
        'endTime': end_time,
        'limit': 1000
    }
    
    response = requests.get(BINANCE_URL, params=params)
    if response.status_code != 200:
        raise Exception(f"Error Binance: {response.status_code}")
    
    data = response.json()
    klines = {}
    
    for k in data:
        open_time = int(k[0])
        open_price = float(k[1])
        close_price = float(k[4])
        klines[open_time] = {
            'open': open_price,
            'close': close_price,
            'result': 'UP' if close_price > open_price else 'DOWN'
        }
    
    return klines

def determine_vote(signals):
    """Determinar el voto del bot basado en mayoria de senales"""
    up_count = 0
    down_count = 0
    
    for s in signals:
        sig = s['signal']
        if 'UP' in sig:
            up_count += 1
        elif 'DOWN' in sig:
            down_count += 1
    
    if up_count > down_count:
        return 'UP'
    elif down_count > up_count:
        return 'DOWN'
    return 'NEUTRAL'

def analyze_by_recommendation_type(windows, klines):
    """Analisis detallado por tipo de recomendacion"""
    stats = {
        'STRONG': {'correct': 0, 'wrong': 0},
        'GOOD': {'correct': 0, 'wrong': 0},
        'EARLY': {'correct': 0, 'wrong': 0},
        'MID': {'correct': 0, 'wrong': 0},
        'LATE': {'correct': 0, 'wrong': 0}
    }
    
    for window_start, signals in windows.items():
        kline = klines.get(window_start)
        if not kline:
            continue
        
        vote = determine_vote(signals)
        if vote == 'NEUTRAL':
            continue
        
        is_correct = vote == kline['result']
        
        # Categorizar por tipo
        for s in signals:
            rec = s['rec']
            if 'STRONG' in rec:
                key = 'STRONG'
            elif 'GOOD' in rec:
                key = 'GOOD'
            else:
                continue
            
            if is_correct:
                stats[key]['correct'] += 1
            else:
                stats[key]['wrong'] += 1
            
            # Tambien por timing
            if 'EARLY' in rec:
                timing = 'EARLY'
            elif 'MID' in rec:
                timing = 'MID'
            elif 'LATE' in rec:
                timing = 'LATE'
            else:
                continue
            
            if is_correct:
                stats[timing]['correct'] += 1
            else:
                stats[timing]['wrong'] += 1
    
    return stats

def main():
    print("=" * 70)
    print("VERIFICACION DE EFICACIA - Bot Polymarket BTC 15m")
    print("=" * 70)
    
    # 1. Cargar senales
    print("\n[INFO] Cargando senales...")
    df = load_signals()
    
    start_time = df['timestamp'].min()
    end_time = df['timestamp'].max()
    duration = end_time - start_time
    
    print(f"   Periodo: {start_time} -> {end_time}")
    print(f"   Duracion: {duration}")
    print(f"   Total registros: {len(df):,}")
    
    # 2. Estadisticas basicas
    print("\n[STATS] Distribucion de senales:")
    signal_counts = df['signal'].value_counts()
    for sig, count in signal_counts.items():
        print(f"   {sig}: {count:,}")
    
    print("\n[STATS] Distribucion de recomendaciones (top 10):")
    rec_counts = df['recommendation'].value_counts()
    for rec, count in list(rec_counts.items())[:10]:
        print(f"   {rec}: {count:,}")
    
    # 3. Agrupar por ventanas
    print("\n[INFO] Agrupando senales por ventanas de 15 minutos...")
    windows = group_signals_by_window(df)
    active_windows = {k: v for k, v in windows.items() if len(v) > 0}
    print(f"   Ventanas con senales accionables (STRONG/GOOD): {len(active_windows)}")
    
    if len(active_windows) == 0:
        print("\n[WARN] No se encontraron senales accionables (STRONG o GOOD)")
        return
    
    # 4. Obtener precios de Binance
    sorted_windows = sorted(active_windows.keys())
    fetch_start = sorted_windows[0]
    fetch_end = sorted_windows[-1] + (15 * 60 * 1000)
    
    print(f"\n[INFO] Obteniendo precios de Binance...")
    print(f"   Desde: {datetime.fromtimestamp(fetch_start/1000)}")
    print(f"   Hasta: {datetime.fromtimestamp(fetch_end/1000)}")
    
    klines = fetch_binance_klines(fetch_start, fetch_end)
    print(f"   Velas obtenidas: {len(klines)}")
    
    # 5. Comparar predicciones vs realidad
    print("\n" + "=" * 70)
    print("RESULTADOS DE VERIFICACION")
    print("=" * 70)
    print(f"\n{'Hora (UTC)':<12} | {'Voto':<6} | {'Real':<6} | {'Open':>12} | {'Close':>12} | {'OK?'}")
    print("-" * 70)
    
    correct = 0
    wrong = 0
    total = 0
    results_detail = []
    
    for window_start in sorted_windows:
        kline = klines.get(window_start)
        if not kline:
            continue
        
        signals = active_windows[window_start]
        vote = determine_vote(signals)
        
        if vote == 'NEUTRAL':
            continue
        
        is_correct = vote == kline['result']
        icon = "[OK]" if is_correct else "[X]"
        
        time_str = datetime.utcfromtimestamp(window_start / 1000).strftime("%H:%M")
        
        print(f"{time_str:<12} | {vote:<6} | {kline['result']:<6} | {kline['open']:>12.2f} | {kline['close']:>12.2f} | {icon}")
        
        results_detail.append({
            'time': time_str,
            'vote': vote,
            'result': kline['result'],
            'correct': is_correct,
            'num_signals': len(signals)
        })
        
        if is_correct:
            correct += 1
        else:
            wrong += 1
        total += 1
    
    # 6. Resumen
    print("-" * 70)
    print(f"\n[RESUMEN] EFICACIA:")
    print(f"   Total intervalos verificados: {total}")
    print(f"   [OK] Correctos: {correct}")
    print(f"   [X]  Incorrectos: {wrong}")
    
    if total > 0:
        accuracy = (correct / total) * 100
        print(f"\n   >>> PRECISION: {accuracy:.2f}% <<<")
        
        # Analisis adicional
        print(f"\n[DETALLE] ANALISIS POR TIPO:")
        
        # Por tipo de recomendacion
        stats = analyze_by_recommendation_type(active_windows, klines)
        
        print(f"\n   Por calidad de senal:")
        for key in ['STRONG', 'GOOD']:
            c = stats[key]['correct']
            w = stats[key]['wrong']
            t = c + w
            if t > 0:
                acc = (c / t) * 100
                print(f"   - {key}: {c}/{t} correctos ({acc:.1f}%)")
        
        print(f"\n   Por timing de entrada:")
        for key in ['EARLY', 'MID', 'LATE']:
            c = stats[key]['correct']
            w = stats[key]['wrong']
            t = c + w
            if t > 0:
                acc = (c / t) * 100
                print(f"   - {key}: {c}/{t} correctos ({acc:.1f}%)")
        
        # Racha mas larga
        max_winning_streak = 0
        max_losing_streak = 0
        current_winning = 0
        current_losing = 0
        
        for r in results_detail:
            if r['correct']:
                current_winning += 1
                current_losing = 0
                max_winning_streak = max(max_winning_streak, current_winning)
            else:
                current_losing += 1
                current_winning = 0
                max_losing_streak = max(max_losing_streak, current_losing)
        
        print(f"\n   Rachas:")
        print(f"   - Mejor racha ganadora: {max_winning_streak} seguidos")
        print(f"   - Peor racha perdedora: {max_losing_streak} seguidos")
        
        # Evaluacion final
        print(f"\n" + "=" * 70)
        if accuracy >= 60:
            print("[VERDE] EVALUACION: SISTEMA RENTABLE")
            print("   Con >55% de precision el sistema tiene edge positivo.")
        elif accuracy >= 50:
            print("[AMARILLO] EVALUACION: SISTEMA MARGINAL")
            print("   Cercano al 50%, necesita optimizacion.")
        else:
            print("[ROJO] EVALUACION: SISTEMA NO RENTABLE")
            print("   Por debajo del 50%, revisar estrategia.")
        print("=" * 70)

if __name__ == "__main__":
    main()
