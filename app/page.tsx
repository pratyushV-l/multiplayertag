"use client";

import { useEffect, useRef, useState } from "react";
import io, { Socket } from "socket.io-client";

// --- Types ---
type GameState = "MENU" | "LOBBY" | "PLAYING" | "GAMEOVER";

interface Player {
  id: string; // Socket ID
  index: number;
  x: number;
  y: number; // Server/World Coordinates
  width: number;
  height: number;
  vx: number;
  vy: number;
  color: string;
  isIt: boolean;
  facingRight: boolean;
  tagCooldown: number;
  score: number;
  isGrounded?: boolean; // Client-side tracking
}

interface Platform {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ServerState {
  players: Player[];
  platforms: Platform[];
}

// CONSTANTS (Shared logic)
const GRAVITY = 0.6;
const JUMP_FORCE = -15;
const MOVE_SPEED = 6;
const FRICTION = 0.85;
const ROOM_WIDTH = 1200;
const ROOM_HEIGHT = 800;

let socket: Socket;

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // UI State
  const [gameState, setGameState] = useState<GameState>("MENU");
  const [roomCode, setRoomCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [myId, setMyId] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [playerCount, setPlayerCount] = useState(0);

  // Game Logic State
  const serverStateRef = useRef<ServerState>({ players: [], platforms: [] });
  // We keep a separate "Local Player" state that is ahead of the server
  const myPlayerRef = useRef<Player | null>(null);
  
  const keysRef = useRef<{ [key: string]: boolean }>({});
  const animationFrameRef = useRef<number>(0);

  // --- Socket Initialization ---
  useEffect(() => {
    const initSocket = async () => {
        // await fetch("/api/socket"); // Not needed for custom server
        socket = io({
             transports: ['websocket'], // Force websocket for better perf
             reconnectionAttempts: 5
        });

        socket.on("connect", () => {
            console.log("Connected:", socket.id);
            setMyId(socket.id || "");
        });

        socket.on("roomCreated", (code) => {
            setRoomCode(code);
            setGameState("LOBBY");
        });

        socket.on("roomJoined", (code) => {
            setRoomCode(code);
            setGameState("LOBBY");
        });

        socket.on("gameStarted", () => {
             setGameState("PLAYING");
        });

        socket.on("updateState", (state: ServerState) => {
            setPlayerCount(state.players.length);

            // Check if WE are "IT" according to server, update our local flag if so
            // We ONLY take "IsIt" and "TagCooldown" from server for ourself
            // For others, we take everything.
            
            if (myPlayerRef.current) {
                const meOnServer = state.players.find(p => p.id === socket.id);
                if (meOnServer) {
                    myPlayerRef.current.isIt = meOnServer.isIt;
                    myPlayerRef.current.tagCooldown = meOnServer.tagCooldown;
                    // We DO NOT overwrite x/y with server data to avoid rubberbanding
                    // unless the deviation is huge? (Desync fix)
                    
                    // Simple desync check: if > 200px off, snap
                    if (Math.abs(meOnServer.x - myPlayerRef.current.x) > 200 || 
                        Math.abs(meOnServer.y - myPlayerRef.current.y) > 200) {
                         myPlayerRef.current.x = meOnServer.x;
                         myPlayerRef.current.y = meOnServer.y;
                    }
                }
            } else {
                // Initialize my player if I exist in server state
                const me = state.players.find(p => p.id === socket.id);
                if (me) {
                    // clone deeply to detach from ref updates
                    myPlayerRef.current = { ...me, isGrounded: false };
                }
            }

            // Store others
            serverStateRef.current = state;
        });

        socket.on("error", (msg) => {
            setErrorMsg(msg);
            setTimeout(() => setErrorMsg(""), 3000);
        });
    };
    
    initSocket();

    return () => {
         // Prevent disconnecting in development to avoid Strict Mode issues
         // If we disconnect here, the double-mount in Strict Mode kills the connection
         // while the user might still be interacting or the second mount tries to use it.
         if (socket) {
             socket.off("connect");
             socket.off("roomCreated");
             socket.off("roomJoined");
             socket.off("gameStarted");
             socket.off("updateState");
             socket.off("error");
         }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once

  // --- Input Handling ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "w", "a", "s", "d"].includes(e.key)) {
         if (gameState === "PLAYING") e.preventDefault();
      }
      keysRef.current[e.key] = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.key] = false;
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [gameState]);


  // --- Game Loop (Client Physics) ---
  useEffect(() => {
     let lastUpdate = 0;

     const updatePhysics = () => {
        if (!myPlayerRef.current) return;
        const p = myPlayerRef.current;
        const keys = keysRef.current;
        const platforms = serverStateRef.current.platforms;

        // 1. Controls
        if (keys["a"] || keys["ArrowLeft"]) {
            p.vx -= 0.8;
            p.facingRight = false;
        }
        if (keys["d"] || keys["ArrowRight"]) {
            p.vx += 0.8;
            p.facingRight = true;
        }
        if ((keys["w"] || keys["ArrowUp"]) && p.isGrounded) {
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
        platforms.forEach((plat) => {
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
    
        // 5. Send Update to Server (throttled to 30hz or 60hz)
        const now = Date.now();
        if (now - lastUpdate > 15 && socket && roomCode) { 
            lastUpdate = now;
            socket.emit("updatePlayer", { 
                code: roomCode, 
                data: {
                    x: Math.round(p.x), 
                    y: Math.round(p.y), 
                    vx: p.vx, 
                    vy: p.vy, 
                    facingRight: p.facingRight 
                }
            });
        }
     };

     const render = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        if (gameState === "PLAYING") {
             updatePhysics();
        }

        // Resize
        if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        const width = canvas.width;
        const height = canvas.height;

        // Draw Map
        ctx.clearRect(0, 0, width, height);

        const scaleX = width / ROOM_WIDTH;
        const scaleY = height / ROOM_HEIGHT;
        const scale = Math.min(scaleX, scaleY);
        const offsetX = (width - ROOM_WIDTH * scale) / 2;
        const offsetY = (height - ROOM_HEIGHT * scale) / 2;
        
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        // BG
        ctx.fillStyle = "#1e1e20";
        ctx.fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);

        // Platforms
        const { platforms, players } = serverStateRef.current;
        platforms.forEach(plat => {
            ctx.fillStyle = "#4b5563"; 
            if (plat.y > 600) ctx.fillStyle = "#374151"; 
            ctx.fillRect(plat.x, plat.y, plat.width, plat.height);
            ctx.fillStyle = "rgba(0,0,0,0.2)";
            ctx.fillRect(plat.x, plat.y + plat.height - 4, plat.width, 4);
        });

        // Loop over server players
        players.forEach(p => {
            // Is this me? If so, use my LOCAL state for rendering to be silky smooth
            let renderP = p;
            if (p.id === myId && myPlayerRef.current) {
                renderP = myPlayerRef.current;
            }

            // Draw
            if (renderP.isIt) {
                ctx.shadowBlur = 15;
                ctx.shadowColor = "#ef4444";
                ctx.fillStyle = "#ef4444"; 
            } else {
                ctx.shadowBlur = 0;
                ctx.fillStyle = renderP.color;
            }

            ctx.fillRect(renderP.x, renderP.y, renderP.width, renderP.height);
            
            ctx.shadowBlur = 0;
            ctx.fillStyle = "white";
            const eyeOffset = renderP.facingRight ? (renderP.width - 12) : 4;
            ctx.fillRect(renderP.x + eyeOffset, renderP.y + 6, 8, 8);
            
            if (p.id === myId) {
                ctx.beginPath();
                ctx.moveTo(renderP.x + renderP.width/2, renderP.y - 15);
                ctx.lineTo(renderP.x + renderP.width/2 - 5, renderP.y - 25);
                ctx.lineTo(renderP.x + renderP.width/2 + 5, renderP.y - 25);
                ctx.fillStyle = "white";
                ctx.fill();
            }

             if (renderP.isIt) {
                ctx.fillStyle = "white";
                ctx.font = "bold 12px sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("IT!", renderP.x + renderP.width/2, renderP.y - 10);
            }
        });

        ctx.restore();
        
        animationFrameRef.current = requestAnimationFrame(render);
     };

     render();
     return () => cancelAnimationFrame(animationFrameRef.current);
  }, [gameState, myId, roomCode]); // Re-bind if important IDs change

  // --- UI Handlers ---
  const handleCreateGame = () => {
    socket.emit("createRoom");
  };

  const handleJoinGame = () => {
      if (inputCode.length === 4) {
          socket.emit("joinRoom", inputCode.toUpperCase());
      } else {
          setErrorMsg("Code must be 4 characters");
      }
  };

  const handleStartGame = () => {
      socket.emit("startGame", roomCode);
  };

  return (
    <main className="relative w-full h-screen bg-black overflow-hidden text-zinc-100 font-sans select-none">
      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* --- MENU UI --- */}
      {gameState === "MENU" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-20">
          <h1 className="text-6xl font-black mb-2 text-transparent bg-clip-text bg-gradient-to-br from-blue-500 to-purple-500">
            TAG ONLINE
          </h1>
          <p className="text-zinc-500 mb-10">Play with friends anywhere</p>

          <div className="flex flex-col gap-4 w-64">
            <button 
                onClick={handleCreateGame}
                className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold transition shadow-lg shadow-blue-900/20"
            >
                Create Game
            </button>
            
            <div className="flex gap-2">
                <input 
                    type="text" 
                    value={inputCode}
                    onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                    placeholder="CODE"
                    maxLength={4}
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 text-center font-mono text-xl focus:outline-none focus:border-purple-500"
                />
                <button 
                    onClick={handleJoinGame}
                    className="px-6 bg-zinc-700 hover:bg-zinc-600 rounded-lg font-bold"
                >
                    Join
                </button>
            </div>
            
            {errorMsg && <p className="text-red-500 text-sm text-center">{errorMsg}</p>}
          </div>
        </div>
      )}

    {/* --- PLAYING/LOBBY UI --- */}
      {(gameState === "LOBBY" || gameState === "PLAYING") && (
         <div className="absolute top-4 left-4 z-10">
             <div className="bg-zinc-900/80 p-4 rounded-lg border border-zinc-800">
                 <p className="text-zinc-400 text-xs uppercase mb-1">Room Code</p>
                 <p className="text-3xl font-mono font-bold tracking-widest select-all">{roomCode}</p>
                 
                 {gameState === "LOBBY" && (
                     <div className="mt-4">
                        <p className="text-zinc-300 mb-2">Players: {playerCount}/4</p>
                        {serverStateRef.current.players.length >= 2 ? (
                            <button 
                                onClick={handleStartGame}
                                className="w-full py-2 bg-green-600 hover:bg-green-500 rounded font-bold text-sm transition animate-pulse"
                            >
                                START GAME
                            </button>
                        ) : (
                            <p className="text-xs text-yellow-500">Need 2+ players</p>
                        )}
                     </div>
                 )}
                 
                 {gameState === "PLAYING" && <p className="text-xs text-green-500 mt-2">GAME IN PROGRESS</p>}
             </div>
         </div>
      )}
    </main>
  );
}
