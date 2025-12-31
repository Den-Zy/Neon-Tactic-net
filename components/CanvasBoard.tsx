
import React, { useRef, useEffect, useState } from 'react';
import { GameState, Point, GRID_WIDTH, GRID_HEIGHT, Unit, VisualEffect } from '../types';
import { canMoveTo, canAttack, getDistance, isLineOfSightClear } from '../gameEngine';

interface Props {
  state: GameState;
  tileSize: number;
  onTileClick?: (p: Point) => void;
  onUnitClick?: (u: Unit) => void;
  onRotateUnit?: (unitId: string, facing: Unit['facing']) => void;
  forceNoFog?: boolean;
  aimTiles?: Point[];
  isGrenadeMode?: boolean;
}

const CanvasBoard: React.FC<Props> = ({ 
  state, 
  tileSize, 
  onTileClick, 
  onUnitClick, 
  onRotateUnit, 
  forceNoFog = false,
  aimTiles = [],
  isGrenadeMode = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fogCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverTile, setHoverTile] = useState<Point | null>(null);
  const [pulse, setPulse] = useState(0);
  
  const [dragRotationInfo, setDragRotationInfo] = useState<{unitId: string, startPos: Point, hasRotated: boolean} | null>(null);

  useEffect(() => {
    let frame: number;
    const animate = (time: number) => {
      setPulse(Math.sin(time / 200) * 0.5 + 0.5);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || tileSize <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!fogCanvasRef.current) fogCanvasRef.current = document.createElement('canvas');
    const fogCanvas = fogCanvasRef.current;
    if (fogCanvas.width !== canvas.width || fogCanvas.height !== canvas.height) {
      fogCanvas.width = canvas.width;
      fogCanvas.height = canvas.height;
    }
    const fctx = fogCanvas.getContext('2d');
    if (!fctx) return;

    // Background
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid lines
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let x = 0; x <= GRID_WIDTH; x++) {
      ctx.beginPath();
      ctx.moveTo(x * tileSize, 0);
      ctx.lineTo(x * tileSize, GRID_HEIGHT * tileSize);
      ctx.stroke();
    }
    for (let y = 0; y <= GRID_HEIGHT; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * tileSize);
      ctx.lineTo(GRID_WIDTH * tileSize, y * tileSize);
      ctx.stroke();
    }

    const selectedUnit = state.units.find(u => u.id === state.selectedUnitId && u.hp > 0);
    const now = Date.now();

    // Obstacles
    state.obstacles.forEach(o => {
      const isVisible = forceNoFog || !state.fogOfWar[o.y][o.x] || state.visitedTiles[o.y][o.x];
      if (isVisible) {
        const hp = state.obstacleHp[`${o.x},${o.y}`] ?? 0;
        
        let tx = o.x * tileSize;
        let ty = o.y * tileSize;
        
        // Final destruction shake effect
        if (hp <= 0) {
            tx += (Math.random() - 0.5) * 4;
            ty += (Math.random() - 0.5) * 4;
        }

        // Base Square
        ctx.save();
        if (hp <= 0) ctx.globalAlpha = pulse; // Pulse fade out for dead obstacles
        ctx.fillStyle = hp > 0 ? '#334155' : '#1e293b';
        ctx.fillRect(tx + 2, ty + 2, tileSize - 4, tileSize - 4);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.strokeRect(tx + 2, ty + 2, tileSize - 4, tileSize - 4);

        // Cracking Effect (at 1 HP or less)
        if (hp <= 1) {
          ctx.strokeStyle = hp <= 0 ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.45)';
          ctx.lineWidth = hp <= 0 ? 1.5 : 1;
          ctx.beginPath();
          
          // Shattered patterns
          ctx.moveTo(tx + tileSize/2, ty + tileSize/2);
          ctx.lineTo(tx + 6, ty + 8);
          ctx.moveTo(tx + tileSize/2, ty + tileSize/2);
          ctx.lineTo(tx + tileSize - 8, ty + 12);
          ctx.moveTo(tx + tileSize/2, ty + tileSize/2);
          ctx.lineTo(tx + 12, ty + tileSize - 6);
          ctx.moveTo(tx + tileSize/2, ty + tileSize/2);
          ctx.lineTo(tx + tileSize - 10, ty + tileSize - 10);
          
          if (hp <= 0) {
              // Extra cracks for fully destroyed state
              ctx.moveTo(tx + 4, ty + tileSize/2);
              ctx.lineTo(tx + tileSize - 4, ty + tileSize/2);
              ctx.moveTo(tx + tileSize/2, ty + 4);
              ctx.lineTo(tx + tileSize/2, ty + tileSize - 4);
          }
          
          ctx.stroke();
        }

        // HP Bar for Obstacles
        const barHeight = 2.5;
        const barPadding = 5;
        const barWidth = tileSize - barPadding * 2;
        const barY = ty + 4;
        ctx.fillStyle = '#111';
        ctx.fillRect(tx + barPadding, barY, barWidth, barHeight);
        ctx.fillStyle = hp > 0 ? '#94a3b8' : '#450a0a';
        ctx.fillRect(tx + barPadding, barY, barWidth * (hp / 2), barHeight);

        // Grenade Mode: Targetable Obstacles Highlight (Red Squares)
        if (isGrenadeMode && selectedUnit && selectedUnit.team === 'player' && selectedUnit.ap > 0 && selectedUnit.grenades > 0) {
          const dist = getDistance({ x: selectedUnit.x, y: selectedUnit.y }, o);
          if (dist <= selectedUnit.range && isLineOfSightClear({ x: selectedUnit.x, y: selectedUnit.y }, o, state.obstacles)) {
            ctx.strokeStyle = `rgba(239, 68, 68, ${0.4 + pulse * 0.6})`;
            ctx.lineWidth = 2;
            ctx.strokeRect(tx + 1, ty + 1, tileSize - 2, tileSize - 2);
          }
        }
        ctx.restore();
      }
    });

    // Aim Highlights (Tactical Sights / Fire Sectors)
    if (aimTiles.length > 0 && !isGrenadeMode) {
      ctx.save();
      const alpha = 0.3 + (pulse * 0.5);
      ctx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
      ctx.lineWidth = 1.5;
      const crossSize = tileSize * 0.35;

      aimTiles.forEach(p => {
        const cx = p.x * tileSize + tileSize / 2;
        const cy = p.y * tileSize + tileSize / 2;
        ctx.beginPath();
        ctx.moveTo(cx - crossSize, cy);
        ctx.lineTo(cx + crossSize, cy);
        ctx.moveTo(cx, cy - crossSize);
        ctx.lineTo(cx, cy + crossSize);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, (crossSize * 0.6) + (pulse * 2), 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();
    }

    // Movement arrows
    if (!forceNoFog && selectedUnit && selectedUnit.team === 'player' && selectedUnit.ap > 0 && state.turn === 'player' && !state.isAITurn) {
      ctx.save();
      const directions = [
        { dx: 0, dy: -1, angle: -Math.PI / 2 }, 
        { dx: 0, dy: 1, angle: Math.PI / 2 }, 
        { dx: -1, dy: 0, angle: Math.PI }, 
        { dx: 1, dy: 0, angle: 0 }
      ];
      directions.forEach(dir => {
        const targetPos = { x: selectedUnit.x + dir.dx, y: selectedUnit.y + dir.dy };
        if (canMoveTo(state, selectedUnit, targetPos)) {
          ctx.save();
          const cx = targetPos.x * tileSize + tileSize / 2;
          const cy = targetPos.y * tileSize + tileSize / 2;
          ctx.translate(cx, cy);
          ctx.rotate(dir.angle);
          ctx.globalAlpha = 0.3 + (pulse * 0.7);
          ctx.strokeStyle = '#4ade80';
          ctx.lineWidth = 2;
          const arrowSize = tileSize / 4;
          ctx.beginPath();
          ctx.moveTo(-arrowSize / 2, -arrowSize / 2);
          ctx.lineTo(arrowSize / 2, 0);
          ctx.lineTo(-arrowSize / 2, arrowSize / 2);
          ctx.stroke();
          ctx.restore();
        }
      });
      ctx.restore();
    }

    // Units
    state.units.forEach(u => {
      const isVisible = forceNoFog || !state.fogOfWar[u.y][u.x] || u.team === 'player';
      if (!isVisible) return;
      
      const activeEffectsTargeting = state.visualEffects.filter(fx => fx.to.x === u.x && fx.to.y === u.y);
      const stillUnderAttack = activeEffectsTargeting.some(fx => Math.abs(now - fx.startTime) < fx.duration);
      const isActuallyDying = u.hp <= 0 && !stillUnderAttack;
      const isSelected = u.id === state.selectedUnitId && u.hp > 0;
      const unitColor = u.team === 'player' ? '#4ade80' : '#f87171';
      
      const isInAttackRange = selectedUnit && u.team !== selectedUnit.team && u.hp > 0 && canAttack(selectedUnit, u, state.obstacles);

      ctx.save();
      let offsetX = 0; 
      let offsetY = 0;
      const cx = u.x * tileSize + tileSize / 2;
      const cy = u.y * tileSize + tileSize / 2;
      const radius = ((tileSize / 2) - 6) * 0.75;

      if (isActuallyDying) {
        ctx.globalAlpha = pulse; 
        offsetX = (Math.random() - 0.5) * 4;
        offsetY = (Math.random() - 0.5) * 4;
      } else if (isSelected) {
        const selectColor = u.team === 'player' ? '#facc15' : '#ff9900';
        ctx.shadowBlur = 15;
        ctx.shadowColor = selectColor;
        ctx.strokeStyle = selectColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
        ctx.stroke();
      } else if (isInAttackRange) {
        ctx.shadowBlur = 10 + (pulse * 15);
        ctx.shadowColor = '#ff0033';
        ctx.strokeStyle = '#ff1155';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = unitColor;
      ctx.beginPath();
      ctx.arc(cx + offsetX, cy + offsetY, radius, 0, Math.PI * 2);
      ctx.fill();

      if (!isActuallyDying) {
        ctx.save();
        ctx.translate(cx + offsetX, cy + offsetY);
        ctx.beginPath();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffffff';
        ctx.moveTo(0, 0);
        const gunLength = radius + 8;
        let gx = 0, gy = 0;
        if (u.facing === 'up') gy = -gunLength;
        else if (u.facing === 'down') gy = gunLength;
        else if (u.facing === 'left') gx = -gunLength;
        else if (u.facing === 'right') gx = gunLength;
        ctx.lineTo(gx, gy);
        ctx.stroke();
        ctx.restore();

        const barHeight = 2.5;
        const barPadding = 5;
        const barWidth = tileSize - barPadding * 2;
        const barY = u.team === 'enemy' ? u.y * tileSize + 2 : u.y * tileSize + tileSize - 5;
        ctx.fillStyle = '#111';
        ctx.fillRect(u.x * tileSize + barPadding, barY, barWidth, barHeight);
        ctx.fillStyle = unitColor;
        ctx.fillRect(u.x * tileSize + barPadding, barY, barWidth * (u.hp / u.maxHp), barHeight);
      }
      ctx.restore();
    });

    if (!forceNoFog) {
      fctx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
      fctx.fillStyle = '#000000';
      fctx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);
      fctx.save();
      fctx.globalCompositeOperation = 'destination-out';
      if (typeof fctx.filter !== 'undefined') fctx.filter = 'blur(12px)';
      state.units.filter(u => u.team === 'player' && u.hp > 0).forEach(u => {
        const cx = u.x * tileSize + tileSize / 2;
        const cy = u.y * tileSize + tileSize / 2;
        fctx.beginPath();
        fctx.arc(cx, cy, tileSize * 4.5, 0, Math.PI * 2);
        fctx.fill();
        fctx.beginPath();
        fctx.moveTo(cx, cy);
        const coneLength = tileSize * 8;
        const coneAngle = Math.PI / 3;
        let baseAngle = 0;
        if (u.facing === 'up') baseAngle = -Math.PI / 2;
        else if (u.facing === 'down') baseAngle = Math.PI / 2;
        else if (u.facing === 'left') baseAngle = Math.PI;
        else if (u.facing === 'right') baseAngle = 0;
        fctx.arc(cx, cy, coneLength, baseAngle - coneAngle / 2, baseAngle + coneAngle / 2);
        fctx.closePath();
        fctx.fill();
      });
      fctx.restore();
      fctx.save();
      fctx.globalCompositeOperation = 'destination-out';
      for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
          if (state.visitedTiles[y][x] && state.fogOfWar[y][x]) {
            fctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            fctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
          }
        }
      }
      fctx.restore();
      ctx.drawImage(fogCanvas, 0, 0);
    }

    state.visualEffects.forEach(effect => {
      const elapsed = now - effect.startTime; 
      const isActive = forceNoFog || (elapsed < effect.duration && elapsed >= 0);
      if (isActive) {
        const progress = forceNoFog ? 1 : elapsed / effect.duration;
        const targetX = effect.to.x * tileSize + tileSize / 2;
        const targetY = effect.to.y * tileSize + tileSize / 2;
        const startX = effect.from.x * tileSize + tileSize / 2;
        const startY = effect.from.y * tileSize + tileSize / 2;
        
        if (effect.type === 'attack') {
          ctx.save();
          ctx.strokeStyle = effect.color;
          ctx.lineWidth = 2;
          if (forceNoFog) {
            ctx.setLineDash([8, 6]);
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(targetX, targetY);
            ctx.stroke();
          } else {
            const currentX = startX + (targetX - startX) * progress;
            const currentY = startY + (targetY - startY) * progress;
            ctx.globalAlpha = 1 - progress; 
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(currentX, currentY);
            ctx.stroke();
          }
          ctx.restore();
        } else if (effect.type === 'hit') {
          ctx.save();
          const radius = forceNoFog ? (tileSize / 3) : (tileSize / 2) * progress;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = forceNoFog ? 1.5 : 3 * (1 - progress);
          ctx.globalAlpha = forceNoFog ? 0.6 : 1 - progress;
          ctx.beginPath();
          ctx.arc(targetX, targetY, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    });

    if (hoverTile && state.turn === 'player' && !state.isAITurn && !forceNoFog) {
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.strokeRect(hoverTile.x * tileSize, hoverTile.y * tileSize, tileSize, tileSize);
    }
  }, [state, hoverTile, tileSize, pulse, forceNoFog, aimTiles, isGrenadeMode]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (forceNoFog) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const x = Math.floor(canvasX / (rect.width / GRID_WIDTH));
    const y = Math.floor(canvasY / (rect.height / GRID_HEIGHT));
    if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) setHoverTile({ x, y });

    if (dragRotationInfo && onRotateUnit) {
      const dx = canvasX - dragRotationInfo.startPos.x;
      const dy = canvasY - dragRotationInfo.startPos.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > tileSize * 0.4) {
        let facing: Unit['facing'] = 'up';
        if (Math.abs(dx) > Math.abs(dy)) facing = dx > 0 ? 'right' : 'left';
        else facing = dy > 0 ? 'down' : 'up';
        const unit = state.units.find(u => u.id === dragRotationInfo.unitId);
        if (unit && unit.facing !== facing) {
          onRotateUnit(dragRotationInfo.unitId, facing);
          setDragRotationInfo({ ...dragRotationInfo, hasRotated: true });
        }
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (forceNoFog || state.isAITurn || state.turn !== 'player') return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const x = Math.floor(canvasX / (rect.width / GRID_WIDTH));
    const y = Math.floor(canvasY / (rect.height / GRID_HEIGHT));
    const clickedUnit = state.units.find(u => u.x === x && u.y === y && u.hp > 0);
    if (clickedUnit && clickedUnit.team === 'player') {
      setDragRotationInfo({ unitId: clickedUnit.id, startPos: { x: canvasX, y: canvasY }, hasRotated: false });
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (forceNoFog) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const x = Math.floor(canvasX / (rect.width / GRID_WIDTH));
    const y = Math.floor(canvasY / (rect.height / GRID_HEIGHT));
    const dragInfo = dragRotationInfo;
    setDragRotationInfo(null);

    if (dragInfo) {
      const dx = canvasX - dragInfo.startPos.x;
      const dy = canvasY - dragInfo.startPos.y;
      if (Math.sqrt(dx*dx + dy*dy) < tileSize * 0.3 && !dragInfo.hasRotated) {
        const clickedUnit = state.units.find(u => u.id === dragInfo.unitId);
        if (clickedUnit) onUnitClick?.(clickedUnit);
      }
      return;
    }

    if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) return;
    const clickedUnit = state.units.find(u => u.x === x && u.y === y && u.hp > 0);
    if (clickedUnit) {
      if (!state.fogOfWar[y][x] || clickedUnit.team === 'player') onUnitClick?.(clickedUnit);
    } else {
      onTileClick?.({ x, y });
    }
  };

  return (
    <div className={`relative border-4 rounded-lg overflow-hidden bg-black transition-all duration-500 mx-auto ${state.turn === 'enemy' ? 'border-red-600 shadow-[0_0_30px_rgba(220,38,38,0.5)]' : 'border-slate-800 shadow-2xl'}`} style={{ width: GRID_WIDTH * tileSize + 8 }}>
      <canvas 
        ref={canvasRef} 
        width={GRID_WIDTH * tileSize} 
        height={GRID_HEIGHT * tileSize} 
        onMouseMove={handleMouseMove} 
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setHoverTile(null); setDragRotationInfo(null); }} 
        className="block" 
      />
    </div>
  );
};

export default CanvasBoard;
