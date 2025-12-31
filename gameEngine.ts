import { GameState, Unit, Point, GRID_WIDTH, GRID_HEIGHT } from './types';

export const calculateVisibility = (units: Unit[], currentVisited: boolean[][]): { fog: boolean[][], visited: boolean[][] } => {
  const fog = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(true));
  const visited = currentVisited.map(row => [...row]);

  units.filter(u => u.team === 'player').forEach(u => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const nx = u.x + dx;
        const ny = u.y + dy;
        if (nx >= 0 && nx < GRID_WIDTH && ny >= 0 && ny < GRID_HEIGHT) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= 4.5) {
            fog[ny][nx] = false;
            visited[ny][nx] = true;
          }
        }
      }
    }

    const coneRange = 7;
    for (let i = 1; i <= coneRange; i++) {
      for (let j = -i; j <= i; j++) {
        let nx = u.x, ny = u.y;
        if (u.facing === 'up') { ny -= i; nx += j; }
        else if (u.facing === 'down') { ny += i; nx += j; }
        else if (u.facing === 'left') { nx -= i; ny += j; }
        else if (u.facing === 'right') { nx += i; ny += j; }

        if (nx >= 0 && nx < GRID_WIDTH && ny >= 0 && ny < GRID_HEIGHT) {
          fog[ny][nx] = false;
          visited[ny][nx] = true;
        }
      }
    }
  });

  return { fog, visited };
};

export const createInitialState = (): GameState => {
  const units: Unit[] = [];
  
  for (let i = 0; i < 5; i++) {
    units.push({
      id: `p${i}`,
      x: 3 + i * 2,
      y: GRID_HEIGHT - 2,
      hp: 5,
      maxHp: 5,
      ap: 3,
      maxAp: 3,
      range: 5,
      team: 'player',
      facing: 'up',
      grenades: 6, // 6 grenades per unit
      aims: 2,
      walls: 1,
      stealth: 1,
      traps: 2
    });
  }

  for (let i = 0; i < 5; i++) {
    units.push({
      id: `e${i}`,
      x: 3 + i * 2,
      y: 1,
      hp: 5,
      maxHp: 5,
      ap: 3,
      maxAp: 3,
      range: 5,
      team: 'enemy',
      facing: 'down',
      grenades: 0,
      aims: 0,
      walls: 0,
      stealth: 0,
      traps: 0
    });
  }

  const obstacles: Point[] = [];
  const obstacleHp: Record<string, number> = {};
  for (let i = 0; i < 25; i++) {
    const ox = Math.floor(Math.random() * GRID_WIDTH);
    const oy = Math.floor(Math.random() * (GRID_HEIGHT - 6)) + 3;
    if (!obstacles.some(o => o.x === ox && o.y === oy) && !units.some(u => u.x === ox && u.y === oy)) {
      obstacles.push({ x: ox, y: oy });
      obstacleHp[`${ox},${oy}`] = 2; // Each obstacle has 2 HP
    }
  }

  const initialVisited = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(false));
  const { fog, visited } = calculateVisibility(units, initialVisited);

  return {
    units,
    obstacles,
    obstacleHp,
    selectedUnitId: null,
    turn: 'player',
    turnNumber: 1,
    fogOfWar: fog,
    visitedTiles: visited,
    isAITurn: false,
    history: ["Mission Start: Grid penetration successful."],
    visualEffects: []
  };
};

export const getDistance = (p1: Point, p2: Point) => Math.abs(p1.x - p2.x) + Math.abs(p1.y - p2.y);

export const isLineOfSightClear = (from: Point, to: Point, obstacles: Point[]): boolean => {
    const x0 = from.x + 0.5;
    const y0 = from.y + 0.5;
    const x1 = to.x + 0.5;
    const y1 = to.y + 0.5;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist <= 1.1) return true;
    
    const steps = Math.ceil(dist * 10); 
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const checkX = Math.floor(x0 + dx * t);
        const checkY = Math.floor(y0 + dy * t);
        
        if ((checkX === from.x && checkY === from.y) || (checkX === to.x && checkY === to.y)) continue;
        
        if (obstacles.some(o => o.x === checkX && o.y === checkY)) {
            return false;
        }
    }
    return true;
};

export const canMoveTo = (state: GameState, unit: Unit, target: Point): boolean => {
  if (target.x < 0 || target.x >= GRID_WIDTH || target.y < 0 || target.y >= GRID_HEIGHT) return false;
  const dist = getDistance({ x: unit.x, y: unit.y }, target);
  if (dist > 1) return false;
  if (state.obstacles.some(o => o.x === target.x && o.y === target.y)) return false;
  if (state.units.some(u => u.x === target.x && u.y === target.y && u.hp > 0)) return false;
  return true;
};

export const canAttack = (unit: Unit, target: Unit, obstacles: Point[]): boolean => {
  if (unit.team === target.team) return false;
  const dist = getDistance({ x: unit.x, y: unit.y }, { x: target.x, y: target.y });
  if (dist > unit.range) return false;
  return isLineOfSightClear({ x: unit.x, y: unit.y }, { x: target.x, y: target.y }, obstacles);
};

export const findNextStepTowards = (state: GameState, unit: Unit, target: Point): Point | null => {
  const queue: { pos: Point, path: Point[] }[] = [{ pos: { x: unit.x, y: unit.y }, path: [] }];
  const visited = new Set<string>();
  visited.add(`${unit.x},${unit.y}`);

  while (queue.length > 0) {
    const { pos, path } = queue.shift()!;

    if (getDistance(pos, target) <= 1) {
      return path[0] || null;
    }

    const neighbors = [
      { x: pos.x + 1, y: pos.y },
      { x: pos.x - 1, y: pos.y },
      { x: pos.x, y: pos.y + 1 },
      { x: pos.x, y: pos.y - 1 }
    ];

    for (const neighbor of neighbors) {
      const key = `${neighbor.x},${neighbor.y}`;
      if (
        neighbor.x >= 0 && neighbor.x < GRID_WIDTH &&
        neighbor.y >= 0 && neighbor.y < GRID_HEIGHT &&
        !visited.has(key) &&
        !state.obstacles.some(o => o.x === neighbor.x && o.y === neighbor.y) &&
        !state.units.some(u => u.x === neighbor.x && u.y === neighbor.y && u.hp > 0 && u.id !== unit.id)
      ) {
        const newPath = [...path, neighbor];
        if (getDistance(neighbor, target) === 0) return newPath[0];
        
        visited.add(key);
        queue.push({ pos: neighbor, path: newPath });
      }
    }
  }

  return null;
};

export const findPath = (state: GameState, unit: Unit, target: Point): Point[] | null => {
  const queue: { pos: Point, path: Point[] }[] = [{ pos: { x: unit.x, y: unit.y }, path: [] }];
  const visited = new Set<string>();
  visited.add(`${unit.x},${unit.y}`);

  while (queue.length > 0) {
    const { pos, path } = queue.shift()!;

    if (pos.x === target.x && pos.y === target.y) {
      return path;
    }

    const neighbors = [
      { x: pos.x + 1, y: pos.y },
      { x: pos.x - 1, y: pos.y },
      { x: pos.x, y: pos.y + 1 },
      { x: pos.x, y: pos.y - 1 }
    ];

    for (const neighbor of neighbors) {
      const key = `${neighbor.x},${neighbor.y}`;
      if (
        neighbor.x >= 0 && neighbor.x < GRID_WIDTH &&
        neighbor.y >= 0 && neighbor.y < GRID_HEIGHT &&
        !visited.has(key) &&
        !state.obstacles.some(o => o.x === neighbor.x && o.y === neighbor.y) &&
        !state.units.some(u => u.x === neighbor.x && u.y === neighbor.y && u.hp > 0 && u.id !== unit.id)
      ) {
        visited.add(key);
        queue.push({ pos: neighbor, path: [...path, neighbor] });
      }
    }
  }

  return null;
};