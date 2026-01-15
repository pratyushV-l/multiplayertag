"use client";

import { useEffect, useRef, useState } from "react";
import io, { Socket } from "socket.io-client";

// --- Types ---
type GameState = "MENU" | "LOBBY" | "PLAYING" | "GAMEOVER";

interface Player {
  id: string; // Socket ID
  index: number;
  x: number;
  y: number;
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
  
  const gameStateRef = useRef<GameState>("MENU");
  const [gameState, setGameState] = useState<GameState>("MENU");
  
  // Sync Ref with State
  useEffect(() => {
      gameStateRef.current = gameState;
  }, [gameState]);

  const [roomCode, setRoomCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [myId, setMyId] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [playerCount, setPlayerCount] = useState(0);

  // Game Logic State (Refs for rendering)
  const serverStateRef = useRef<ServerState>({ players: [], platforms: [] });
  // We keep a separate "Local Player" state that is ahead of the server
  const myPlayerRef = useRef<Player | null>(null);

  const keysRef = useRef<{ [key: string]: boolean }>({});
  const animationFrameRef = useRef<number>(0);

  // --- Socket Initialization ---
  useEffect(() => {
    // Only init once
    /* // In Next.js dev mode specifically, we might duplicate connections on HMR.
       // Ideally we put this outside component or use a singleton pattern.
       // For this simple example, we'll just check if it exists.
    */
    const initSocket = async () => {
        await fetch("/api/socket"); // Trigger Next.js API if we were using it, but we are using custom server
        socket = io();

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
            // 1. Update My Player Local State from Server (Authoritative traits only)
            if (myPlayerRef.current) {
                const meOnServer = state.players.find(p => p.id === socket.id);
                if (meOnServer) {
                    myPlayerRef.current.isIt = meOnServer.isIt;
                    myPlayerRef.current.tagCooldown = meOnServer.tagCooldown;
                    
                    // Anti-Desync: Snap if too far
                    if (Math.abs(meOnServer.x - myPlayerRef.current.x) > 200 || 
                        Math.abs(meOnServer.y - myPlayerRef.current.y) > 200) {
                         myPlayerRef.current.x = meOnServer.x;
                         myPlayerRef.current.y = meOnServer.y;
                    }
                }
            } else {
                // First initialization
                const me = state.players.find(p => p.id === socket.id);
                if (me) {
                    myPlayerRef.current = { ...me, isGrounded: false };
                }
            }

            serverStateRef.current = state;
            setPlayerCount(state.players.length);
        });

        socket.on("error", (msg) => {
            setErrorMsg(msg);
            setTimeout(() => setErrorMsg(""), 3000);
        });
    };
    
    initSocket();

    return () => {
        if (socket) socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Input Handling ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "w", "a", "s", "d"].includes(e.key)) {
         // e.preventDefault(); // Might block typing in input fields if not careful
         if (gameState === "PLAYING") e.preventDefault();
      }
      keysRef.current[e.key] = true;
      sendInput();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.key] = false;
      sendInput();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [gameState, roomCode]);

  const sendInput = () => {
      if (!socket || !roomCode) return;
      
      const keys = keysRef.current;
      const inputs = {
          up: keys["w"] || keys["ArrowUp"],
          down: keys["s"] || keys["ArrowDown"],
          left: keys["a"] || keys["ArrowLeft"],
          right: keys["d"] || keys["ArrowRight"],
      };
      
      socket.emit("input", { code: roomCode, inputs });
  };

  // --- Render Loop ---
  useEffect(() => {
     const render = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Resize
        if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }

        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);

        // Define a Camera/Scale? 
        // For now, let's map the server coordinates (0-1200, 0-800) to the screen
        // Center the view or scale to fit?
        // Let's "Scale to Fit" for simplicity
        const scaleX = width / 1200;
        const scaleY = height / 800;
        const scale = Math.min(scaleX, scaleY);
        
        const offsetX = (width - 1200 * scale) / 2;
        const offsetY = (height - 800 * scale) / 2;
        
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        // Draw Background Area
        ctx.fillStyle = "#1e1e20";
        ctx.fillRect(0, 0, 1200, 800);

        // Draw Platforms
        const { platforms, players } = serverStateRef.current;
        
        platforms.forEach(plat => {
            ctx.fillStyle = "#4b5563"; 
            if (plat.y > 600) ctx.fillStyle = "#374151"; 
            ctx.fillRect(plat.x, plat.y, plat.width, plat.height);
            ctx.fillStyle = "rgba(0,0,0,0.2)";
            ctx.fillRect(plat.x, plat.y + plat.height - 4, plat.width, 4);
        });

        // Draw Players
        players.forEach(p => {
            if (p.isIt) {
                ctx.shadowBlur = 15;
                ctx.shadowColor = "#ef4444";
                ctx.fillStyle = "#ef4444"; 
            } else {
                ctx.shadowBlur = 0;
                ctx.fillStyle = p.color;
            }

            ctx.fillRect(p.x, p.y, p.width, p.height);
            
            ctx.shadowBlur = 0;
            ctx.fillStyle = "white";
            const eyeOffset = p.facingRight ? (p.width - 12) : 4;
            ctx.fillRect(p.x + eyeOffset, p.y + 6, 8, 8);
            
            if (p.id === myId) {
                // Indicator for "ME"
                ctx.beginPath();
                ctx.moveTo(p.x + p.width/2, p.y - 15);
                ctx.lineTo(p.x + p.width/2 - 5, p.y - 25);
                ctx.lineTo(p.x + p.width/2 + 5, p.y - 25);
                ctx.fillStyle = "white";
                ctx.fill();
            }

             if (p.isIt) {
                ctx.fillStyle = "white";
                ctx.font = "bold 12px sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("IT!", p.x + p.width/2, p.y - 10);
            }
        });

        ctx.restore();
        
        animationFrameRef.current = requestAnimationFrame(render);
     };

     render();
     return () => cancelAnimationFrame(animationFrameRef.current);
  }, []);

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
      if (socket && roomCode) {
          socket.emit("startGame", roomCode);
      }
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
                     <div className="mt-4">playerCount}/4</p>
                        {playerCount-2">Players: {serverStateRef.current.players.length}/4</p>
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
