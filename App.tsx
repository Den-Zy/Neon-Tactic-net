
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { GameState, Point, Unit, GRID_WIDTH, GRID_HEIGHT, VisualEffect } from './types';
import { createInitialState, calculateVisibility, canMoveTo, canAttack, findNextStepTowards, getDistance, findPath, isLineOfSightClear } from './gameEngine';
import CanvasBoard from './components/CanvasBoard';
import { sounds } from './services/soundService';

interface SavedBattle {
  id: string;
  name: string;
  timestamp: number;
  history: GameState[];
  result: 'WIN' | 'LOSS' | 'IN_PROGRESS';
}

type SightsMode = 'off' | 'sector' | 'full';

const App: React.FC = () => {
  const [state, setState] = useState<GameState>(() => createInitialState());
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 420);

  const [historyStates, setHistoryStates] = useState<GameState[]>([]);
  const [savedBattles, setSavedBattles] = useState<SavedBattle[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [hasSavedCurrent, setHasSavedCurrent] = useState(false);
  
  const [sightsMode, setSightsMode] = useState<SightsMode>('off');
  const [isGrenadeMode, setIsGrenadeMode] = useState(false);

  const playbackTimerRef = useRef<number | null>(null);

  const playerWin = state.units.length > 0 && state.units.filter(u => u.team === 'enemy' && u.hp > 0).length === 0;
  const enemyWin = state.units.length > 0 && state.units.filter(u => u.team === 'player' && u.hp > 0).length === 0;

  useEffect(() => {
    const initial = createInitialState();
    setState(initial);
    setHistoryStates([JSON.parse(JSON.stringify(initial))]);
    loadSavedBattles();

    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const loadSavedBattles = () => {
    const data = localStorage.getItem('neon_tactical_saves');
    if (data) {
      try {
        setSavedBattles(JSON.parse(data));
      } catch (e) {
        console.error("Failed to load saves", e);
      }
    }
  };

  const saveBattleToStorage = (result: 'WIN' | 'LOSS') => {
    if (hasSavedCurrent) return;
    const newSave: SavedBattle = {
      id: `mission_${Date.now()}`,
      name: `OP-${Math.floor(Math.random() * 900) + 100}`,
      timestamp: Date.now(),
      history: historyStates,
      result: result
    };
    const updatedSaves = [newSave, ...savedBattles].slice(0, 20);
    setSavedBattles(updatedSaves);
    localStorage.setItem('neon_tactical_saves', JSON.stringify(updatedSaves));
    setHasSavedCurrent(true);
  };

  useEffect(() => {
    if (playerWin) saveBattleToStorage('WIN');
    else if (enemyWin) saveBattleToStorage('LOSS');
  }, [playerWin, enemyWin]);

  const recordState = (newState: GameState) => {
    if (isReplaying) return;
    setHistoryStates(prev => [...prev, JSON.parse(JSON.stringify(newState))]);
  };

  useEffect(() => {
    if (!isReplaying || replayIndex === 0) return;
    const current = historyStates[replayIndex];
    const prev = historyStates[replayIndex - 1];
    
    if (current.turn !== prev.turn) sounds.playSiren();
    
    // Check movement
    let moved = false;
    current.units.forEach(u => {
      const pUnit = prev.units.find(pu => pu.id === u.id);
      if (pUnit && (pUnit.x !== u.x || pUnit.y !== u.y)) moved = true;
    });
    if (moved) sounds.playMove();
    
    // Check combat audio triggers
    let hit = false;
    let destroyed = false;
    
    // 1. Units hit detection
    current.units.forEach(u => {
      const pUnit = prev.units.find(pu => pu.id === u.id);
      if (pUnit && u.hp < pUnit.hp) {
          hit = true;
          if (u.hp <= 0) destroyed = true;
      }
    });

    // 2. Obstacles hit detection
    Object.keys(prev.obstacleHp).forEach(key => {
        const prevHp = prev.obstacleHp[key] || 0;
        const currHp = current.obstacleHp[key] === undefined ? 0 : current.obstacleHp[key];
        if (currHp < prevHp) {
            hit = true;
            if (currHp <= 0) destroyed = true;
        }
    });

    // CRITICAL FIX: Detect attack by checking for NEW visual effect IDs
    // This is much more reliable than length checks as effects are cleared by a timer.
    const prevEffectIds = new Set(prev.visualEffects.map(fx => fx.id));
    const newAttackEffects = current.visualEffects.filter(fx => fx.type === 'attack' && !prevEffectIds.has(fx.id));
    
    if (newAttackEffects.length > 0) {
        newAttackEffects.forEach(() => sounds.playAttack());
    }
    
    // Detect impact with slight delay for synchronization
    if (hit) {
        setTimeout(() => {
            if (destroyed) sounds.playBreak();
            else sounds.playHit();
        }, 250);
    }
  }, [replayIndex, isReplaying, historyStates]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setState(prev => {
        const remainingEffects = prev.visualEffects.filter(fx => now - fx.startTime < fx.duration);
        
        const finalizedUnits = prev.units.filter(u => {
          if (u.hp > 0) return true;
          return remainingEffects.some(fx => fx.to.x === u.x && fx.to.y === u.y);
        });

        const finalizedObstacles = prev.obstacles.filter(o => {
          const hp = prev.obstacleHp[`${o.x},${o.y}`] ?? 0;
          if (hp > 0) return true;
          return remainingEffects.some(fx => fx.to.x === o.x && fx.to.y === o.y);
        });

        const finalizedObstacleHp = { ...prev.obstacleHp };
        Object.keys(finalizedObstacleHp).forEach(key => {
            const [x, y] = key.split(',').map(Number);
            if (!finalizedObstacles.some(o => o.x === x && o.y === y)) {
                delete finalizedObstacleHp[key];
            }
        });

        if (
          remainingEffects.length === prev.visualEffects.length && 
          finalizedUnits.length === prev.units.length &&
          finalizedObstacles.length === prev.obstacles.length
        ) return prev;

        return { 
            ...prev, 
            units: finalizedUnits, 
            obstacles: finalizedObstacles,
            obstacleHp: finalizedObstacleHp,
            visualEffects: remainingEffects 
        };
      });
    }, 50); 
    return () => clearInterval(timer);
  }, []);

  const tileSize = useMemo(() => {
    const targetWidth = windowWidth - 28;
    return Math.floor(targetWidth / GRID_WIDTH);
  }, [windowWidth]);

  const isInFireSector = (unit: Unit, target: Point) => {
    const dx = target.x - unit.x;
    const dy = target.y - unit.y;
    if (dx === 0 && dy === 0) return false;
    switch (unit.facing) {
      case 'up': return dy < 0 && Math.abs(dx) <= Math.abs(dy);
      case 'down': return dy > 0 && Math.abs(dx) <= Math.abs(dy);
      case 'left': return dx < 0 && Math.abs(dy) <= Math.abs(dx);
      case 'right': return dx > 0 && Math.abs(dy) <= Math.abs(dx);
      default: return false;
    }
  };

  const aimTiles = useMemo(() => {
    const selected = state.units.find(u => u.id === state.selectedUnitId);
    if (sightsMode === 'off' || isGrenadeMode || !selected || selected.hp <= 0) return [];
    
    const expandedSet = new Set<string>();
    const origin = { x: selected.x, y: selected.y };
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const p = { x, y };
        const dist = getDistance(origin, p);
        if (dist >= 1 && dist <= selected.range && !state.fogOfWar[y][x]) {
          const matchesSector = sightsMode === 'full' || isInFireSector(selected, p);
          if (matchesSector && isLineOfSightClear(origin, p, state.obstacles)) {
            expandedSet.add(`${x},${y}`);
          }
        }
      }
    }
    return Array.from(expandedSet).map(s => {
      const [nx, ny] = s.split(',').map(Number);
      return { x: nx, y: ny };
    });
  }, [sightsMode, isGrenadeMode, state.selectedUnitId, state.units, state.fogOfWar, state.obstacles]);

  const handleUnitClick = (unit: Unit) => {
    if (state.isAITurn || unit.hp <= 0 || isReplaying) return;
    if (unit.team === 'player') {
      setState(prev => ({ ...prev, selectedUnitId: unit.id, isGrenadeMode: false }));
    } else {
      const selected = state.units.find(u => u.id === state.selectedUnitId);
      if (selected && selected.ap > 0 && canAttack(selected, unit, state.obstacles)) performAttack(selected, unit);
    }
  };

  const handleRotateUnit = (unitId: string, facing: Unit['facing']) => {
    if (state.isAITurn || isReplaying) return;
    setState(prev => {
      const newUnits = prev.units.map(u => u.id === unitId ? { ...u, facing } : u);
      const { fog, visited } = calculateVisibility(newUnits, prev.visitedTiles);
      const nextState = { ...prev, units: newUnits, fogOfWar: fog, visitedTiles: visited };
      recordState(nextState);
      return nextState;
    });
    sounds.playMove();
  };

  const performAttack = (attacker: Unit, target: Unit) => {
    sounds.playAttack();
    const effectDuration = 350;
    const now = Date.now();
    const attackEffect: VisualEffect = { id: Math.random().toString(), type: 'attack', from: { x: attacker.x, y: attacker.y }, to: { x: target.x, y: target.y }, color: attacker.team === 'player' ? '#4ade80' : '#f87171', startTime: now, duration: effectDuration };
    const hitEffect: VisualEffect = { id: Math.random().toString(), type: 'hit', from: { x: attacker.x, y: attacker.y }, to: { x: target.x, y: target.y }, color: '#ffffff', startTime: now + effectDuration - 50, duration: 300 };
    setState(prev => {
      const newUnits = prev.units.map(u => {
        if (u.id === target.id) return { ...u, hp: Math.max(0, u.hp - 1) };
        if (u.id === attacker.id) return { ...u, ap: Math.max(0, u.ap - 1) };
        return u;
      });
      const { fog, visited } = calculateVisibility(newUnits, prev.visitedTiles);
      const nextState = { ...prev, units: newUnits, fogOfWar: fog, visitedTiles: visited, visualEffects: [...prev.visualEffects, attackEffect, hitEffect] };
      setTimeout(() => {
          const u = nextState.units.find(unit => unit.id === target.id);
          if (u && u.hp <= 0) sounds.playBreak();
          else sounds.playHit();
      }, effectDuration);
      recordState(nextState);
      return nextState;
    });
  };

  const performObstacleAttack = (attacker: Unit, pos: Point) => {
    if (attacker.grenades <= 0 || attacker.ap <= 0) return;
    sounds.playAttack();
    const effectDuration = 350;
    const now = Date.now();
    const attackEffect: VisualEffect = { id: Math.random().toString(), type: 'attack', from: { x: attacker.x, y: attacker.y }, to: pos, color: '#facc15', startTime: now, duration: effectDuration };
    const hitEffect: VisualEffect = { id: Math.random().toString(), type: 'hit', from: { x: attacker.x, y: attacker.y }, to: pos, color: '#ffffff', startTime: now + effectDuration - 50, duration: 300 };
    
    setState(prev => {
      const key = `${pos.x},${pos.y}`;
      const newHp = Math.max(0, (prev.obstacleHp[key] || 0) - 1);
      const newObstacleHp = { ...prev.obstacleHp, [key]: newHp };
      
      const newUnits = prev.units.map(u => u.id === attacker.id ? { ...u, ap: u.ap - 1, grenades: u.grenades - 1 } : u);
      const { fog, visited } = calculateVisibility(newUnits, prev.visitedTiles);
      
      const nextState = { 
          ...prev, 
          units: newUnits, 
          obstacleHp: newObstacleHp, 
          fogOfWar: fog, 
          visitedTiles: visited, 
          visualEffects: [...prev.visualEffects, attackEffect, hitEffect] 
      };
      
      setTimeout(() => {
          if (newHp <= 0) sounds.playBreak();
          else sounds.playHit();
      }, effectDuration);
      recordState(nextState);
      return nextState;
    });
  };

  const useCombatAction = (index: number) => {
    if (state.isAITurn || isReplaying || !state.selectedUnitId) return;
    if (index === 4) { // Sights
      setSightsMode(prev => prev === 'off' ? 'sector' : prev === 'sector' ? 'full' : 'off');
      setIsGrenadeMode(false);
      sounds.playMove();
      return;
    }
    if (index === 3) { // Grenade Mode toggle
      setIsGrenadeMode(prev => !prev);
      setSightsMode('off');
      sounds.playMove();
      return;
    }
    
    const key = (['walls', 'stealth', 'traps'] as (keyof Unit)[])[index];
    const unit = state.units.find(u => u.id === state.selectedUnitId);
    if (unit && unit[key] as number > 0) {
      sounds.playAttack();
      setState(prev => {
        const newUnits = prev.units.map(u => u.id === prev.selectedUnitId ? { ...u, [key]: (u[key] as number) - 1 } : u);
        const nextState = { ...prev, units: newUnits };
        recordState(nextState);
        return nextState;
      });
    }
  };

  const handleTileClick = (p: Point) => {
    if (state.isAITurn || state.turn !== 'player' || isReplaying) return;
    const selected = state.units.find(u => u.id === state.selectedUnitId);
    if (!selected || selected.hp <= 0) return;

    if (isGrenadeMode) {
      const isObstacle = state.obstacles.some(o => o.x === p.x && o.y === p.y);
      if (isObstacle) {
        const dist = getDistance({ x: selected.x, y: selected.y }, p);
        if (dist <= selected.range && isLineOfSightClear({ x: selected.x, y: selected.y }, p, state.obstacles)) {
          performObstacleAttack(selected, p);
          return;
        }
      }
    }

    if (selected.ap <= 0) return;
    const path = findPath(state, selected, p);
    if (path && path.length > 0 && path.length <= selected.ap) {
      sounds.playMove(); 
      setState(prev => {
        const newUnits: Unit[] = prev.units.map(u => {
          if (u.id === selected.id) {
            const lastStep = p;
            const prevStep = path.length > 1 ? path[path.length - 2] : { x: selected.x, y: selected.y };
            const fdx = lastStep.x - prevStep.x, fdy = lastStep.y - prevStep.y;
            let facing: Unit['facing'] = u.facing;
            if (Math.abs(fdx) > Math.abs(fdy)) facing = fdx > 0 ? 'right' : 'left';
            else if (fdy !== 0) facing = fdy > 0 ? 'down' : 'up';
            return { ...u, x: lastStep.x, y: lastStep.y, ap: u.ap - path.length, facing };
          }
          return u;
        });
        const { fog, visited } = calculateVisibility(newUnits, prev.visitedTiles);
        const nextState = { ...prev, units: newUnits, fogOfWar: fog, visitedTiles: visited };
        recordState(nextState);
        return nextState;
      });
    }
  };

  const endTurn = () => {
    if (state.isAITurn || isReplaying) return;
    sounds.playSiren(); setSightsMode('off'); setIsGrenadeMode(false);
    setState(prev => {
      const nextState = { ...prev, turn: 'enemy' as const, isAITurn: true, selectedUnitId: null, units: prev.units.map(u => ({ ...u, ap: u.maxAp })) };
      recordState(nextState); return nextState;
    });
  };

  const resetGame = () => {
    const newState = createInitialState();
    setState(newState);
    setHistoryStates([JSON.parse(JSON.stringify(newState))]);
    setIsReplaying(false); setReplayIndex(0); setIsPlaying(false); setHasSavedCurrent(false); setSightsMode('off'); setIsGrenadeMode(false);
  };

  const exportBattle = () => {
    const dataStr = JSON.stringify(historyStates, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `neon_tactical_log_${Date.now()}.json`;
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    sounds.playMove();
  };

  useEffect(() => {
    if (isPlaying && isReplaying) {
      playbackTimerRef.current = window.setInterval(() => {
        setReplayIndex(prev => {
          if (prev >= historyStates.length - 1) { setIsPlaying(false); return prev; }
          return prev + 1;
        });
      }, 800 / playbackSpeed);
    } else if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
    return () => { if (playbackTimerRef.current) clearInterval(playbackTimerRef.current); };
  }, [isPlaying, isReplaying, historyStates.length, playbackSpeed]);

  useEffect(() => {
    if (state.isAITurn && state.turn === 'enemy' && !playerWin && !enemyWin && !isReplaying) {
      const processAI = async () => {
        const enemies = state.units.filter(u => u.team === 'enemy' && u.hp > 0).sort(() => Math.random() - 0.5);
        for (const enemy of enemies) {
          setState(prev => ({ ...prev, selectedUnitId: enemy.id }));
          await new Promise(r => setTimeout(r, 200));
          for (let step = 0; step < enemy.maxAp; step++) {
            if (playerWin || enemyWin) return;
            await new Promise(r => setTimeout(r, 400)); 
            let actionTaken = false;
            setState(prev => {
              const cur = prev.units.find(u => u.id === enemy.id);
              if (!cur || cur.ap <= 0 || cur.hp <= 0) return prev;
              const players = prev.units.filter(p => p.team === 'player' && p.hp > 0);
              if (players.length === 0) return prev;
              const target = players.find(p => canAttack(cur, p, prev.obstacles));
              if (target) {
                actionTaken = true; sounds.playAttack();
                const now = Date.now();
                const attackEffect: VisualEffect = { id: Math.random().toString(), type: 'attack', from: { x: cur.x, y: cur.y }, to: { x: target.x, y: target.y }, color: '#f87171', startTime: now, duration: 350 };
                const hitEffect: VisualEffect = { id: Math.random().toString(), type: 'hit', from: { x: cur.x, y: cur.y }, to: { x: target.x, y: target.y }, color: '#ffffff', startTime: now + 300, duration: 300 };
                const newUnits = prev.units.map(u => u.id === target.id ? { ...u, hp: Math.max(0, u.hp - 1) } : u.id === cur.id ? { ...u, ap: cur.ap - 1 } : u);
                const { fog, visited } = calculateVisibility(newUnits, prev.visitedTiles);
                const nextState = { ...prev, units: newUnits, fogOfWar: fog, visitedTiles: visited, visualEffects: [...prev.visualEffects, attackEffect, hitEffect] };
                
                setTimeout(() => {
                    const u = nextState.units.find(unit => unit.id === target.id);
                    if (u && u.hp <= 0) sounds.playBreak();
                    else sounds.playHit();
                }, 350);
                
                recordState(nextState); return nextState;
              } 
              const next = findNextStepTowards(prev, cur, players[0]);
              if (next && canMoveTo(prev, cur, next)) {
                actionTaken = true; sounds.playMove(); 
                const dx = next.x - cur.x, dy = next.y - cur.y;
                let facing: Unit['facing'] = dx !== 0 ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
                const newUnits: Unit[] = prev.units.map(u => u.id === cur.id ? { ...u, x: next.x, y: next.y, ap: cur.ap - 1, facing } : u);
                const { fog, visited } = calculateVisibility(newUnits, prev.visitedTiles);
                const nextState = { ...prev, units: newUnits, fogOfWar: fog, visitedTiles: visited };
                recordState(nextState); return nextState;
              }
              return prev;
            });
            if (!actionTaken) break;
          }
        }
        await new Promise(r => setTimeout(r, 600));
        setState(prev => {
          const nextState = { ...prev, turn: 'player' as const, isAITurn: false, turnNumber: prev.turnNumber + 1, units: prev.units.map(u => ({ ...u, ap: u.maxAp })), selectedUnitId: null };
          recordState(nextState); return nextState;
        });
      };
      processAI();
    }
  }, [state.isAITurn, state.turn, playerWin, enemyWin, isReplaying]);

  const selectedUnit = state.units.find(u => u.id === state.selectedUnitId);
  const hudWidth = (GRID_WIDTH * tileSize) + 8;
  const displayState = isReplaying ? historyStates[replayIndex] : state;

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-950 px-[10px] py-4 text-slate-100 select-none overflow-hidden">
      <div className="mb-2 flex flex-col gap-1" style={{ width: hudWidth }}>
        <div className="flex justify-between items-center pb-1.5 border-b border-slate-800/50">
          <h1 className="text-sm font-black tracking-tighter text-green-400 italic leading-none whitespace-nowrap">NEON TACTICAL</h1>
          <div className="flex-1 px-4 flex justify-center">
            <select value={isReplaying ? "replay" : "live"} onChange={(e) => { const v = e.target.value; if (v === "live") setIsReplaying(false); else if (v === "current") { setIsReplaying(true); setReplayIndex(0); } else { const b = savedBattles.find(s => s.id === v); if (b) { setHistoryStates(b.history); setIsReplaying(true); setReplayIndex(0); } } }} className="bg-slate-900 border border-slate-700 text-[10px] font-mono rounded px-1.5 py-0.5 text-slate-400 focus:outline-none focus:border-blue-500 max-w-[120px]">
              <option value="live">● LIVE FEED</option>
              {historyStates.length > 1 && <option value="current">CURRENT LOG</option>}
              {savedBattles.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <p className="text-[9px] text-slate-500 font-mono uppercase">{isReplaying ? `REP:${replayIndex + 1}/${historyStates.length}` : `T:${state.turnNumber}`}</p>
        </div>
      </div>
      <div className="relative flex flex-col items-center">
        <CanvasBoard state={displayState} tileSize={tileSize} onTileClick={handleTileClick} onUnitClick={handleUnitClick} onRotateUnit={handleRotateUnit} forceNoFog={isReplaying} aimTiles={aimTiles} isGrenadeMode={isGrenadeMode} />
        
        {!isReplaying && (
          <>
            <div className="mt-[11px] flex items-stretch gap-1" style={{ width: hudWidth }}>
              <div className="flex-[5] bg-slate-900/90 border border-slate-800 px-3 py-1 rounded text-[11px] font-mono flex items-center shadow-lg min-h-[40px]">
                {selectedUnit ? (
                  <div className="flex flex-row w-full items-center text-slate-300 gap-3">
                    <div className="flex flex-col"><span className={selectedUnit.team === 'player' ? "text-green-400 font-bold" : "text-red-400 font-bold"}>U_{selectedUnit.id.slice(1).toUpperCase()}</span><span className="text-[8px] opacity-60">STATUS: OK</span></div>
                    <div className="flex flex-col gap-0.5 flex-grow text-right">
                      <div className="flex justify-end gap-2 text-[10px]"><span>HP: {selectedUnit.hp}</span><span className="text-green-400 font-bold">AP: {selectedUnit.ap}</span></div>
                      <div className="w-full h-1 bg-slate-800 rounded-full mt-1"><div className="h-full bg-green-500" style={{ width: `${(selectedUnit.hp/selectedUnit.maxHp)*100}%` }}></div></div>
                    </div>
                  </div>
                ) : <div className="w-full text-center text-slate-500 italic uppercase text-[9px]">AWAITING SQUAD LINK...</div>}
              </div>
              <div className="flex flex-[1.5] items-stretch gap-1">
                <button onClick={() => selectedUnit && handleRotateUnit(selectedUnit.id, (['up', 'right', 'down', 'left'] as Unit['facing'][]).indexOf(selectedUnit.facing) === 0 ? 'left' : (['up', 'right', 'down', 'left'] as Unit['facing'][]).indexOf(selectedUnit.facing) === 1 ? 'up' : (['up', 'right', 'down', 'left'] as Unit['facing'][]).indexOf(selectedUnit.facing) === 2 ? 'right' : 'down')} disabled={!selectedUnit || state.isAITurn} className="flex-1 bg-slate-900 border border-slate-700 rounded flex items-center justify-center text-slate-400 active:scale-95 text-sm font-bold">&lt;</button>
                <button onClick={() => selectedUnit && handleRotateUnit(selectedUnit.id, (['up', 'right', 'down', 'left'] as Unit['facing'][]).indexOf(selectedUnit.facing) === 3 ? 'up' : (['up', 'right', 'down', 'left'] as Unit['facing'][]).indexOf(selectedUnit.facing) === 0 ? 'right' : (['up', 'right', 'down', 'left'] as Unit['facing'][]).indexOf(selectedUnit.facing) === 1 ? 'down' : 'left')} disabled={!selectedUnit || state.isAITurn} className="flex-1 bg-slate-900 border border-slate-700 rounded flex items-center justify-center text-slate-400 active:scale-95 text-sm font-bold">&gt;</button>
              </div>
            </div>

            <div className="mt-1.5 flex gap-1 w-full" style={{ width: hudWidth }}>
              <button onClick={() => useCombatAction(0)} disabled={!selectedUnit || selectedUnit.walls <= 0 || state.isAITurn} className="relative flex-1 bg-slate-900/80 hover:bg-slate-800 border border-slate-800 h-[39px] rounded overflow-hidden disabled:opacity-30 transition-all">
                 <svg className="absolute top-0.5 left-1 w-7 h-7 text-slate-400" viewBox="0 0 24 24" fill="currentColor">
                   <path d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-1 5h-4V6h4v3zm-6-3v3h-4V6h4zm-6 0v3H3V6h4zm-4 5h4v3H3v-3zm6 3v-3h4v3h-4zm6 0v-3h4v3h-4zm4 2v3h-4v-3h4zm-6 0v3h-4v-3h4zm-6 0v3H3v-3h4z"/>
                 </svg>
                 <span className="absolute bottom-0.5 right-1.5 text-[10px] font-mono font-bold text-slate-500">{selectedUnit?.walls ?? 0}</span>
              </button>
              <button onClick={() => useCombatAction(1)} disabled={!selectedUnit || selectedUnit.stealth <= 0 || state.isAITurn} className="relative flex-1 bg-slate-900/80 hover:bg-slate-800 border border-slate-800 h-[39px] rounded overflow-hidden disabled:opacity-30 transition-all">
                 <svg className="absolute top-0.5 left-1 w-7 h-7 text-purple-400" viewBox="0 0 24 24" fill="currentColor">
                   <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                 </svg>
                 <span className="absolute bottom-0.5 right-1.5 text-[10px] font-mono font-bold text-slate-500">{selectedUnit?.stealth ?? 0}</span>
              </button>
              <button onClick={() => useCombatAction(2)} disabled={!selectedUnit || selectedUnit.traps <= 0 || state.isAITurn} className="relative flex-1 bg-slate-900/80 hover:bg-slate-800 border border-slate-800 h-[39px] rounded overflow-hidden disabled:opacity-30 transition-all">
                 <svg className="absolute top-0.5 left-1 w-7 h-7 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                   <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                 </svg>
                 <span className="absolute bottom-0.5 right-1.5 text-[10px] font-mono font-bold text-slate-500">{selectedUnit?.traps ?? 0}</span>
              </button>
              <button onClick={() => useCombatAction(3)} disabled={!selectedUnit || selectedUnit.grenades <= 0 || state.isAITurn} className={`relative flex-1 ${isGrenadeMode ? 'bg-orange-600 border-orange-400' : 'bg-slate-900/80 border-slate-800'} h-[39px] rounded overflow-hidden disabled:opacity-30 transition-all`}>
                 <svg className={`absolute top-0.5 left-1 w-7 h-7 ${isGrenadeMode ? 'text-white' : 'text-orange-400'}`} viewBox="0 0 24 24" fill="currentColor">
                   <path d="M12 2C9.24 2 7 4.24 7 7v1c0 2.76 2.24 5 5 5s5-2.24 5-5V7c0-2.76-2.24-5-5-5zm-3 14c0-1.1.9-2 2-2h2c1.1 0 2 .9 2 2v2H9v-2zm10 0h-2v2h2v-2zM5 16h2v2H5v-2z"/>
                   <circle cx="9.5" cy="7.5" r="1" fill="#000" /><circle cx="14.5" cy="7.5" r="1" fill="#000" />
                 </svg>
                 <span className={`absolute bottom-0.5 right-1.5 text-[10px] font-mono font-bold ${isGrenadeMode ? 'text-white' : 'text-slate-500'}`}>{selectedUnit?.grenades ?? 0}</span>
              </button>
              <button onClick={() => useCombatAction(4)} disabled={!selectedUnit || state.isAITurn} className={`relative flex-1 ${sightsMode !== 'off' ? 'bg-red-600 border-red-400' : 'bg-slate-900/80 border-slate-800'} h-[39px] rounded overflow-hidden disabled:opacity-30 transition-all`}>
                 <svg className={`absolute top-0.5 left-1 w-7 h-7 ${sightsMode !== 'off' ? 'text-white' : 'text-blue-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                   <circle cx="12" cy="12" r="10"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="3"/>
                 </svg>
                 <span className="absolute bottom-0.5 right-1.5 text-[9px] font-black text-slate-300">{sightsMode.toUpperCase()}</span>
              </button>
              <button onClick={endTurn} disabled={state.isAITurn || playerWin || enemyWin} className={`flex-[1.5] h-[39px] text-[11px] font-black rounded active:scale-95 border ${state.isAITurn || playerWin || enemyWin ? 'bg-slate-800 text-slate-600 border-slate-700' : 'bg-green-500 text-slate-950 border-green-400'}`}>GO</button>
            </div>
          </>
        )}

        {isReplaying && (
          <div className="mt-[11px] flex flex-col gap-1.5 w-full" style={{ width: hudWidth }}>
            <div className="flex justify-between gap-1">
              <button onClick={() => setReplayIndex(p => Math.max(0, p - 1))} className="flex-1 bg-slate-800 border border-slate-700 py-1.5 rounded text-[10px] font-bold">PREV</button>
              <button onClick={() => setIsPlaying(!isPlaying)} className="flex-1 bg-blue-600 border border-blue-500 py-1.5 rounded text-[10px] font-black">{isPlaying ? "PAUSE" : "PLAY"}</button>
              <button onClick={() => setPlaybackSpeed(s => s === 5 ? 1 : s + 2)} className="flex-1 bg-slate-800 border border-slate-700 py-1.5 rounded text-[10px] font-bold">{playbackSpeed}X</button>
              <button onClick={() => setReplayIndex(p => Math.min(historyStates.length - 1, p + 1))} className="flex-1 bg-slate-800 border border-slate-700 py-1.5 rounded text-[10px] font-bold">NEXT</button>
            </div>
            <div className="flex gap-1">
              <button onClick={resetGame} className="flex-1 bg-slate-100 text-slate-950 py-1.5 rounded text-[10px] font-black uppercase">New Mission</button>
              <button onClick={exportBattle} className="flex-1 bg-slate-800 border border-slate-700 text-slate-100 py-1.5 rounded text-[10px] font-black uppercase">Export Log</button>
            </div>
          </div>
        )}

        {(playerWin || enemyWin) && !isReplaying && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm rounded-lg">
            <div className="text-center p-6 border-2 border-slate-700 bg-slate-900 rounded-xl m-4 shadow-2xl">
              <h2 className={`text-2xl font-black mb-3 tracking-tighter ${playerWin ? 'text-green-400' : 'text-red-500'}`}>{playerWin ? 'MISSION CLEAR' : 'SQUAD WIPED'}</h2>
              <div className="flex flex-col gap-2">
                <button onClick={resetGame} className="w-full px-5 py-2.5 bg-slate-100 text-slate-950 font-black text-sm rounded-md hover:bg-green-400 active:scale-95">REDEPLOY SQUAD</button>
                <button onClick={() => { setIsReplaying(true); setReplayIndex(0); }} className="w-full px-5 py-2.5 bg-blue-600 text-slate-100 font-black text-sm rounded-md hover:bg-blue-500 active:scale-95 border border-blue-400">BATTLE HISTORY</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
