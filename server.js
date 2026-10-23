// Descargador local: sirve la página y corre yt-dlp + ffmpeg.
// Solo escucha en 127.0.0.1, así que nadie más en la red puede usarlo.
// Sin dependencias: basta con Node.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

const PORT = Number(process.env.PORT) || 5757;
const HOST = '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const OUT = path.join(__dirname, 'descargas');
fs.mkdirSync(OUT, { recursive: true });

// ---------- Encontrar yt-dlp y ffmpeg ----------

// Lo que se abre con doble clic hereda el PATH de cuando inició la sesión de
// Windows: si yt-dlp o ffmpeg se instalaron después, no los ve. Leemos el PATH
// actual del registro y lo juntamos con el heredado.
function registryPath(key) {
  try {
    const out = execFileSync('reg', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true });
    const m = out.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
    return m ? m[1].trim().replace(/%([^%]+)%/g, (all, v) => process.env[v] ?? all) : '';
  } catch { return ''; }
}

function freshPath() {
  const parts = [
    process.env.PATH || '',
    registryPath('HKCU\\Environment'),
    registryPath('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'),
    path.dirname(process.execPath),
  ].join(';').split(';').map(s => s.trim()).filter(Boolean);
  return [...new Map(parts.map(p => [p.toLowerCase().replace(/\\$/, ''), p])).values()].join(';');
}

// A veces el proceso arranca sin APPDATA/LOCALAPPDATA. Python las usa para
// ubicar lo instalado con `pip --user`, así que sin ellas "no existe" yt-dlp.
const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

// Python escribe en cp1252 cuando la salida es un pipe; forzamos UTF-8 para
// que los títulos con tildes y emojis lleguen bien.
const ENV = {
  ...process.env, APPDATA, LOCALAPPDATA,
  PATH: freshPath(), PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1',
};

function findExe(name, extraDirs = []) {
  for (const dir of [...ENV.PATH.split(';'), ...extraDirs]) {
    const full = path.join(dir, `${name}.exe`);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

// Si no está en ningún PATH, buscamos donde lo deja `pip install --user`.
function pipUserScripts() {
  const base = path.join(APPDATA, 'Python');
  try {
    return fs.readdirSync(base).filter(d => /^Python3\d+$/i.test(d)).map(d => path.join(base, d, 'Scripts'));
  } catch { return []; }
}

// Se busca en cada llamada: si yt-dlp se reinstala con el servidor abierto,
// lo encuentra sin reiniciar. Último recurso: el módulo de Python vía `py`.
const findYtdlp = () => findExe('yt-dlp', pipUserScripts());
const ytdlpCmd = () => { const exe = findYtdlp(); return exe ? [exe] : ['py', '-m', 'yt_dlp']; };
const FFMPEG = findExe('ffmpeg', ['C:\\CLI\\ffmpeg\\bin', 'C:\\ffmpeg\\bin']);

// YouTube exige resolver un reto de JavaScript; usamos este mismo Node.
const BASE = [
  '--js-runtimes', `node:${process.execPath}`,
  ...(FFMPEG ? ['--ffmpeg-location', path.dirname(FFMPEG)] : []),
  '--no-playlist', '--no-color',
];

const TEMP_FILE = /\.(part|ytdl|temp)$|\.f\d+\.|\.part-Frag/i;

function ytdlp(args) {
  const [cmd, ...pre] = ytdlpCmd();
  return spawn(cmd, [...pre, ...BASE, ...args], { env: ENV, windowsHide: true });
}

function readLines(stream, onLine) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    buf += chunk;
    let i;
    while ((i = buf.search(/\r?\n/)) >= 0) {
      onLine(buf.slice(0, i));
      buf = buf.slice(buf[i] === '\r' ? i + 2 : i + 1);
    }
  });
  stream.on('end', () => { if (buf) onLine(buf); });
}

// Traduce los errores típicos de yt-dlp a algo que se entienda.
function friendlyError(text) {
  const line = text.split(/\r?\n/).reverse().find(l => l.startsWith('ERROR:')) || text.trim().split(/\r?\n/).pop() || '';
  const known = [
    [/is not a valid URL|Unsupported URL/i, 'Ese enlace no parece de un video. Revisa que lo copiaste completo.'],
    [/Private video/i, 'Ese video es privado.'],
    [/Video unavailable|This video is not available/i, 'Ese video no está disponible (borrado o bloqueado en tu país).'],
    [/Sign in to confirm your age|age-restricted/i, 'Ese video tiene restricción de edad y YouTube pide iniciar sesión.'],
    [/Sign in to confirm you.re not a bot/i, 'YouTube pidió confirmar que no eres un bot. Espera unos minutos y vuelve a intentar.'],
    [/members-only|Join this channel/i, 'Ese video es solo para miembros del canal.'],
    [/live event will begin|Premieres in/i, 'Ese video todavía no se ha estrenado.'],
    [/Unable to download|HTTP Error|timed out|getaddrinfo/i, 'Se cortó la conexión. Revisa tu internet y vuelve a intentar.'],
  ];
  for (const [re, msg] of known) if (re.test(line)) return msg;
  return line.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]+:\s*)?/, '') || 'Algo salió mal con yt-dlp.';
}

function runCollect(args) {
  return new Promise((resolve, reject) => {
    const p = ytdlp(args);
    let out = '', err = '';
    p.stdout.setEncoding('utf8').on('data', d => { out += d; });
    p.stderr.setEncoding('utf8').on('data', d => { err += d; });
    p.on('error', () => reject(new Error('No encontré yt-dlp. Reinstálalo con: py -m pip install --user -U "yt-dlp[default]"')));
    p.on('close', code => code === 0 ? resolve(out) : reject(new Error(friendlyError(err))));
  });
}

// ---------- Información del video ----------

const size = f => (f && (f.filesize || f.filesize_approx)) || 0;
const byBitrate = (a, b) => (b.tbr || b.abr || 0) - (a.tbr || a.abr || 0);

function codecName(c = '') {
  if (c.startsWith('opus')) return 'Opus';
  if (c.startsWith('mp4a')) return 'AAC';
  if (c.startsWith('avc1')) return 'H.264';
  if (c.startsWith('vp9') || c.startsWith('vp09')) return 'VP9';
  if (c.startsWith('av01')) return 'AV1';
  return c.split('.')[0].toUpperCase();
}

function summarize(info) {
  const fmts = (info.formats || []).filter(f => !/drc/.test(f.format_id || ''));
  const stereo = fmts
    .filter(f => f.vcodec === 'none' && f.acodec && f.acodec !== 'none' && (f.audio_channels || 2) <= 2)
    .sort(byBitrate);
  // La info se pide con el mismo -f que usa la descarga de audio, así que el
  // formato de arriba es justo el que yt-dlp va a bajar.
  const bestAudio = stereo.find(f => f.format_id === info.format_id) || stereo[0];
  const bestM4a = stereo.find(f => f.ext === 'm4a') || bestAudio;

  const video = fmts.filter(f => f.vcodec && f.vcodec !== 'none' && f.height && f.acodec === 'none');
  const heights = [...new Set(video.map(f => f.height))].filter(h => h >= 144).sort((a, b) => b - a);
  const qualities = heights.map(h => {
    const best = video.filter(f => f.height === h).sort(byBitrate)[0];
    const h264 = video.filter(f => f.height === h && (f.vcodec || '').startsWith('avc1')).sort(byBitrate)[0];
    return {
      height: h,
      fps: best.fps || null,
      codec: codecName(best.vcodec),
      size: size(best) ? size(best) + size(bestAudio) : 0,
      compatSize: h264 && size(h264) ? size(h264) + size(bestM4a) : 0,
      compatible: !!h264,
    };
  });

  const thumbs = (info.thumbnails || []).filter(t => t.url && t.width).sort((a, b) => b.width - a.width);
  const thumb = (thumbs.find(t => t.width <= 1280) || thumbs[0] || {}).url || info.thumbnail || '';

  return {
    id: info.id,
    url: info.webpage_url || info.original_url,
    title: info.title,
    channel: info.channel || info.uploader || '',
    duration: info.duration || 0,
    thumbnail: thumb,
    isLive: !!info.is_live,
    audio: bestAudio ? {
      codec: codecName(bestAudio.acodec),
      kbps: Math.round(bestAudio.abr || bestAudio.tbr || 0),
      ext: bestAudio.ext === 'webm' ? 'opus' : bestAudio.ext,
      size: size(bestAudio),
    } : null,
    qualities,
  };
}

// ---------- Descargas ----------

const jobs = new Map();
const listeners = new Set();

function publicJob(j) {
  const { proc, log, ...rest } = j;
  return rest;
}

function broadcast(job) {
  const data = `data: ${JSON.stringify(publicJob(job))}\n\n`;
  for (const res of listeners) res.write(data);
}

const PP_LABEL = {
  Merger: 'Uniendo video y audio',
  ExtractAudio: 'Sacando el audio',
  FFmpegExtractAudio: 'Sacando el audio',
  VideoConvertor: 'Convirtiendo',
  Metadata: 'Guardando título y artista',
  EmbedThumbnail: 'Poniendo la portada',
  MoveFiles: 'Terminando',
};

function buildArgs({ url, kind, audioFormat, height, compatible }) {
  const args = [
    '--newline', '--progress', '--no-quiet', '--windows-filenames', '--no-mtime',
    '-P', OUT,
    '-o', '%(title).150B [%(id)s].%(ext)s',
    '--embed-metadata',
    '--progress-template', 'download:P|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.filename)s',
    '--progress-template', 'postprocess:PP|%(progress.postprocessor)s|%(progress.status)s',
    '--print', 'after_move:F|%(filepath)s',
  ];

  if (kind === 'audio') {
    const stereo = 'ba[audio_channels<=2]/ba';
    if (audioFormat === 'mp3') args.push('-f', stereo, '-x', '--audio-format', 'mp3', '--audio-quality', '0', '--embed-thumbnail');
    else if (audioFormat === 'm4a') args.push('-f', 'ba[ext=m4a][audio_channels<=2]/' + stereo, '-x', '--audio-format', 'm4a', '--embed-thumbnail');
    else if (audioFormat === 'wav') args.push('-f', stereo, '-x', '--audio-format', 'wav');
    else args.push('-f', stereo, '-x', '--embed-thumbnail'); // original: sin recomprimir
  } else {
    const h = Number(height) > 0 ? `[height<=${Number(height)}]` : '';
    if (compatible) {
      // H.264 + AAC en MP4: lo abre cualquier editor (CapCut, Premiere) y cualquier reproductor.
      args.push('-f', `bv*${h}[vcodec^=avc1]+ba[ext=m4a]/b${h}[ext=mp4]/bv*${h}+ba/b${h}`, '--merge-output-format', 'mp4');
    } else {
      args.push('-f', `bv*${h}+ba[audio_channels<=2]/bv*${h}+ba/b${h}`, '--merge-output-format', 'mp4/mkv');
    }
    args.push('--embed-thumbnail');
  }

  args.push('--', url);
  return args;
}

function startJob(body) {
  const job = {
    id: crypto.randomUUID(),
    videoId: String(body.videoId || ''),
    title: String(body.title || body.url),
    thumbnail: String(body.thumbnail || ''),
    kind: body.kind === 'video' ? 'video' : 'audio',
    label: String(body.label || ''),
    status: 'starting',   // starting | downloading | processing | done | error | cancelled
    stage: 'Preparando…',
    percent: 0,
    speed: 0,
    eta: null,
    part: 0,
    file: null,
    size: 0,
    error: null,
    createdAt: Date.now(),
    log: [],
    proc: null,
  };
  jobs.set(job.id, job);

  const proc = ytdlp(buildArgs(body));
  job.proc = proc;
  let lastFile = null;
  let lastSent = 0;

  const onLine = line => {
    if (!line) return;
    job.log.push(line);
    if (job.log.length > 60) job.log.shift();

    if (line.startsWith('P|')) {
      const [, done, total, est, speed, eta, file] = line.split('|');
      if (file !== lastFile) { lastFile = file; job.part += 1; }
      const t = Number(total) || Number(est) || 0;
      job.status = 'downloading';
      job.percent = t ? Math.min(100, (Number(done) / t) * 100) : job.percent;
      job.speed = Number(speed) || 0;
      job.eta = eta === 'NA' ? null : Number(eta);
      // yt-dlp baja primero la imagen y después el sonido, en archivos separados.
      job.stage = job.kind === 'video' && job.part === 1 ? 'Bajando el video' : 'Bajando el audio';
      const now = Date.now();
      if (now - lastSent > 250) { lastSent = now; broadcast(job); }
      return;
    }
    if (line.startsWith('PP|')) {
      const [, pp, st] = line.split('|');
      if (st === 'started' && PP_LABEL[pp]) {
        job.status = 'processing';
        job.stage = PP_LABEL[pp];
        job.percent = 100;
        broadcast(job);
      }
      return;
    }
    if (line.startsWith('F|')) {
      job.file = line.slice(2).trim();
      return;
    }
    // Antes de que empiece a bajar pasan unos segundos; contamos en qué va.
    if (job.status === 'starting') {
      const stage = /Solving JS/.test(line) ? 'Resolviendo el candado de YouTube…'
        : /^\[youtube\]/.test(line) ? 'Conectando con YouTube…'
        : /^\[info\] .*thumbnail/i.test(line) ? 'Bajando la portada…'
        : /^\[info\] .*Downloading \d+ format/.test(line) ? 'Empezando…'
        : null;
      if (stage && stage !== job.stage) { job.stage = stage; broadcast(job); }
    }
  };

  readLines(proc.stdout, onLine);
  readLines(proc.stderr, onLine);

  proc.on('error', () => {
    job.status = 'error';
    job.error = 'No encontré yt-dlp.';
    broadcast(job);
  });

  proc.on('close', code => {
    job.proc = null;
    if (job.status === 'cancelled') { cleanupTemp(job.videoId); broadcast(job); return; }
    if (code === 0 && job.file && fs.existsSync(job.file)) {
      job.status = 'done';
      job.stage = 'Listo';
      job.percent = 100;
      job.size = fs.statSync(job.file).size;
      job.file = path.basename(job.file);
    } else {
      job.status = 'error';
      job.error = friendlyError(job.log.join('\n'));
    }
    broadcast(job);
  });

  broadcast(job);
  return job;
}

function cleanupTemp(videoId) {
  if (!videoId) return;
  for (const name of fs.readdirSync(OUT)) {
    if (name.includes(`[${videoId}]`) && TEMP_FILE.test(name)) {
      try { fs.unlinkSync(path.join(OUT, name)); } catch {}
    }
  }
}

function cancelJob(job) {
  if (!job.proc) return;
  job.status = 'cancelled';
  job.stage = 'Cancelado';
  // taskkill /T se lleva también al ffmpeg que yt-dlp haya lanzado.
  spawn('taskkill', ['/pid', String(job.proc.pid), '/T', '/F'], { windowsHide: true });
}

function listFiles() {
  return fs.readdirSync(OUT)
    .filter(n => !TEMP_FILE.test(n) && !n.startsWith('.'))
    .map(n => {
      const st = fs.statSync(path.join(OUT, n));
      return st.isFile() ? { name: n, size: st.size, mtime: st.mtimeMs } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 100);
}

// Solo nombres de archivos que de verdad están dentro de descargas/.
function safeFile(name) {
  const base = path.basename(String(name || ''));
  const full = path.join(OUT, base);
  return base && fs.existsSync(full) ? full : null;
}

// ---------- HTTP ----------

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
};

const MEDIA_TYPES = {
  opus: 'audio/ogg', ogg: 'audio/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/webm', mov: 'video/quicktime',
};

const ALLOWED_HOSTS =new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.setEncoding('utf8');
    req.on('data', d => { b += d; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
}

function isHttpUrl(u) {
  try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; }
}

let version = null;
async function getVersion() {
  if (!version) version = (await runCollect(['--version']).catch(() => '')).trim();
  return version;
}

const server = http.createServer(async (req, res) => {
  // Bloquea páginas de internet que intenten hablar con este servidor.
  if (!ALLOWED_HOSTS.has(req.headers.host)) { res.writeHead(403); return res.end(); }
  if (req.method === 'POST' && req.headers.origin && !ALLOWED_HOSTS.has(req.headers.origin.replace(/^https?:\/\//, ''))) {
    res.writeHead(403); return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    if (req.method === 'GET' && STATIC[p]) {
      const [file, type] = STATIC[p];
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      return fs.createReadStream(path.join(PUBLIC, file)).pipe(res);
    }

    if (req.method === 'GET' && p === '/api/info') {
      const u = url.searchParams.get('url') || '';
      if (!isHttpUrl(u)) return send(res, 400, { error: 'Pega un enlace que empiece por https://' });
      const raw = await runCollect(['-J', '-f', 'ba[audio_channels<=2]/ba/b', '--', u]);
      return send(res, 200, summarize(JSON.parse(raw)));
    }

    if (req.method === 'GET' && p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': hola\n\n');
      for (const j of jobs.values()) res.write(`data: ${JSON.stringify(publicJob(j))}\n\n`);
      listeners.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); listeners.delete(res); });
      return;
    }

    if (req.method === 'POST' && p === '/api/download') {
      const body = await readBody(req);
      if (!isHttpUrl(body.url)) return send(res, 400, { error: 'Enlace no válido.' });
      return send(res, 200, publicJob(startJob(body)));
    }

    const cancel = p.match(/^\/api\/jobs\/([\w-]+)\/cancel$/);
    if (req.method === 'POST' && cancel) {
      const job = jobs.get(cancel[1]);
      if (job) cancelJob(job);
      return send(res, 200, { ok: true });
    }

    const dismiss = p.match(/^\/api\/jobs\/([\w-]+)$/);
    if (req.method === 'DELETE' && dismiss) {
      const job = jobs.get(dismiss[1]);
      if (job && !job.proc) jobs.delete(job.id);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && p === '/api/files') return send(res, 200, listFiles());

    if (req.method === 'POST' && p === '/api/reveal') {
      const body = await readBody(req);
      const full = body.name ? safeFile(body.name) : null;
      // Explorer solo entiende /select si la ruta va entre comillas pegada a la coma;
      // Node pondría las comillas alrededor de todo, así que armamos el argumento a mano.
      const arg = full ? `/select,"${full}"` : `"${OUT}"`;
      spawn('explorer.exe', [arg], { windowsVerbatimArguments: true, detached: true }).unref();
      return send(res, 200, { ok: true });
    }

    // Reproducir dentro de la página, con soporte de Range para poder adelantar.
    if (req.method === 'GET' && p.startsWith('/media/')) {
      const full = safeFile(decodeURIComponent(p.slice(7)));
      if (!full) { res.writeHead(404); return res.end(); }
      const total = fs.statSync(full).size;
      const type = MEDIA_TYPES[path.extname(full).slice(1).toLowerCase()] || 'application/octet-stream';
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (m) {
        const start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]));
        const end = m[1] && m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
        res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': end - start + 1 });
        return fs.createReadStream(full, { start, end }).pipe(res);
      }
      res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': total });
      return fs.createReadStream(full).pipe(res);
    }

    if (req.method === 'POST' && p === '/api/play') {
      const body = await readBody(req);
      const full = safeFile(body.name);
      if (!full) return send(res, 404, { error: 'Ese archivo ya no está.' });
      spawn('explorer', [full], { detached: true }).unref();
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && p === '/api/version') return send(res, 200, { version: await getVersion() });

    if (req.method === 'POST' && p === '/api/update') {
      // pip borra la versión vieja antes de poner la nueva; si yt-dlp está
      // corriendo, Windows no deja reemplazar el .exe y la instalación queda rota.
      if ([...jobs.values()].some(j => j.proc)) {
        return send(res, 409, { error: 'Espera a que terminen las descargas para actualizar.' });
      }
      const before = await getVersion();
      await new Promise(resolve => {
        const u = spawn('py', ['-m', 'pip', 'install', '--user', '-U', 'yt-dlp[default]'], { env: ENV, windowsHide: true });
        u.on('close', resolve);
        u.on('error', resolve);
      });
      version = null;
      const after = await getVersion();
      return send(res, 200, { before, after, updated: before !== after });
    }

    res.writeHead(404); res.end();
  } catch (e) {
    send(res, 500, { error: e.message || 'Error inesperado.' });
  }
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log(`El descargador ya está abierto en http://127.0.0.1:${PORT}`);
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  console.log(`Descargador listo en http://127.0.0.1:${PORT}`);
  console.log(`  yt-dlp: ${findYtdlp() || 'NO ENCONTRADO. Instálalo con: py -m pip install --user -U "yt-dlp[default]"'}`);
  console.log(`  ffmpeg: ${FFMPEG || 'NO ENCONTRADO: no podrá unir video y audio ni convertir'}`);
  console.log(`  node:   ${process.execPath}`);
  if (!process.env.APPDATA) console.log(`  (APPDATA venía vacío; uso ${APPDATA})`);
  console.log('Cierra esta ventana para apagarlo.');
});
