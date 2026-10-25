const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

// In-memory game rooms: suitable for a live class game. Restarting the server resets games.
const games = new Map();
const code = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const token = () => crypto.randomBytes(24).toString('hex');
const cleanFleet = (fleet) => {
  if (!Array.isArray(fleet) || fleet.length !== 3) return false;
  const expected = [3,2,1];
  const all = new Set();
  for (let i=0;i<fleet.length;i++) {
    const ship = fleet[i];
    if (!ship || !Array.isArray(ship.cells) || ship.cells.length !== expected[i]) return false;
    if (ship.cells.some(n => !Number.isInteger(n) || n<0 || n>15)) return false;
    for (const n of ship.cells) { if (all.has(n)) return false; all.add(n); }
    if (expected[i] > 1) {
      const rows = ship.cells.map(n=>Math.floor(n/4));
      const cols = ship.cells.map(n=>n%4);
      const sameRow = rows.every(x=>x===rows[0]) && [...cols].sort((a,b)=>a-b).every((x,j,a)=>j===0||x===a[j-1]+1);
      const sameCol = cols.every(x=>x===cols[0]) && [...rows].sort((a,b)=>a-b).every((x,j,a)=>j===0||x===a[j-1]+1);
      if (!sameRow && !sameCol) return false;
    }
  }
  return true;
};
function getGame(socket) { const { gameCode, team, captainToken } = socket.data; const g=games.get(gameCode); if (!g || !['A','B'].includes(team)) return null; return {g,team, captain: !!captainToken && g.teams[team].captainToken===captainToken}; }
function publicTeam(t) { return { ready: !!t.fleet, shots: t.shots, hits: t.hits, sunk: t.sunk, misses: t.misses, captainConnected: t.captainConnected }; }
function emitState(gameCode) {
  const g=games.get(gameCode); if(!g) return;
  // Organizers receive only public match progress, never either team's secret fleet.
  io.to(`${gameCode}:organizer`).emit('state',{
    gameCode, role:'organizer', status:g.status, currentTurn:g.currentTurn, winner:g.winner,
    teams:{ A: publicTeam(g.teams.A), B: publicTeam(g.teams.B) }
  });
  for (const team of ['A','B']) {
    const own=g.teams[team], rival=team==='A'?'B':'A';
    const state={ gameCode, status:g.status, currentTurn:g.currentTurn, winner:g.winner,
      own: publicTeam(own), enemy: publicTeam(g.teams[rival]),
      // Fleet is only sent to sockets belonging to its own team.
      ownFleet: own.fleet ? own.fleet.map(s=>({name:s.name,cells:s.cells,hitCells:s.hitCells})) : null,
      isCaptain:false };
    io.to(`${gameCode}:${team}`).emit('state',state);
    for (const s of io.sockets.sockets.values()) {
      if (s.data.gameCode===gameCode && s.data.team===team && s.data.captainToken===own.captainToken) {
        s.emit('state',{...state,isCaptain:true});
      }
    }
  }
}
function makeTeam() { return { captainToken: token(), captainConnected:false, fleet:null, shots:[], hits:[], misses:[], sunk:[] }; }

io.on('connection', socket => {
  socket.on('createGame', (reply) => {
    let c=code(); while(games.has(c)) c=code();
    const g={code:c,status:'setup',currentTurn:'A',winner:null,teams:{A:makeTeam(),B:makeTeam()},createdAt:Date.now(),
      access:{A:{captain:crypto.randomBytes(4).toString('hex').toUpperCase(),viewer:crypto.randomBytes(4).toString('hex').toUpperCase()},
             B:{captain:crypto.randomBytes(4).toString('hex').toUpperCase(),viewer:crypto.randomBytes(4).toString('hex').toUpperCase()}}};
    games.set(c,g);
    const organizerToken=token();
    socket.data={gameCode:c,role:'organizer',organizerToken};
    socket.join(`${c}:organizer`);
    reply({ok:true,gameCode:c,role:'organizer',organizerToken,teamACaptainCode:g.access.A.captain,teamBCaptainCode:g.access.B.captain,teamAViewCode:g.access.A.viewer,teamBViewCode:g.access.B.viewer});
    emitState(c);
  });
  socket.on('joinGame', ({gameCode,team,accessCode}, reply) => {
    const c=String(gameCode||'').toUpperCase().trim(); const g=games.get(c);
    if(!g) return reply({ok:false,error:'No encuentro esa partida. Revisá el código.'});
    if(!['A','B'].includes(team)) return reply({ok:false,error:'Elegí Equipo A o Equipo B.'});
    const isCaptain = accessCode === g.access[team].captain;
    if(isCaptain) {
      if(g.teams[team].captainClaimed) return reply({ok:false,error:'Ese equipo ya tiene capitán.'});
      g.teams[team].captainClaimed=true;
      const captainToken=g.teams[team].captainToken;
      socket.data={gameCode:c,team,captainToken}; socket.join(`${c}:${team}`); g.teams[team].captainConnected=true;
      reply({ok:true,gameCode:c,team,captain:true,captainToken}); emitState(c); return;
    }
    // Viewers use the shared read-only code generated for the game/team.
    if(accessCode !== g.access[team].viewer) return reply({ok:false,error:'Código de acceso incorrecto.'});
    socket.data={gameCode:c,team,captainToken:null}; socket.join(`${c}:${team}`);
    reply({ok:true,gameCode:c,team,captain:false}); emitState(c);
  });
  socket.on('claimCaptain', ({gameCode,team,accessCode}, reply) => {
    const c=String(gameCode||'').toUpperCase().trim(), g=games.get(c);
    if(!g || !['A','B'].includes(team)) return reply({ok:false,error:'Partida o equipo inválido.'});
    if(accessCode !== g.access[team].captain) return reply({ok:false,error:'Código de capitán incorrecto.'});
    if(g.teams[team].captainClaimed) return reply({ok:false,error:'Ya hay un capitán para ese equipo.'});
    g.teams[team].captainClaimed=true;
    socket.data={gameCode:c,team,captainToken:g.teams[team].captainToken}; socket.join(`${c}:${team}`); g.teams[team].captainConnected=true;
    reply({ok:true,gameCode:c,team,captain:true,captainToken:g.teams[team].captainToken}); emitState(c);
  });
  socket.on('placeFleet', ({fleet}, reply) => {
    const auth=getGame(socket); if(!auth || !auth.captain) return reply({ok:false,error:'Solo el capitán puede colocar barcos.'});
    const {g,team}=auth;
    if(g.status!=='setup') return reply({ok:false,error:'La partida ya empezó.'});
    if(!cleanFleet(fleet)) return reply({ok:false,error:'La flota no es válida. Revisá la ubicación de los barcos.'});
    g.teams[team].fleet=fleet.map((s,i)=>({...s,hitCells:[]}));
    if(g.teams.A.fleet && g.teams.B.fleet) g.status='playing';
    emitState(g.code); reply({ok:true});
  });
  socket.on('fire', ({cell}, reply) => {
    const auth=getGame(socket); if(!auth || !auth.captain) return reply({ok:false,error:'Solo el capitán puede disparar.'});
    const {g,team}=auth, enemy=team==='A'?'B':'A';
    if(g.status!=='playing') return reply({ok:false,error:'La partida todavía no está lista.'});
    if(g.currentTurn!==team) return reply({ok:false,error:'Todavía no es tu turno.'});
    if(!Number.isInteger(cell)||cell<0||cell>15) return reply({ok:false,error:'Casilla inválida.'});
    if(g.teams[team].shots.includes(cell)) return reply({ok:false,error:'Ya disparaste a esa casilla.'});
    g.teams[team].shots.push(cell);
    const target=g.teams[enemy];
    let hitShip=null;
    for(const ship of target.fleet) if(ship.cells.includes(cell)){ hitShip=ship; break; }
    if(hitShip){
      hitShip.hitCells.push(cell); g.teams[team].hits.push(cell);
      if(hitShip.hitCells.length===hitShip.cells.length) g.teams[team].sunk.push(hitShip.name);
    } else g.teams[team].misses.push(cell);
    if(target.fleet.every(ship=>ship.cells.every(n=>ship.hitCells.includes(n)))) { g.status='finished'; g.winner=team; }
    else g.currentTurn=enemy;
    emitState(g.code); reply({ok:true,hit:!!hitShip,sunk:!!hitShip && hitShip.hitCells.length===hitShip.cells.length});
  });
  socket.on('disconnect',()=>{ const auth=getGame(socket); if(auth && auth.captain){ auth.g.teams[auth.team].captainConnected=false; emitState(auth.g.code); } });
});
server.listen(PORT,()=>console.log(`Batalla Naval listening on ${PORT}`));
