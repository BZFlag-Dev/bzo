# 3D Multiplayer Tank Game

A real-time 3D multiplayer tank game built with Three.js and WebSocket, featuring server-side validation.

## Features

- 3D tank avatars with movement controls
- Real-time multiplayer synchronization
- Shooting mechanics with projectile physics
- Server-side validation:
  - Kill detection
  - Shot position validation
  - Movement speed validation
- Fixed map with boundaries

## Installation

```bash
npm install
```

## Running the Game

### Production Mode

```bash
npm start
```

Then open your browser to `http://localhost:3000`

### Development Mode

```bash
npm run dev
```

Runs the server with auto-restart on file changes using nodemon. Open your browser to `http://localhost:3000`

## Controls

- **W/S** - Move forward/backward
- **A/D** - Turn left/right
- **Space** - Shoot
- **Tab** - Jump
- **Mouse** - Look around (optional)

## Game Rules

- Each player spawns with a tank
- Tanks can move and shoot
- Getting hit respawns you at a random location
- Server validates all movements and shots to prevent cheating
