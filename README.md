# Batalla Naval 4×4 online

Juego web multijugador por equipos, con 3 barcos, turnos, impactos/agua, una organizadora separada de los capitanes y flotas privadas.

## Importante
- El servidor es quien conserva las flotas y valida turnos/disparos. El navegador solo recibe la flota de su propio equipo; la flota rival nunca se emite a sus sockets.
- Un solo capitán por equipo puede ubicar barcos y disparar. Los observadores solo reciben el estado de juego.
- Esta versión guarda las partidas en memoria: si el servidor se reinicia o duerme, se pierde la partida. Es adecuada para una partida de clase; no es una base de datos permanente.
- La persona que crea la partida entra como organizadora, no como capitana. Puede ver el estado general, pero no las posiciones secretas de los barcos.
- Se generan códigos de acceso aleatorios distintos para los capitanes y observadores de cada equipo. Compartí cada código solo con su destinatario.

## Probar en tu computadora
Necesitás Node.js 18 o posterior.

```bash
npm install
npm start
```

Abrí `http://localhost:3000`.

## Publicarlo gratis en Render
1. Subí esta carpeta a un repositorio de GitHub.
2. En Render, creá un **New Web Service** y conectá ese repositorio.
3. Elegí `Node` como entorno, `npm install` como Build Command y `npm start` como Start Command.
4. Cuando termine el despliegue, Render te dará una URL pública `https://...onrender.com`. Compartí esa URL con tus compañeros.
5. Creá la partida desde esa URL y enviá a cada persona el código de su equipo.

Render puede poner servicios gratuitos en reposo cuando no se usan; la primera conexión puede tardar. Reiniciar el servidor borra las partidas activas.
