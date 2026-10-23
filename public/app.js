const $ = s => document.querySelector(s);

const els = {
  form: $('#search'), url: $('#url'), paste: $('#paste'), go: $('#go'),
  status: $('#status'), result: $('#result'),
  thumb: $('#thumb'), duration: $('#duration'), title: $('#title'), channel: $('#channel'),
  seg: $('.seg'), audioPanel: $('#audio-panel'), videoPanel: $('#video-panel'),
  audioOptions: $('#audio-options'), videoOptions: $('#video-options'),
  compatible: $('#compatible'), download: $('#download'),
  jobsWrap: $('#jobs-wrap'), jobs: $('#jobs'), tplJob: $('#tpl-job'),
  files: $('#files'), filesEmpty: $('#files-empty'), openFolder: $('#open-folder'),
  version: $('#version'), update: $('#update'),
};

const state = { info: null, kind: 'audio', audioFormat: 'original', height: null };

// ---------- Utilidades ----------

function fmtBytes(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function fmtTime(s) {
  if (s == null || !isFinite(s)) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function fmtDate(ms) {
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(ms);
}

function qualityName(h) {
  if (h >= 2160) return '4K';
  if (h >= 1440) return '2K';
  if (h >= 1080) return 'Full HD';
  if (h >= 720) return 'HD';
  return '';
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'No pude hablar con el servidor. ¿Sigue abierta la ventana negra?');
  return data;
}

function showStatus(kind, text) {
  els.status.hidden = false;
  els.status.className = `status ${kind}`;
  els.status.innerHTML = kind === 'loading' ? '<span class="spinner" aria-hidden="true"></span>' : '';
  els.status.append(document.createTextNode(text));
}

// ---------- Buscar ----------

let searchId = 0;
async function search() {
  const url = els.url.value.trim();
  if (!url) return;
  const id = ++searchId;
  els.result.hidden = true;
  els.go.disabled = true;
  showStatus('loading', 'Buscando el video…');
  try {
    const info = await api(`/api/info?url=${encodeURIComponent(url)}`);
    if (id !== searchId) return;
    if (info.isLive) throw new Error('Ese video es una transmisión en vivo. Espera a que termine para bajarlo.');
    state.info = info;
    els.status.hidden = true;
    renderInfo();
  } catch (e) {
    if (id === searchId) showStatus('error', e.message);
  } finally {
    if (id === searchId) els.go.disabled = false;
  }
}

els.form.addEventListener('submit', e => { e.preventDefault(); search(); });

// Al pegar un enlace se busca solo: no hace falta tocar "Buscar".
els.url.addEventListener('paste', () => setTimeout(search, 0));

els.paste.addEventListener('click', async () => {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) return;
    els.url.value = text;
    search();
  } catch {
    els.url.focus();
    showStatus('error', 'El navegador no me dejó leer el portapapeles. Pega con Ctrl + V.');
  }
});

// ---------- Opciones ----------

function option({ title, desc, size, tag, checked, disabled, onPick }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'option';
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', String(!!checked));
  if (disabled) b.setAttribute('aria-disabled', 'true');
  b.innerHTML = `<span class="option-title"></span><span class="option-desc"></span><span class="option-size"></span>`;
  b.querySelector('.option-title').textContent = title;
  if (tag) {
    const t = document.createElement('span');
    t.className = 'tag';
    t.textContent = tag;
    b.querySelector('.option-title').append(t);
  }
  b.querySelector('.option-desc').textContent = desc || '';
  b.querySelector('.option-size').textContent = size ? `≈ ${size}` : '';
  if (!disabled) b.addEventListener('click', onPick);
  return b;
}

function renderAudio() {
  const a = state.info.audio;
  const dur = state.info.duration || 0;
  const original = a ? `${a.codec} ${a.kbps} kbps · .${a.ext}` : 'La mejor pista que tenga';
  const list = [
    { key: 'original', title: 'Original', tag: 'Mejor calidad', desc: `${original}. Tal cual lo tiene YouTube, sin volver a comprimir.`, size: a && a.size },
    { key: 'mp3', title: 'MP3', desc: 'Se abre en cualquier parte. Vuelve a comprimir, pero no se nota.', size: dur * 245000 / 8 },
    { key: 'm4a', title: 'M4A', desc: 'Ideal para iPhone, iTunes y editores de video.', size: a && a.ext === 'm4a' ? a.size : dur * 130000 / 8 },
    { key: 'wav', title: 'WAV', desc: 'Sin compresión, para editar audio. Pesa mucho.', size: dur * 1411200 / 8 },
  ];
  els.audioOptions.replaceChildren(...list.map(o => option({
    title: o.title, tag: o.tag, desc: o.desc, size: fmtBytes(o.size),
    checked: state.audioFormat === o.key,
    onPick: () => { state.audioFormat = o.key; renderAudio(); },
  })));
}

function renderVideo() {
  const compat = els.compatible.checked;
  const qs = state.info.qualities;
  const usable = qs.filter(q => !compat || q.compatible);
  if (!usable.some(q => q.height === state.height)) state.height = usable[0] ? usable[0].height : null;

  if (!qs.length) {
    els.videoOptions.replaceChildren(Object.assign(document.createElement('p'), {
      className: 'muted', textContent: 'Este enlace no trae video aparte: se bajará la mejor versión disponible.',
    }));
    return;
  }

  els.videoOptions.replaceChildren(...qs.map(q => {
    const disabled = compat && !q.compatible;
    const fps = q.fps && q.fps > 30 ? ` ${Math.round(q.fps)} fps` : '';
    return option({
      title: `${q.height}p`,
      tag: q === qs[0] && !compat ? 'Máxima' : qualityName(q.height) || null,
      desc: disabled ? 'No existe en H.264' : `${compat ? 'H.264' : q.codec}${fps}`,
      size: fmtBytes(compat ? q.compatSize : q.size),
      checked: !disabled && q.height === state.height,
      disabled,
      onPick: () => { state.height = q.height; renderVideo(); },
    });
  }));
}

function setKind(kind) {
  state.kind = kind;
  els.seg.dataset.kind = kind;
  for (const b of els.seg.querySelectorAll('.seg-btn')) b.setAttribute('aria-selected', String(b.dataset.kind === kind));
  els.audioPanel.hidden = kind !== 'audio';
  els.videoPanel.hidden = kind !== 'video';
  els.download.textContent = kind === 'audio' ? 'Descargar audio' : 'Descargar video';
}

els.seg.addEventListener('click', e => {
  const b = e.target.closest('.seg-btn');
  if (b) setKind(b.dataset.kind);
});
els.compatible.addEventListener('change', renderVideo);

function renderInfo() {
  const i = state.info;
  els.thumb.src = i.thumbnail || '';
  els.duration.textContent = fmtTime(i.duration);
  els.duration.hidden = !i.duration;
  els.title.textContent = i.title;
  els.channel.textContent = i.channel;
  state.height = null;
  renderAudio();
  renderVideo();
  setKind(state.kind);
  els.result.hidden = false;
}

// ---------- Descargar ----------

els.download.addEventListener('click', async () => {
  const i = state.info;
  if (!i) return;
  const audioLabel = { original: `Audio original (.${i.audio ? i.audio.ext : 'audio'})`, mp3: 'Audio MP3', m4a: 'Audio M4A', wav: 'Audio WAV' };
  const label = state.kind === 'audio'
    ? audioLabel[state.audioFormat]
    : `Video ${state.height ? state.height + 'p' : ''}${els.compatible.checked ? ' · compatible' : ''}`;

  els.download.disabled = true;
  try {
    await api('/api/download', {
      method: 'POST',
      body: JSON.stringify({
        url: i.url, videoId: i.id, title: i.title, thumbnail: i.thumbnail, label,
        kind: state.kind, audioFormat: state.audioFormat,
        height: state.height, compatible: els.compatible.checked,
      }),
    });
    els.jobsWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    showStatus('error', e.message);
  } finally {
    setTimeout(() => { els.download.disabled = false; }, 600);
  }
});

// ---------- Progreso en vivo ----------

const jobNodes = new Map();

function renderJob(job) {
  let li = jobNodes.get(job.id);
  if (!li) {
    li = els.tplJob.content.firstElementChild.cloneNode(true);
    li.querySelector('.job-thumb').src = job.thumbnail || '';
    li.querySelector('.job-title').textContent = job.title;
    li.querySelector('.job-action').addEventListener('click', () => {
      const j = li._job;
      if (j.status === 'downloading' || j.status === 'processing' || j.status === 'starting') {
        api(`/api/jobs/${j.id}/cancel`, { method: 'POST' });
      } else if (j.status === 'done') {
        api('/api/reveal', { method: 'POST', body: JSON.stringify({ name: j.file }) });
      } else {
        api(`/api/jobs/${j.id}`, { method: 'DELETE' });
        li.remove();
        jobNodes.delete(j.id);
        syncJobsVisibility();
      }
    });
    jobNodes.set(job.id, li);
    els.jobs.prepend(li);
  }
  li._job = job;
  li.className = `job ${job.status}`;

  const pct = job.status === 'done' || job.status === 'processing' ? 100 : job.percent;
  li.querySelector('.bar-fill').style.transform = `scaleX(${pct / 100})`;

  const stage = job.status === 'error' ? job.error : job.status === 'done' ? `Listo · ${job.label}` : `${job.stage} · ${job.label}`;
  li.querySelector('.job-stage').textContent = stage;

  let numbers = '';
  if (job.status === 'downloading') {
    numbers = `${Math.floor(job.percent)} %`;
    if (job.speed) numbers += ` · ${fmtBytes(job.speed)}/s`;
    if (job.eta) numbers += ` · faltan ${fmtTime(job.eta)}`;
  } else if (job.status === 'done') {
    numbers = fmtBytes(job.size);
  }
  li.querySelector('.job-numbers').textContent = numbers;

  const action = li.querySelector('.job-action');
  const running = ['starting', 'downloading', 'processing'].includes(job.status);
  action.textContent = running ? 'Cancelar' : job.status === 'done' ? 'Mostrar' : 'Quitar';

  syncJobsVisibility();
  if (job.status === 'done') loadFiles();
}

function syncJobsVisibility() {
  els.jobsWrap.hidden = jobNodes.size === 0;
}

function connect() {
  const es = new EventSource('/api/events');
  es.onmessage = e => renderJob(JSON.parse(e.data));
  es.onerror = () => { es.close(); setTimeout(connect, 2000); };
}

// ---------- Descargados ----------

const ICONS = {
  audio: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M9 18.5a3 3 0 1 1-2-2.83V5.6a1 1 0 0 1 .76-.97l10-2.5A1 1 0 0 1 19 3.1v12.4a3 3 0 1 1-2-2.83V7.28l-8 2v9.22Z"/></svg>',
  video: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M4 5h11a2 2 0 0 1 2 2v1.38l3.55-2.13A1 1 0 0 1 22 7.1v9.8a1 1 0 0 1-1.45.86L17 15.62V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/></svg>',
};

async function loadFiles() {
  const files = await api('/api/files').catch(() => []);
  els.filesEmpty.hidden = files.length > 0;
  els.files.replaceChildren(...files.map(f => {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    const isVideo = ['mp4', 'mkv', 'webm', 'mov'].includes(ext);
    const li = document.createElement('li');
    li.className = 'file';
    li.innerHTML = `
      <span class="file-icon" aria-hidden="true">${isVideo ? ICONS.video : ICONS.audio}</span>
      <div class="file-main"><div class="file-name"></div><div class="file-info"></div></div>
      <div class="file-actions">
        <button type="button" class="btn ghost small" data-act="play" aria-expanded="false">Reproducir</button>
        <button type="button" class="btn ghost small" data-act="reveal">Mostrar en carpeta</button>
      </div>`;
    li.querySelector('.file-name').textContent = f.name.replace(/ \[[\w-]{11}\](?=\.\w+$)/, '');
    li.querySelector('.file-name').title = f.name;
    li.querySelector('.file-info').textContent = `${ext.toUpperCase()} · ${fmtBytes(f.size)} · ${fmtDate(f.mtime)}`;
    li.querySelector('[data-act="play"]').addEventListener('click', e => togglePlayer(li, f.name, isVideo, e.currentTarget));
    li.querySelector('[data-act="reveal"]').addEventListener('click', () =>
      api('/api/reveal', { method: 'POST', body: JSON.stringify({ name: f.name }) }));
    return li;
  }));
}

// Un solo reproductor abierto a la vez, debajo del archivo que se está oyendo.
let openPlayer = null;
function togglePlayer(li, name, isVideo, btn) {
  const same = openPlayer && openPlayer.li === li;
  if (openPlayer) {
    openPlayer.el.pause();
    openPlayer.wrap.remove();
    openPlayer.btn.textContent = 'Reproducir';
    openPlayer.btn.setAttribute('aria-expanded', 'false');
    openPlayer = null;
  }
  if (same) return;

  const wrap = document.createElement('div');
  wrap.className = 'player';
  const el = document.createElement(isVideo ? 'video' : 'audio');
  el.controls = true;
  el.autoplay = true;
  el.preload = 'metadata';
  el.src = `/media/${encodeURIComponent(name)}`;
  // Si el navegador no sabe abrir ese formato, lo abre Windows con su reproductor.
  el.addEventListener('error', () => {
    wrap.remove();
    btn.textContent = 'Reproducir';
    openPlayer = null;
    api('/api/play', { method: 'POST', body: JSON.stringify({ name }) });
  });
  wrap.append(el);
  li.append(wrap);
  btn.textContent = 'Cerrar';
  btn.setAttribute('aria-expanded', 'true');
  openPlayer = { li, el, wrap, btn };
}

els.openFolder.addEventListener('click', () => api('/api/reveal', { method: 'POST', body: '{}' }));

// ---------- Versión y actualización ----------

async function loadVersion() {
  const { version } = await api('/api/version').catch(() => ({ version: '?' }));
  els.version.textContent = version || 'no encontrado';
}

els.update.addEventListener('click', async () => {
  els.update.disabled = true;
  els.update.textContent = 'Actualizando…';
  try {
    const r = await api('/api/update', { method: 'POST', body: '{}' });
    els.version.textContent = r.after;
    els.update.textContent = r.updated ? `Actualizado a ${r.after}` : 'Ya tienes la última versión';
  } catch (e) {
    els.update.textContent = 'No se pudo actualizar';
  } finally {
    setTimeout(() => { els.update.disabled = false; els.update.textContent = 'Buscar actualización'; }, 4000);
  }
});

connect();
loadFiles();
loadVersion();
els.url.focus();
