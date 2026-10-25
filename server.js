'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Las partidas se guardan en memoria y se reinician si Render reinicia el servicio.
const games = new Map();
const randomHex = (bytes = 4) => crypto.randomBytes(bytes).toString('hex').toUpperCase();
const gameCode = () => randomHex(3);
const token = () => crypto.randomBytes(24).toString('hex');
const SHIPS = [
  { id: 'portacontenedores', name: 'Buque portacontenedores', size: 3 },
  { id: 'granelero', name: 'Buque granelero', size: 2 },
  { id: 'roro', name: 'Buque Ro-Ro', size: 1 }
];

function validateFleet(fleet) {
  if (!Array.isArray(fleet) || fleet.length !== SHIPS.length) return false;
  const occupied = new Set();
  for (const spec of SHIPS) {
    const ship = fleet.find(s => s && s.id === spec.id);
    if (!ship || !Array.isArray(ship.cells) || ship.cells.length !== spec.size) return false;
    if (ship.cells.some(c => !Number.isInteger(c) || c < 0 || c > 15)) return false;
    if (new Set(ship.cells).size !== ship.cells.length) return false;
    for (const c of ship.cells) {
      if (occupied.has(c)) return false;
      occupied.add(c);
    }
    if (spec.size > 1) {
      const rows = ship.cells.map(c => Math.floor(c / 4));
      const cols = ship.cells.map(c => c % 4);
      const sortedRows = [...rows].sort((a,b)=>a-b);
      const sortedCols = [...cols].sort((a,b)=>a-b);
      const horizontal = rows.every(r => r === rows[0]) && sortedCols.every((c,i)=>i===0 || c===sortedCols[i-1]+1);
      const vertical = cols.every(c => c === cols[0]) && sortedRows.every((r,i)=>i===0 || r===sortedRows[i-1]+1);
      if (!horizontal && !vertical) return false;
    }
  }
  return true;
}
function makeTeam() {
  return { captainCode: randomHex(), viewerCode: randomHex(), captainToken: token(), captainClaimed: false,
    captainConnected: false, fleet: null, shots: [], incomingShots: [] };
}
function publicTeam(team) {
  return { ready: !!team.fleet, captainConnected: team.captainConnected,
    shots: team.shots.map(s => ({ cell: s.cell, result: s.result })),
    incomingShots: team.incomingShots.map(s => ({ cell: s.cell, result: s.result })),
    sunkCount: team.fleet ? team.fleet.filter(ship => ship.cells.every(c => ship.hitCells.includes(c))).length : 0,
    shotCount: team.shots.length };
}
function teamState(g, teamKey, isCaptain = false) {
  const own = g.teams[teamKey];
  const rival = g.teams[teamKey === 'A' ? 'B' : 'A'];
  return {
    role: 'team', gameCode: g.code, team: teamKey, isCaptain,
    status: g.status, currentTurn: g.currentTurn, winner: g.winner,
    own: publicTeam(own), enemy: publicTeam(rival),
    // La flota propia solo se emite al equipo dueño; jamás al equipo rival ni a la organizadora.
    ownFleet: own.fleet ? own.fleet.map(s => ({ id: s.id, name: s.name, size: s.size, cells: [...s.cells], hitCells: [...s.hitCells] })) : null
  };
}
function organizerState(g) {
  return { role: 'organizer', gameCode: g.code, status: g.status, currentTurn: g.currentTurn, winner: g.winner,
    teams: { A: publicTeam(g.teams.A), B: publicTeam(g.teams.B) } };
}
function emitGame(g) {
  io.to(`${g.code}:organizer`).emit('state', organizerState(g));
  for (const teamKey of ['A', 'B']) {
    const team = g.teams[teamKey];
    io.to(`${g.code}:${teamKey}`).emit('state', teamState(g, teamKey, false));
    // Reemitimos al capitán con permiso de jugar. El resto del equipo solo observa.
    for (const s of io.sockets.sockets.values()) {
      if (s.data.gameCode === g.code && s.data.team === teamKey && s.data.role === 'captain') {
        s.emit('state', teamState(g, teamKey, true));
      }
    }
  }
}
function replyError(reply, message) { if (typeof reply === 'function') reply({ ok: false, error: message }); }
function validReply(reply) { return typeof reply === 'function'; }

io.on('connection', socket => {
  socket.on('createGame', (_unused, reply) => {
    if (!validReply(reply)) return;
    let code = gameCode(); while (games.has(code)) code = gameCode();
    const g = { code, status: 'setup', currentTurn: 'A', winner: null, teams: { A: makeTeam(), B: makeTeam() }, createdAt: Date.now() };
    games.set(code, g);
    socket.data = { role: 'organizer', gameCode: code, organizerToken: token() };
    socket.join(`${code}:organizer`);
    reply({ ok: true, gameCode: code, teamACaptainCode: g.teams.A.captainCode, teamBCaptainCode: g.teams.B.captainCode,
      teamAViewerCode: g.teams.A.viewerCode, teamBViewerCode: g.teams.B.viewerCode });
    emitGame(g);
  });

  socket.on('joinGame', (payload = {}, reply) => {
    if (!validReply(reply)) return;
    const code = String(payload.gameCode || '').trim().toUpperCase();
    const teamKey = String(payload.team || '').toUpperCase();
    const accessCode = String(payload.accessCode || '').trim().toUpperCase();
    const g = games.get(code);
    if (!g) return replyError(reply, 'No encuentro esa partida. Revisá el código de partida.');
    if (!['A', 'B'].includes(teamKey)) return replyError(reply, 'Elegí Equipo A o Equipo B.');
    const team = g.teams[teamKey];
    if (accessCode === team.captainCode) {
      if (team.captainClaimed) return replyError(reply, 'Ya hay un capitán asignado para este equipo.');
      team.captainClaimed = true; team.captainConnected = true;
      socket.data = { role: 'captain', team: teamKey, gameCode: code, captainToken: team.captainToken };
      socket.join(`${code}:${teamKey}`);
      reply({ ok: true, role: 'captain', team: teamKey, gameCode: code });
      emitGame(g); return;
    }
    if (accessCode === team.viewerCode) {
      socket.data = { role: 'viewer', team: teamKey, gameCode: code };
      socket.join(`${code}:${teamKey}`);
      reply({ ok: true, role: 'viewer', team: teamKey, gameCode: code });
      emitGame(g); return;
    }
    replyError(reply, 'Código de acceso incorrecto para ese equipo.');
  });

  socket.on('placeFleet', (payload = {}, reply) => {
    if (!validReply(reply)) return;
    const g = games.get(socket.data.gameCode);
    const teamKey = socket.data.team;
    if (!g || socket.data.role !== 'captain' || !['A','B'].includes(teamKey) || g.teams[teamKey].captainToken !== socket.data.captainToken)
      return replyError(reply, 'Solo el capitán de este equipo puede colocar los barcos.');
    if (g.status === 'playing' || g.winner) return replyError(reply, 'La partida ya comenzó.');
    if (!validateFleet(payload.fleet)) return replyError(reply, 'La flota no es válida. Revisá tamaño, orientación y casillas.');
    const specFleet = payload.fleet.map(s => {
      const spec = SHIPS.find(x => x.id === s.id);
      return { id: spec.id, name: spec.name, size: spec.size, cells: [...s.cells], hitCells: [] };
    });
    g.teams[teamKey].fleet = specFleet;
    if (g.teams.A.fleet && g.teams.B.fleet) { g.status = 'playing'; g.currentTurn = 'A'; }
    reply({ ok: true }); emitGame(g);
  });

  socket.on('fire', (payload = {}, reply) => {
    if (!validReply(reply)) return;
    const g = games.get(socket.data.gameCode);
    const teamKey = socket.data.team;
    if (!g || socket.data.role !== 'captain' || !['A','B'].includes(teamKey) || g.teams[teamKey].captainToken !== socket.data.captainToken)
      return replyError(reply, 'Solo el capitán puede disparar.');
    if (g.status !== 'playing' || g.winner) return replyError(reply, 'La partida todavía no está lista o ya terminó.');
    if (g.currentTurn !== teamKey) return replyError(reply, 'Todavía no es el turno de tu equipo.');
    const cell = Number(payload.cell);
    if (!Number.isInteger(cell) || cell < 0 || cell > 15) return replyError(reply, 'Casilla inválida.');
    const own = g.teams[teamKey];
    const rivalKey = teamKey === 'A' ? 'B' : 'A';
    const rival = g.teams[rivalKey];
    if (own.shots.some(s => s.cell === cell)) return replyError(reply, 'Ya disparaste a esa casilla.');
    let hitShip = null;
    for (const ship of rival.fleet) if (ship.cells.includes(cell)) { hitShip = ship; break; }
    const result = hitShip ? 'hit' : 'miss';
    own.shots.push({ cell, result });
    rival.incomingShots.push({ cell, result });
    if (hitShip) hitShip.hitCells.push(cell);
    if (hitShip && hitShip.cells.every(c => hitShip.hitCells.includes(c))) {
      own.shots[own.shots.length - 1].sunkShip = hitShip.id;
      rival.incomingShots[rival.incomingShots.length - 1].sunkShip = hitShip.id;
    }
    if (rival.fleet.every(ship => ship.cells.every(c => ship.hitCells.includes(c)))) {
      g.winner = teamKey; g.status = 'finished';
    } else {
      g.currentTurn = rivalKey;
    }
    reply({ ok: true, result, sunk: !!(hitShip && hitShip.cells.every(c => hitShip.hitCells.includes(c))), winner: g.winner });
    emitGame(g);
  });

  socket.on('disconnect', () => {
    const g = games.get(socket.data.gameCode);
    if (g && socket.data.role === 'captain' && ['A','B'].includes(socket.data.team)) {
      const stillConnected = [...io.sockets.sockets.values()].some(s => s.data.gameCode === g.code && s.data.team === socket.data.team && s.data.role === 'captain');
      g.teams[socket.data.team].captainConnected = stillConnected;
      emitGame(g);
    }
  });
});

httpServer.listen(PORT, () => console.log(`Batalla Naval escuchando en puerto ${PORT}`));
