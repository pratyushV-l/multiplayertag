const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

// --- GAME CONSTANTS (Must match client ideally, but server is authority) ---
const GRAVITY = 0.6;
const JUMP_FORCE = -15;
const MOVE_SPEED = 6;
const FRICTION = 0.85;
const PLAYER_SIZE = 30;
const TAG_COOLDOWN_FRAMES = 60;
const ROOM_WIDTH = 1200; // Standardize for logic
const ROOM_HEIGHT = 800;

// Helper to generate IDs
const generateRoomId = () => Math.random().toString(36).substring(2, 6).toUpperCase();

// Colors for players
const COLORS = ["#3b82f6", "#22c55e", "#eab308", "#a855f7"];

class GameRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = new Map(); // socketId -> Player
    this.platforms = [
      { x: 0, y: ROOM_HEIGHT - 40, width: ROOM_WIDTH, height: 40 },
      { x: 100, y: ROOM_HEIGHT - 150, width: 200, height: 20 },
      { x: ROOM_WIDTH - 300, y: ROOM_HEIGHT - 150, width: 200, height: 20 },
      { x: ROOM_WIDTH / 2 - 150, y: ROOM_HEIGHT - 280, width: 300, height: 20 },
      { x: 50, y: ROOM_HEIGHT - 400, width: 150, height: 20 },
      { x: ROOM_WIDTH - 200, y: ROOM_HEIGHT - 400, width: 150, height: 20 },
      { x: ROOM_WIDTH / 2 - 50, y: ROOM_HEIGHT - 520, width: 100, height: 20 },
    ];
    this.gameLoopInterval = null;
    this.started = false;
  }

  addPlayer(socketId) {
    if (this.players.size >= 4) return null;
    
    const index = this.players.size;
    const player = {
      id: socketId,
      index: index,
      x: 100 + index * 100,
      y: 100,
      width: PLAYER_SIZE,
      height: PLAYER_SIZE,
      vx: 0,
      vy: 0,
      color: COLORS[index],
      isIt: false,
      isGrounded: false,
      facingRight: true,
      tagCooldown: 0,
      score: 0,
      inputs: { up: false, down: false, left: false, right: false },
    };
    
    this.players.set(socketId, player);
    return player;
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
    if (this.players.size === 0) {
      this.stop();
    }
  }

  startGame() {
    if (this.started) return;
    this.started = true;
    
    // Pick random IT
    const pArray = Array.from(this.players.values());
    if (pArray.length > 0) {
        const itIndex = Math.floor(Math.random() * pArray.length);
        pArray[itIndex].isIt = true;
    }

    this.gameLoopInterval = setInterval(() => {
      this.update();
    }, 1000 / 60);
  }

  stop() {
    clearInterval(this.gameLoopInterval);
    this.started = false;
  }

  update() {
    const playerArray = Array.from(this.players.values());

    playerArray.forEach(p => {
      // 1. Controls
      if (p.inputs.left) {
        p.vx -= 0.8; 
        p.facingRight = false;
      }
      if (p.inputs.right) {
        p.vx += 0.8;
        p.facingRight = true;
      }
      if (p.inputs.up && p.isGrounded) {
         p.vy = JUMP_FORCE;
         p.isGrounded = false;
      }

      // 2. Physics
      p.vy += GRAVITY;
      p.vx *= FRICTION; 

      if (p.vx > MOVE_SPEED) p.vx = MOVE_SPEED;
      if (p.vx < -MOVE_SPEED) p.vx = -MOVE_SPEED;
            
      p.x += p.vx;
      p.y += p.vy;

      // 3. Boundaries
      if (p.x < 0) { p.x = 0; p.vx = 0; }
      if (p.x + p.width > ROOM_WIDTH) { p.x = ROOM_WIDTH - p.width; p.vx = 0; }
      
      // 4. Collisions
      p.isGrounded = false;
      this.platforms.forEach((plat) => {
        if (
          p.x < plat.x + plat.width &&
          p.x + p.width > plat.x &&
          p.y < plat.y + plat.height &&
          p.y + p.height > plat.y
        ) {
          const distL = (p.x + p.width) - plat.x;
          const distR = (plat.x + plat.width) - p.x;
          const distT = (p.y + p.height) - plat.y;
          const distB = (plat.y + plat.height) - p.y;
          
          const min = Math.min(distL, distR, distT, distB);
          
          if (min === distT) {
              if (p.vy >= 0) {
                  p.y = plat.y - p.height;
                  p.vy = 0;
                  p.isGrounded = true;
              }
          } else if (min === distB) {
               if (p.vy < 0) {
                  p.y = plat.y + plat.height;
                  p.vy = 0;
               }
          } else if (min === distL) {
              p.x = plat.x - p.width;
              p.vx = 0;
          } else if (min === distR) {
              p.x = plat.x + plat.width;
              p.vx = 0;
          }
        }
      });
      
      if (p.y > ROOM_HEIGHT) {
        p.y = 0;
        p.x = ROOM_WIDTH / 2;
        p.vy = 0;
      }

      // 5. Tag Logic
      playerArray.forEach((other) => {
        if (p.id === other.id) return;
        
        if (p.tagCooldown > 0) p.tagCooldown--;

        if (
            p.x < other.x + other.width &&
            p.x + p.width > other.x &&
            p.y < other.y + other.height &&
            p.y + p.height > other.y
        ) {
            if (p.isIt && !other.isIt && p.tagCooldown === 0 && other.tagCooldown === 0) {
                p.isIt = false;
                other.isIt = true;
                
                const dirX = Math.sign(other.x - p.x) || 1;
                other.vx = dirX * 10;
                other.vy = -5;
                p.vx = -dirX * 5;

                p.tagCooldown = TAG_COOLDOWN_FRAMES;
                other.tagCooldown = TAG_COOLDOWN_FRAMES;
            }
        }
      });
    });
  }

  getState() {
    return {
      players: Array.from(this.players.values()),
      platforms: this.platforms
    };
  }
}

const rooms = new Map(); // code -> GameRoom

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(server);

  io.on("connection", (socket) => {
    console.log("Client connected", socket.id);

    socket.on("createRoom", () => {
      const code = generateRoomId();
      const room = new GameRoom(code);
      rooms.set(code, room);
      
      socket.join(code);
      room.addPlayer(socket.id);
      
      socket.emit("roomCreated", code);
      io.to(code).emit("updateState", room.getState());
    });

    socket.on("joinRoom", (code) => {
      const room = rooms.get(code);
      if (room && room.players.size < 4) {
        socket.join(code);
        room.addPlayer(socket.id);
        socket.emit("roomJoined", code);
        
        // Start game automatically when someone joins for now, or wait? 
        // Let's just run it if > 1 player or force start
        if (room.players.size >= 2 && !room.started) {
             room.startGame();
             // Broadcast Game Loop
             room.broadcastInterval = setInterval(() => {
                io.to(code).emit("updateState", room.getState());
             }, 1000 / 60);
        }
      } else {
        socket.emit("error", "Room not found or full");
      }
    });

    socket.on("input", ({ code, inputs }) => {
       const room = rooms.get(code);
       if (room) {
           const player = room.players.get(socket.id);
           if (player) {
               player.inputs = inputs;
           }
       }
    });

    socket.on("disconnect", () => {
       // Find room socket was in
       rooms.forEach((room, code) => {
           if (room.players.has(socket.id)) {
               room.removePlayer(socket.id);
               if (room.players.size === 0) {
                   clearInterval(room.broadcastInterval);
                   rooms.delete(code);
               }
           }
       });
    });
  });

  const port = process.env.PORT || 3000;
  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://localhost:${port}`);
  });
});
