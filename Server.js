const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = {};
let bullets = [];
let obstacles = [];
let currentArena = 1;
let gameState = 'MENU';
let winnerMessage = '';

let p1SocketId = null;
let p2SocketId = null;

class Obstacle {
    constructor(x, y, width, height, dx = 0, dy = 0) {
        this.x = x; this.y = y; this.width = width; this.height = height;
        this.dx = dx; this.dy = dy;
    }
    update() {
        this.x += this.dx; this.y += this.dy;
        if (this.x < 100 || this.x + this.width > 700) this.dx *= -1;
        if (this.y < 50 || this.y + this.height > 550) this.dy *= -1;
    }
}

class Gorilla {
    constructor(id, num, x, y, color, dx, dy, rotationSpeed) {
        this.id = id; this.num = num; this.x = x; this.y = y; this.color = color;
        this.dx = dx; this.dy = dy; this.angle = 0; this.rotationSpeed = rotationSpeed;
        this.lives = 3; this.lastShotTime = 0;
        this.radius = 20; // Collision size for the gorilla
    }
    update() {
        if (gameState !== 'PLAYING') return;
        this.x += this.dx; this.y += this.dy; this.angle += this.rotationSpeed;
        handleBounces(this, this.radius);
    }
}

class Projectile {
    constructor(x, y, dx, dy, color, ownerId) {
        this.x = x; this.y = y; this.dx = dx; this.dy = dy;
        this.color = color; this.ownerId = ownerId; this.radius = 8; this.active = true;
        this.creationTime = Date.now();
    }
    update() {
        this.x += this.dx; this.y += this.dy;

        if (currentArena === 1) {
            if (this.x < 0 || this.x > 800 || this.y < 0 || this.y > 600) this.active = false;
        } else {
            handleBounces(this, this.radius);
            if (Date.now() - this.creationTime > 2000) this.active = false;
        }
        if (this.x < -50 || this.x > 850 || this.y < -50 || this.y > 650) this.active = false;
    }
}

function handleBounces(obj, radius) {
    if (currentArena === 4) {
        const dist = Math.hypot(obj.x - 400, obj.y - 300);
        if (dist + radius > 280) {
            const overlap = dist + radius - 280;
            const nx = (obj.x - 400) / dist; const ny = (obj.y - 300) / dist;
            obj.x -= nx * overlap; obj.y -= ny * overlap;
            const dot = obj.dx * nx + obj.dy * ny;
            obj.dx -= 2 * dot * nx; obj.dy -= 2 * dot * ny;
            if (obj.rotationSpeed) obj.rotationSpeed *= -1;
        }
    } else {
        if (obj.x - radius < 0 || obj.x + radius > 800) {
            obj.dx *= -1; if (obj.rotationSpeed) obj.rotationSpeed *= -1;
            obj.x = Math.max(radius, Math.min(obj.x, 800 - radius));
        }
        if (obj.y - radius < 0 || obj.y + radius > 600) {
            obj.dy *= -1; if (obj.rotationSpeed) obj.rotationSpeed *= -1;
            obj.y = Math.max(radius, Math.min(obj.y, 600 - radius));
        }
    }

    obstacles.forEach(obs => {
        if (obj.x > obs.x - radius && obj.x < obs.x + obs.width + radius &&
            obj.y > obs.y - radius && obj.y < obs.y + obs.height + radius) {
            let prevX = obj.x - obj.dx; let prevY = obj.y - obj.dy;
            if (prevX <= obs.x - radius || prevX >= obs.x + obs.width + radius) obj.dx *= -1;
            if (prevY <= obs.y - radius || prevY >= obs.y + obs.height + radius) obj.dy *= -1;
            if (obj.rotationSpeed) obj.rotationSpeed *= -1;
            obj.x += obj.dx; obj.y += obj.dy;
        }
    });
}

function loadArena(arenaType) {
    currentArena = arenaType;
    obstacles = [];
    bullets = [];
    if (arenaType === 2) {
        obstacles.push(new Obstacle(150, 150, 150, 30, 3, 0));
        obstacles.push(new Obstacle(500, 420, 150, 30, -3, 0));
    } else if (arenaType === 3) {
        obstacles.push(new Obstacle(280, 100, 20, 100, 0, 4));
        obstacles.push(new Obstacle(500, 400, 20, 100, 0, -4));
    } else if (arenaType === 5) {
        const pattern = [[250,150,100,20], [330,150,20,100], [330,250,100,20], [430,250,20,100], [430,350,100,20], [530,350,20,100], [530,450,100,20]];
        pattern.forEach(p => obstacles.push(new Obstacle(...p)));
    }
}

io.on('connection', (socket) => {
    let role = 'Spectator';
    if (!p1SocketId) { p1SocketId = socket.id; role = 'Player 1'; }
    else if (!p2SocketId) { p2SocketId = socket.id; role = 'Player 2'; }
    
    socket.emit('roleAssigned', role);

    // Latency checker endpoint
    socket.on('ping', (callback) => {
        if (typeof callback === 'function') callback();
    });

    if (role === 'Player 1') players[socket.id] = new Gorilla(socket.id, 1, 250, 300, '#ff4444', 3, 2, 0.05);
    if (role === 'Player 2') players[socket.id] = new Gorilla(socket.id, 2, 550, 300, '#4444ff', -2, 3, -0.04);

    socket.on('startGame', (arenaType) => {
        if (socket.id === p1SocketId || socket.id === p2SocketId) {
            loadArena(arenaType);
            Object.values(players).forEach(p => { p.lives = 3; });
            gameState = 'PLAYING';
        }
    });

    socket.on('shoot', () => {
        if (gameState !== 'PLAYING') return;
        const p = players[socket.id];
        if (!p) return;
        
        const now = Date.now();
        if (now - p.lastShotTime < 2000) return;
        p.lastShotTime = now;

        // Spawn banana slightly in front of the rotating gorilla
        const spawnX = p.x + Math.cos(p.angle) * 20;
        const spawnY = p.y + Math.sin(p.angle) * 20;
        bullets.push(new Projectile(spawnX, spawnY, Math.cos(p.angle)*8, Math.sin(p.angle)*8, p.color, socket.id));
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        if (socket.id === p1SocketId) p1SocketId = null;
        if (socket.id === p2SocketId) p2SocketId = null;
        gameState = 'MENU'; 
    });
});

setInterval(() => {
    if (gameState === 'PLAYING') {
        obstacles.forEach(o => o.update());
        Object.values(players).forEach(p => p.update());
        
        bullets.forEach(b => {
            b.update();
            Object.values(players).forEach(p => {
                if (b.ownerId !== p.id && b.active) {
                    if (Math.hypot(b.x - p.x, b.y - p.y) < 25) {
                        b.active = false;
                        p.lives--;
                        io.emit('playerHit', { x: p.x, y: p.y, color: p.color }); 
                        
                        if (p.lives <= 0) {
                            gameState = 'GAMEOVER';
                            winnerMessage = p.num === 1 ? "Player 2 Wins!" : "Player 1 Wins!";
                            setTimeout(() => { gameState = 'MENU'; }, 4000);
                        }
                    }
                }
            });
        });
        bullets = bullets.filter(b => b.active);
    }
    io.emit('stateUpdate', { players, bullets, obstacles, gameState, currentArena, winnerMessage });
}, 1000 / 60);

const listener = server.listen(process.env.PORT || 3000, () => {
    console.log('App listening on port ' + listener.address().port);
});