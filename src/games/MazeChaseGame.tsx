import { useEffect, useRef, useState, useCallback } from 'react';
import { Trophy, RotateCcw, ArrowRight, Skull, Compass, Zap } from 'lucide-react';
import { sounds } from './soundFx';
import { controllerBus } from '../services/controllerBus';

interface MazeChaseGameProps {
  onBackToMenu: () => void;
  controllerCommand?: any;
}

// Tile types for the procedural maze
const TILE_FLOOR = 0;
const TILE_WALL = 1;
const TILE_NORMAL_DOOR = 2; // Passable light/medium blue door
const TILE_TRAP_DOOR = 3;   // Impassable dark blue trap door
const TILE_EXIT = 4;        // Golden exit portal

interface Point {
  x: number;
  y: number;
}

export function MazeChaseGame({ onBackToMenu, controllerCommand }: MazeChaseGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // States: 'playing' | 'caught' | 'escaped'
  const [gameState, setGameState] = useState<'playing' | 'caught' | 'escaped'>('playing');
  const [mazeLevel, setMazeLevel] = useState<number>(1);
  const [keysCollected, setKeysCollected] = useState<number>(0);
  const [totalKeys, setTotalKeys] = useState<number>(3);
  const [monsterDistance, setMonsterDistance] = useState<number>(0);

  // Grid dimensions (dynamic, responsive)
  const COLS = 21;
  const ROWS = 13;

  // Maze grid state ref
  const gridRef = useRef<number[][]>([]);
  const playerRef = useRef<{ x: number; y: number; vx: number; vy: number; radius: number }>({
    x: 1.5,
    y: 1.5,
    vx: 0,
    vy: 0,
    radius: 0.38
  });
  const monsterRef = useRef<{ x: number; y: number; speed: number; radius: number; animTime: number }>({
    x: COLS - 2.5,
    y: ROWS - 2.5,
    speed: 0.045, // steady, fair chase speed
    radius: 0.42,
    animTime: 0
  });

  const keysListRef = useRef<Point[]>([]);
  const particlesRef = useRef<{ x: number; y: number; vx: number; vy: number; life: number; color: string }[]>([]);

  // Input ref
  const inputRef = useRef({
    up: false,
    down: false,
    left: false,
    right: false,
    stickX: 0,
    stickY: 0
  });

  // Procedural Maze Generator (DFS recursive backtracking with doors and traps)
  const generateNewMaze = useCallback((level: number) => {
    // 1. Initialize all as walls
    const grid: number[][] = [];
    for (let r = 0; r < ROWS; r++) {
      grid[r] = [];
      for (let c = 0; c < COLS; c++) {
        grid[r][c] = TILE_WALL;
      }
    }

    // 2. DFS Maze carving starting at (1, 1)
    const visited: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    const stack: [number, number][] = [];

    grid[1][1] = TILE_FLOOR;
    visited[1][1] = true;
    stack.push([1, 1]);

    const dirs: [number, number, number, number][] = [
      [-2, 0, -1, 0], // Up: [dr, dc, wr, wc]
      [2, 0, 1, 0],   // Down
      [0, -2, 0, -1], // Left
      [0, 2, 0, 1]    // Right
    ];

    while (stack.length > 0) {
      const [cr, cc] = stack[stack.length - 1];
      const neighbors: [number, number, number, number][] = [];

      for (const [dr, dc, wr, wc] of dirs) {
        const nr = cr + dr;
        const nc = cc + dc;
        const wallR = cr + wr;
        const wallC = cc + wc;
        if (nr > 0 && nr < ROWS - 1 && nc > 0 && nc < COLS - 1 && !visited[nr][nc]) {
          neighbors.push([nr, nc, wallR, wallC]);
        }
      }

      if (neighbors.length > 0) {
        // Randomly pick one unvisited neighbor
        const [nextR, nextC, wallR, wallC] = neighbors[Math.floor(Math.random() * neighbors.length)];
        grid[wallR][wallC] = TILE_FLOOR;
        grid[nextR][nextC] = TILE_FLOOR;
        visited[nextR][nextC] = true;
        stack.push([nextR, nextC]);
      } else {
        stack.pop();
      }
    }

    // 3. Braid the maze slightly (open ~15% of interior walls for multiple loops and escape routes)
    for (let r = 2; r < ROWS - 2; r += 2) {
      for (let c = 2; c < COLS - 2; c += 2) {
        if (grid[r][c] === TILE_WALL && Math.random() < 0.28) {
          grid[r][c] = TILE_FLOOR;
        }
      }
    }

    // 4. Add Normal Doors (Light Blue, Passable) and Trap Doors (Dark Blue with Hazard, Impassable)
    for (let r = 2; r < ROWS - 2; r++) {
      for (let c = 2; c < COLS - 2; c++) {
        if (grid[r][c] === TILE_FLOOR && !(r <= 2 && c <= 2) && !(r >= ROWS - 3 && c >= COLS - 3)) {
          const isHCorridor = grid[r][c - 1] === TILE_WALL && grid[r][c + 1] === TILE_WALL && grid[r - 1][c] === TILE_FLOOR && grid[r + 1][c] === TILE_FLOOR;
          const isVCorridor = grid[r - 1][c] === TILE_WALL && grid[r + 1][c] === TILE_WALL && grid[r][c - 1] === TILE_FLOOR && grid[r][c + 1] === TILE_FLOOR;

          if ((isHCorridor || isVCorridor) && Math.random() < 0.20) {
            const isTrap = Math.random() < 0.25;
            grid[r][c] = isTrap ? TILE_TRAP_DOOR : TILE_NORMAL_DOOR;
          }
        }
      }
    }

    // 5. Set guaranteed clear start & exit
    grid[1][1] = TILE_FLOOR;
    grid[1][2] = TILE_FLOOR;
    grid[2][1] = TILE_FLOOR;

    const exitR = ROWS - 2;
    const exitC = COLS - 2;
    grid[exitR][exitC] = TILE_EXIT;
    grid[exitR][exitC - 1] = TILE_FLOOR;
    grid[exitR - 1][exitC] = TILE_FLOOR;

    // 5. Spawn 3 Energy Keys throughout the maze corridors
    const keys: Point[] = [];
    let attempts = 0;
    while (keys.length < 3 && attempts < 100) {
      attempts++;
      const kr = Math.floor(Math.random() * (ROWS - 2)) + 1;
      const kc = Math.floor(Math.random() * (COLS - 2)) + 1;
      if (grid[kr][kc] === TILE_FLOOR && (kr > 3 || kc > 3)) {
        if (!keys.some(k => k.x === kc && k.y === kr)) {
          keys.push({ x: kc, y: kr });
        }
      }
    }
    keysListRef.current = keys;

    // 6. Reset positions
    gridRef.current = grid;
    playerRef.current = { x: 1.5, y: 1.5, vx: 0, vy: 0, radius: 0.38 };
    monsterRef.current = {
      x: COLS - 2.5,
      y: ROWS - 2.5,
      speed: 0.042 + level * 0.006, // Scales gently with level
      radius: 0.42,
      animTime: 0
    };

    setKeysCollected(0);
    setTotalKeys(keys.length);
    setGameState('playing');
    sounds.playAlert();
  }, [COLS, ROWS]);

  // Initial maze creation
  useEffect(() => {
    generateNewMaze(mazeLevel);
  }, [generateNewMaze, mazeLevel]);

  // Controller command routing (via direct controllerBus subscription + props)
  useEffect(() => {
    const handleCommand = (cmd: any) => {
      if (!cmd) return;
      const { type, button, stick } = cmd;

      if (type === 'button_down') {
        if (gameState !== 'playing') {
          if (button === 'A' || button === 'START') {
            if (gameState === 'escaped') {
              setMazeLevel(l => l + 1);
              generateNewMaze(mazeLevel + 1);
            } else {
              generateNewMaze(mazeLevel);
            }
          } else if (button === 'SELECT' || button === 'B') {
            onBackToMenu();
          }
        } else {
          if (button === 'UP') inputRef.current.up = true;
          if (button === 'DOWN') inputRef.current.down = true;
          if (button === 'LEFT') inputRef.current.left = true;
          if (button === 'RIGHT') inputRef.current.right = true;
          if (button === 'SELECT') onBackToMenu();
        }
      } else if (type === 'button_up') {
        if (button === 'UP') inputRef.current.up = false;
        if (button === 'DOWN') inputRef.current.down = false;
        if (button === 'LEFT') inputRef.current.left = false;
        if (button === 'RIGHT') inputRef.current.right = false;
      } else if (type === 'stick_move' && stick) {
        inputRef.current.stickX = stick.x;
        inputRef.current.stickY = stick.y;
      } else if (type === 'stick_release') {
        inputRef.current.stickX = 0;
        inputRef.current.stickY = 0;
        inputRef.current.up = false;
        inputRef.current.down = false;
        inputRef.current.left = false;
        inputRef.current.right = false;
      }
    };

    if (controllerCommand) {
      handleCommand(controllerCommand);
    }

    const unsubscribe = controllerBus.subscribe(handleCommand);
    return () => unsubscribe();
  }, [controllerCommand, gameState, mazeLevel, generateNewMaze, onBackToMenu]);

  // Keyboard navigation fallback
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'w') inputRef.current.up = true;
      if (e.key === 'ArrowDown' || e.key === 's') inputRef.current.down = true;
      if (e.key === 'ArrowLeft' || e.key === 'a') inputRef.current.left = true;
      if (e.key === 'ArrowRight' || e.key === 'd') inputRef.current.right = true;
      if (e.key === 'Escape') onBackToMenu();
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'w') inputRef.current.up = false;
      if (e.key === 'ArrowDown' || e.key === 's') inputRef.current.down = false;
      if (e.key === 'ArrowLeft' || e.key === 'a') inputRef.current.left = false;
      if (e.key === 'ArrowRight' || e.key === 'd') inputRef.current.right = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [onBackToMenu]);

  // BFS Pathfinding for Monster
  const findShortestPathStep = (startCol: number, startRow: number, targetCol: number, targetRow: number, grid: number[][]): Point | null => {
    if (startCol === targetCol && startRow === targetRow) return null;

    const queue: [number, number][] = [[startCol, startRow]];
    const visited: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    const parent = new Map<string, [number, number]>();

    visited[startRow][startCol] = true;

    let found = false;
    while (queue.length > 0) {
      const [currC, currR] = queue.shift()!;
      if (currC === targetCol && currR === targetRow) {
        found = true;
        break;
      }

      const neighbors: [number, number][] = [
        [currC + 1, currR],
        [currC - 1, currR],
        [currC, currR + 1],
        [currC, currR - 1]
      ];

      for (const [nc, nr] of neighbors) {
        if (nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS && !visited[nr][nc]) {
          const tile = grid[nr][nc];
          // Passable if FLOOR, NORMAL_DOOR, or EXIT. Impassable if WALL or TRAP_DOOR
          if (tile !== TILE_WALL && tile !== TILE_TRAP_DOOR) {
            visited[nr][nc] = true;
            parent.set(`${nc},${nr}`, [currC, currR]);
            queue.push([nc, nr]);
          }
        }
      }
    }

    if (!found) return null;

    // Backtrack to find the first step from start
    let curr: [number, number] = [targetCol, targetRow];
    let prev: [number, number] = curr;
    while (curr[0] !== startCol || curr[1] !== startRow) {
      prev = curr;
      const p = parent.get(`${curr[0]},${curr[1]}`);
      if (!p) break;
      curr = p;
    }

    return { x: prev[0], y: prev[1] };
  };

  // Check tile collision for entity
  const isTilePassable = (col: number, row: number, grid: number[][]) => {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
    const tile = grid[row][col];
    // Normal door is passable (TILE_NORMAL_DOOR = 2). Trap door (3) and Wall (1) are impassable!
    return tile !== TILE_WALL && tile !== TILE_TRAP_DOOR;
  };

  // Main 60FPS Game Loop
  useEffect(() => {
    let animationFrameId: number;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let pathUpdateTick = 0;
    let nextMonsterTarget: Point | null = null;

    const loop = () => {
      const grid = gridRef.current;
      const player = playerRef.current;
      const monster = monsterRef.current;
      const particles = particlesRef.current;

      if (grid.length > 0 && gameState === 'playing') {
        // 1. Move Player
        let moveX = 0;
        let moveY = 0;
        const input = inputRef.current;

        if (input.up) moveY -= 1;
        if (input.down) moveY += 1;
        if (input.left) moveX -= 1;
        if (input.right) moveX += 1;

        if (Math.abs(input.stickX) > 0.10) moveX = input.stickX;
        if (Math.abs(input.stickY) > 0.10) moveY = input.stickY;

        const len = Math.hypot(moveX, moveY);
        const playerSpeed = 0.138;
        if (len > 0) {
          const dx = (moveX / Math.max(1, len)) * playerSpeed;
          const dy = (moveY / Math.max(1, len)) * playerSpeed;

          // Corner assist: Gently align to corridor center when navigating
          if (Math.abs(dx) > Math.abs(dy)) {
            const targetY = Math.floor(player.y) + 0.5;
            player.y += (targetY - player.y) * 0.2;
          } else if (Math.abs(dy) > Math.abs(dx)) {
            const targetX = Math.floor(player.x) + 0.5;
            player.x += (targetX - player.x) * 0.2;
          }

          // Horizontal movement check with collision radius
          const newX = player.x + dx;
          const checkCol = dx > 0 ? Math.floor(newX + player.radius) : Math.floor(newX - player.radius);
          const currentTopRow = Math.floor(player.y - player.radius * 0.6);
          const currentBottomRow = Math.floor(player.y + player.radius * 0.6);

          if (isTilePassable(checkCol, currentTopRow, grid) && isTilePassable(checkCol, currentBottomRow, grid)) {
            player.x = newX;
          }

          // Vertical movement check
          const newY = player.y + dy;
          const checkRow = dy > 0 ? Math.floor(newY + player.radius) : Math.floor(newY - player.radius);
          const currentLeftCol = Math.floor(player.x - player.radius * 0.6);
          const currentRightCol = Math.floor(player.x + player.radius * 0.6);

          if (isTilePassable(currentLeftCol, checkRow, grid) && isTilePassable(currentRightCol, checkRow, grid)) {
            player.y = newY;
          }
        }

        // 2. Check Key Pickups
        const keys = keysListRef.current;
        for (let i = keys.length - 1; i >= 0; i--) {
          const k = keys[i];
          const dist = Math.hypot(player.x - (k.x + 0.5), player.y - (k.y + 0.5));
          if (dist < 0.6) {
            keys.splice(i, 1);
            setKeysCollected(c => c + 1);
            sounds.playCollect();
            // Spawn celebration sparks
            for (let j = 0; j < 8; j++) {
              particles.push({
                x: k.x + 0.5,
                y: k.y + 0.5,
                vx: (Math.random() - 0.5) * 0.1,
                vy: (Math.random() - 0.5) * 0.1,
                life: 1.0,
                color: '#38bdf8'
              });
            }
          }
        }

        // 3. Move Monster with BFS Pathfinding
        monster.animTime += 0.05;
        pathUpdateTick++;
        if (pathUpdateTick % 12 === 0 || !nextMonsterTarget) {
          const monsterCol = Math.floor(monster.x);
          const monsterRow = Math.floor(monster.y);
          const playerCol = Math.floor(player.x);
          const playerRow = Math.floor(player.y);
          nextMonsterTarget = findShortestPathStep(monsterCol, monsterRow, playerCol, playerRow, grid);
        }

        if (nextMonsterTarget) {
          const targetX = nextMonsterTarget.x + 0.5;
          const targetY = nextMonsterTarget.y + 0.5;
          const mdx = targetX - monster.x;
          const mdy = targetY - monster.y;
          const mdist = Math.hypot(mdx, mdy);

          if (mdist > 0.05) {
            monster.x += (mdx / mdist) * monster.speed;
            monster.y += (mdy / mdist) * monster.speed;
          } else {
            monster.x = targetX;
            monster.y = targetY;
            nextMonsterTarget = null;
          }
        }

        // Calculate distance to update threat radar
        const distToPlayer = Math.hypot(player.x - monster.x, player.y - monster.y);
        setMonsterDistance(distToPlayer);

        // Check Caught by Monster
        if (distToPlayer < player.radius + monster.radius - 0.1) {
          sounds.playAlert();
          setGameState('caught');
        }

        // Check Exit Portal Reached
        const exitCol = COLS - 2;
        const exitRow = ROWS - 2;
        const distToExit = Math.hypot(player.x - (exitCol + 0.5), player.y - (exitRow + 0.5));
        if (distToExit < 0.65) {
          sounds.playWin();
          setGameState('escaped');
        }
      }

      // Update Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.03;
        if (p.life <= 0) particles.splice(i, 1);
      }

      // 4. Render Maze on TV Display
      const cw = canvas.width;
      const ch = canvas.height;
      ctx.clearRect(0, 0, cw, ch);

      const tileW = cw / COLS;
      const tileH = ch / ROWS;

      // Draw Tiles
      if (grid.length > 0) {
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const tile = grid[r][c];
            const px = c * tileW;
            const py = r * tileH;

            if (tile === TILE_WALL) {
              // Dark / Black Wall with sleek neon edge
              ctx.fillStyle = '#090d16';
              ctx.fillRect(px, py, tileW, tileH);
              ctx.strokeStyle = '#1e293b';
              ctx.lineWidth = 1;
              ctx.strokeRect(px, py, tileW, tileH);
            } else if (tile === TILE_NORMAL_DOOR) {
              // Passable Light/Medium Blue Door
              ctx.fillStyle = '#1e293b';
              ctx.fillRect(px, py, tileW, tileH);
              // Door frame & panel
              ctx.fillStyle = '#0284c7';
              ctx.fillRect(px + tileW * 0.15, py + tileH * 0.15, tileW * 0.7, tileH * 0.7);
              ctx.strokeStyle = '#38bdf8';
              ctx.lineWidth = 2;
              ctx.strokeRect(px + tileW * 0.15, py + tileH * 0.15, tileW * 0.7, tileH * 0.7);
              // Door handle
              ctx.fillStyle = '#ffffff';
              ctx.beginPath();
              ctx.arc(px + tileW * 0.7, py + tileH * 0.5, 3, 0, Math.PI * 2);
              ctx.fill();
            } else if (tile === TILE_TRAP_DOOR) {
              // Impassable Dark Blue Trap Door
              ctx.fillStyle = '#071527';
              ctx.fillRect(px, py, tileW, tileH);
              // Heavy dark blocked metal gate
              ctx.fillStyle = '#0c2a4d';
              ctx.fillRect(px + tileW * 0.15, py + tileH * 0.15, tileW * 0.7, tileH * 0.7);
              ctx.strokeStyle = '#ef4444';
              ctx.lineWidth = 2;
              ctx.strokeRect(px + tileW * 0.15, py + tileH * 0.15, tileW * 0.7, tileH * 0.7);
              // Hazard X
              ctx.beginPath();
              ctx.moveTo(px + tileW * 0.25, py + tileH * 0.25);
              ctx.lineTo(px + tileW * 0.75, py + tileH * 0.75);
              ctx.moveTo(px + tileW * 0.75, py + tileH * 0.25);
              ctx.lineTo(px + tileW * 0.25, py + tileH * 0.75);
              ctx.stroke();
            } else if (tile === TILE_EXIT) {
              // Golden Exit Sanctuary
              ctx.fillStyle = '#1e293b';
              ctx.fillRect(px, py, tileW, tileH);
              ctx.fillStyle = 'rgba(234, 179, 8, 0.25)';
              ctx.fillRect(px, py, tileW, tileH);
              ctx.strokeStyle = '#eab308';
              ctx.lineWidth = 3;
              ctx.strokeRect(px + 4, py + 4, tileW - 8, tileH - 8);
              // Star in exit
              ctx.fillStyle = '#fde047';
              ctx.beginPath();
              ctx.arc(px + tileW * 0.5, py + tileH * 0.5, tileW * 0.25, 0, Math.PI * 2);
              ctx.fill();
            } else {
              // Floor
              ctx.fillStyle = '#0f172a';
              ctx.fillRect(px, py, tileW, tileH);
            }
          }
        }
      }

      // Draw Energy Keys
      keysListRef.current.forEach(k => {
        const kpx = (k.x + 0.5) * tileW;
        const kpy = (k.y + 0.5) * tileH;
        ctx.fillStyle = '#38bdf8';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(kpx, kpy, tileW * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Draw Particles
      particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.beginPath();
        ctx.arc(p.x * tileW, p.y * tileH, 4, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1.0;

      // Draw Player (White Circle with Two Eyes & Smiling Mouth)
      const ppx = player.x * tileW;
      const ppy = player.y * tileH;
      const pr = player.radius * Math.min(tileW, tileH);

      // Player Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.arc(ppx + 3, ppy + 3, pr, 0, Math.PI * 2);
      ctx.fill();

      // Player White Circle Body
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ppx, ppy, pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Two Eyes / Dots
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(ppx - pr * 0.35, ppy - pr * 0.2, pr * 0.16, 0, Math.PI * 2);
      ctx.arc(ppx + pr * 0.35, ppy - pr * 0.2, pr * 0.16, 0, Math.PI * 2);
      ctx.fill();

      // Simple Smiling Mouth
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(ppx, ppy + pr * 0.1, pr * 0.45, 0.1 * Math.PI, 0.9 * Math.PI, false);
      ctx.stroke();

      // Draw Monster (Circular Scary Pursuer)
      const mpx = monster.x * tileW;
      const mpy = monster.y * tileH;
      const mr = monster.radius * Math.min(tileW, tileH);

      // Dark Pulsing Aura
      const pulse = Math.sin(monster.animTime * 4) * 4;
      ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
      ctx.beginPath();
      ctx.arc(mpx, mpy, mr + 8 + pulse, 0, Math.PI * 2);
      ctx.fill();

      // Monster Body
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(mpx, mpy, mr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#7f1d1d';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Monster Scary Glowing Red Eyes
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(mpx - mr * 0.35, mpy - mr * 0.25, mr * 0.22, 0, Math.PI * 2);
      ctx.arc(mpx + mr * 0.35, mpy - mr * 0.25, mr * 0.22, 0, Math.PI * 2);
      ctx.fill();

      // Red pupils
      ctx.fillStyle = '#991b1b';
      ctx.beginPath();
      ctx.arc(mpx - mr * 0.35, mpy - mr * 0.25, mr * 0.1, 0, Math.PI * 2);
      ctx.arc(mpx + mr * 0.35, mpy - mr * 0.25, mr * 0.1, 0, Math.PI * 2);
      ctx.fill();

      // Jagged Scary Teeth / Mouth
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(mpx, mpy + mr * 0.25, mr * 0.45, 0, Math.PI, false);
      ctx.fill();

      // Teeth
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(mpx - mr * 0.3, mpy + mr * 0.25);
      ctx.lineTo(mpx - mr * 0.15, mpy + mr * 0.45);
      ctx.lineTo(mpx, mpy + mr * 0.25);
      ctx.lineTo(mpx + mr * 0.15, mpy + mr * 0.45);
      ctx.lineTo(mpx + mr * 0.3, mpy + mr * 0.25);
      ctx.fill();

      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [gameState, COLS, ROWS]);

  // TV Canvas resize handler
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="relative w-full h-full flex flex-col justify-between bg-slate-950 text-white select-none overflow-hidden" dir="rtl">
      {/* Top Header */}
      <header className="relative z-20 flex items-center justify-between px-6 py-3 bg-slate-900/90 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToMenu}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 hover:text-white border border-slate-700 transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
            <span>العودة للمكتبة [SELECT]</span>
          </button>
          <div className="h-6 w-px bg-slate-800" />
          <h2 className="text-lg font-black text-white flex items-center gap-2">
            <Compass className="w-5 h-5 text-indigo-400" />
            متاهة الهروب الإجرائية (Maze Chase)
          </h2>
        </div>

        {/* Center Threat & Objective Radar */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-2xl bg-slate-800/80 border border-slate-700">
            <Zap className="w-4 h-4 text-cyan-400" />
            <span className="text-xs text-slate-300">مفاتيح الطاقة:</span>
            <span className="text-base font-black text-cyan-400 font-mono">
              {keysCollected} / {totalKeys}
            </span>
          </div>

          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-2xl bg-slate-800/80 border border-slate-700">
            <Skull className="w-4 h-4 text-red-400 animate-pulse" />
            <span className="text-xs text-slate-300">مسافة الوحش:</span>
            <span className={`text-base font-black font-mono ${monsterDistance < 4 ? 'text-red-500 animate-ping' : 'text-emerald-400'}`}>
              {Math.max(1, Math.round(monsterDistance))}م
            </span>
          </div>
        </div>

        {/* Level Tag */}
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="px-3 py-1 rounded-xl bg-indigo-950 text-indigo-300 border border-indigo-500/40 font-bold">
            المستوى {mazeLevel}
          </span>
          <button
            type="button"
            onClick={() => generateNewMaze(mazeLevel)}
            className="flex items-center gap-1.5 text-xs text-indigo-300 hover:text-white"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>توليد متاهة جديدة</span>
          </button>
        </div>
      </header>

      {/* Main Canvas Area */}
      <div className="relative flex-1 w-full h-full min-h-[460px] bg-slate-950">
        <canvas ref={canvasRef} className="w-full h-full block" />

        {/* OVERLAY: CAUGHT BY MONSTER */}
        {gameState === 'caught' && (
          <div className="absolute inset-0 z-30 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
            <div className="max-w-md w-full bg-slate-900 border border-red-500/50 rounded-3xl p-8 shadow-2xl space-y-5">
              <div className="w-16 h-16 rounded-2xl bg-red-500/20 border border-red-500/40 text-red-500 mx-auto flex items-center justify-center animate-bounce">
                <Skull className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-2xl font-black text-white">تم الإمساك بك!</h3>
                <p className="text-xs text-slate-400">
                  تمكن الوحش من تعقبك عبر ممرات المتاهة. حاول الهروب عبر الأبواب الزرقاء المفتوحة وتفادي الفخاخ!
                </p>
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => generateNewMaze(mazeLevel)}
                  className="px-6 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm shadow flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>توليد متاهة جديدة والبدء [A]</span>
                </button>
                <button
                  type="button"
                  onClick={onBackToMenu}
                  className="px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm border border-slate-700"
                >
                  الخروج للمكتبة [B]
                </button>
              </div>
            </div>
          </div>
        )}

        {/* OVERLAY: ESCAPED / VICTORY */}
        {gameState === 'escaped' && (
          <div className="absolute inset-0 z-30 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
            <div className="max-w-md w-full bg-slate-900 border border-emerald-500/50 rounded-3xl p-8 shadow-2xl space-y-5">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 mx-auto flex items-center justify-center">
                <Trophy className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-2xl font-black text-white">نجحت في الهروب!</h3>
                <p className="text-xs text-emerald-400 font-bold">
                  وصلت إلى بوابة الملاذ الذهبية بأمان متجاوزاً مطاردة الوحش.
                </p>
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setMazeLevel(l => l + 1);
                    generateNewMaze(mazeLevel + 1);
                  }}
                  className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow flex items-center gap-2"
                >
                  <span>المستوى التالي الأكثر تحدياً [A]</span>
                </button>
                <button
                  type="button"
                  onClick={onBackToMenu}
                  className="px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm border border-slate-700"
                >
                  الخروج للمكتبة [B]
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Instructions */}
      <footer className="relative z-10 px-6 py-2.5 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono">
        <div className="flex items-center gap-4">
          <span className="text-slate-300 font-bold">عناصر الخريطة:</span>
          <span className="text-sky-400 flex items-center gap-1">■ الأبواب الزرقاء الفاتحة (نافذة وممر مفتوح)</span>
          <span>·</span>
          <span className="text-red-400 flex items-center gap-1">■ الأبواب الزرقاء الداكنة (فخاخ مغلقة غير قابلة للمرور)</span>
          <span>·</span>
          <span className="text-yellow-400">★ البوابة الذهبية (مخرج النجاة)</span>
        </div>
        <div className="text-indigo-400">تحكم باللاعب الأبيض عبر عصا الهاتف أو الأسهم</div>
      </footer>
    </div>
  );
}
