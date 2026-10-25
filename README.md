# Batalla Naval 3×3 — desde cero

Proyecto Node.js + Express + Socket.IO para desplegar en Render.

## Contenido
- `package.json`: dependencias y comando de inicio.
- `server.js`: servidor, creación de partidas, códigos de acceso y reglas del juego.
- `public/index.html`: interfaz de organizadora, capitanes y observadores.
- `render.yaml`: configuración de despliegue para Render.

## Barcos
- Barco portacontenedores: 3 casillas.
- Buque granelero: 2 casillas.
- Buque Ro-Ro: 1 casilla.

Tablero 3×3. Los barcos se colocan en línea recta, sin superponerse.

## Roles y privacidad
1. La organizadora crea la partida y recibe un código de partida y cuatro códigos de acceso separados.
2. Cada capitán recibe exclusivamente su código de capitán y el código de partida.
3. Los observadores reciben el código de observador de su equipo y solo pueden mirar.
4. El servidor no envía la flota secreta a la organizadora ni al equipo rival.
5. Solo un capitán por equipo puede tomar el puesto y jugar.

## Publicar en Render
1. Subí **el contenido** de esta carpeta a la raíz del repositorio GitHub (no la carpeta contenedora completa como subcarpeta).
2. En Render, creá o actualizá un Web Service conectado al repositorio.
3. Root Directory: vacío.
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Ejecutá un deploy nuevo.

## Importante
Las partidas se almacenan en memoria; se borran si el servidor se reinicia o vuelve a desplegarse. Para un uso de clase de corta duración, creá la partida después de que termine el deploy. Esta aplicación es un prototipo y debe probarse en Render antes de compartir los códigos.


## Validación oral de preguntas por la organizadora

Las preguntas se hacen oralmente y no se cargan en la web. Cuando ambos equipos colocan sus tres barcos, la organizadora usa los botones del panel:

- **Respuesta correcta:** habilita al capitán del equipo que tiene el turno para hacer un disparo.
- **Respuesta incorrecta:** pasa el turno al otro equipo sin permitir disparar.

Después de cada disparo, la autorización se reinicia y la organizadora debe validar la siguiente respuesta.
