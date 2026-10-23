# sleks. descargador

Una página local y bonita para bajar **audio y video en la mejor calidad** desde YouTube (y cualquier sitio que soporte [yt-dlp](https://github.com/yt-dlp/yt-dlp)). Pegas el enlace, eliges formato y listo.

Todo corre en tu computador: el servidor solo escucha en `127.0.0.1`, no sube nada a ningún lado y no necesita cuenta.

Hecho por **Sleks** · [Instagram @sleks_92](https://www.instagram.com/sleks_92/)

## Qué hace

- **Audio original**: la mejor pista que tenga el video (Opus o AAC), tal cual, sin volver a comprimir. Con portada y título incrustados.
- **MP3, M4A o WAV**, si los necesitas para un reproductor o un editor.
- **Video** en cualquier calidad disponible, hasta 4K y 60 fps.
- **Modo compatible con editores**: MP4 en H.264 + AAC, que abren CapCut, Premiere y cualquier reproductor.
- Barra de progreso en vivo con velocidad y tiempo restante. Puedes cancelar.
- Lista de lo que has bajado: lo **reproduces ahí mismo** o lo abres en la carpeta.
- Botón para actualizar yt-dlp. YouTube cambia seguido; cuando algo deja de bajar, casi siempre se arregla así.

## Requisitos

| Programa | Para qué | Cómo instalarlo (Windows) |
|---|---|---|
| [Node.js](https://nodejs.org) 18 o más | El servidor local, y resolver el reto de JavaScript de YouTube | `winget install OpenJS.NodeJS.LTS` |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Bajar | `py -m pip install --user -U "yt-dlp[default]"` |
| [ffmpeg](https://ffmpeg.org) | Unir video y audio, convertir formatos | `winget install Gyan.FFmpeg` |

Los tres tienen que estar en el `PATH`. Para comprobarlo, `yt-dlp --version` y `ffmpeg -version` deben responder.

No hace falta `npm install`: el proyecto no tiene dependencias.

## Cómo abrirlo

**Doble clic en `Iniciar.bat`.** Se abre una ventana negra (el servidor) y el navegador en `http://127.0.0.1:5757`. Para apagarlo, cierras la ventana negra.

O desde una terminal (por ejemplo, la de VS Code o Antigravity):

```bash
npm start
```

y abres `http://127.0.0.1:5757`.

Lo que bajes queda en la carpeta `descargas/`.

## ¿Por qué no Live Server, Vercel o Cloudflare?

- **Live Server** solo sirve archivos HTML: no puede ejecutar yt-dlp ni ffmpeg.
- **Vercel / Cloudflare**: YouTube bloquea las IP de los centros de datos ("confirma que no eres un bot"), las funciones tienen límites de tiempo y tamaño, y Cloudflare Workers no puede ejecutar programas. Además quedaría público.

Por eso es un servidor pequeño en Node que corre en tu máquina.

## Seguridad

- Escucha solo en `127.0.0.1`: nadie más en tu red puede usarlo.
- Rechaza peticiones con un `Host` u `Origin` distintos, para que una página web abierta en otra pestaña no pueda mandarle órdenes.
- Llama a yt-dlp con argumentos separados, sin pasar por la consola, y con `--` antes del enlace, así que un enlace no puede colarse como opción.
- Solo entrega o muestra archivos que de verdad están dentro de `descargas/`.

## Uso responsable

Esta herramienta es para bajar contenido que tienes derecho a guardar: tus propios videos, contenido con licencia Creative Commons o de dominio público, o material para el que tienes permiso. Las condiciones de YouTube no permiten descargar sin autorización, y la música y las películas suelen tener derechos de autor. Cada quien responde por lo que baja.

## Licencia

[MIT](LICENSE) © 2026 Sleks
