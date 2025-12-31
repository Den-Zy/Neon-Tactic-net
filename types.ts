export type Team = 'player' | 'enemy';

export interface Unit {
  id: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  range: number;
  team: Team;
  facing: 'up' | 'down' | 'left' | 'right';
  // Inventory for the special actions
  grenades: number;
  aims: number;
  walls: number;
  stealth: number;
  traps: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface VisualEffect {
  id: string;
  type: 'attack' | 'hit';
  from: Point;
  to: Point;
  color: string;
  startTime: number;
  duration: number;
}

export interface GameState {
  units: Unit[];
  obstacles: Point[];
  obstacleHp: Record<string, number>; // Key: "x,y", Value: remaining HP
  selectedUnitId: string | null;
  turn: Team;
  turnNumber: number;
  fogOfWar: boolean[][];
  visitedTiles: boolean[][];
  isAITurn: boolean;
  history: string[];
  visualEffects: VisualEffect[];
}

export const GRID_WIDTH = 15;
export const GRID_HEIGHT = 20;