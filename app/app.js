/* FORJA Luis · app
 * Sin dependencias. Guarda primero en el teléfono y una cola sube los cambios
 * al Apps Script cuando hay red. Google Sheets es la fuente de verdad.
 */
'use strict';

const VERSION = '1.0.0';
const BLOQUEO_MS = 2 * 60 * 1000;

/* ================================================================== */
/* Almacenamiento local                                               */
/* ================================================================== */

const LS = {
  get(k, d) {
    try { const v = localStorage.getItem('forja-luis:' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('forja-luis:' + k, JSON.stringify(v)); } catch (_) { /* sin espacio o privado */ }
  }
};

const HOJAS = ['Habitos', 'Marcas', 'Ejercicios', 'Sesiones', 'Series',
  'Alimentos', 'Comidas', 'Peso', 'Config'];
const vacias = () => Object.fromEntries(HOJAS.map(h => [h, []]));
const HOJAS_FIN = ['Cuentas', 'Movimientos', 'Tarjetas', 'EstadosTarjeta', 'Convenios', 'Presupuestos', 'Proyectos', 'ProyectoProductos', 'Tareas'];
const vaciasFin = () => Object.fromEntries(HOJAS_FIN.map(h => [h, []]));
/** Producción salvo en los previews de Vercel (dominio con "-git-"), o si se eligió otra cosa en Ajustes. */
const ENTORNO_DEFECTO = /-git-|localhost|127\.0\.0\.1/.test(location.hostname) ? 'pruebas' : 'produccion';

const S = {
  cfg: LS.get('cfg', { url: '', clave: '' }),
  p: Object.assign(vacias(), LS.get('personal', {})),
  f: Object.assign(vaciasFin(), LS.get('finanzas', {})),
  ambito: LS.get('ambito', 'personal') === 'proyectos' ? 'proyectos' : 'personal',
  cola: LS.get('cola', []),
  fallidas: LS.get('fallidas', []),
  sync: LS.get('sync', { ultimo: null, error: null }),
  tab: LS.get('tab', 'inicio'),
  ui: { cuerpo: 'gym', diaGym: null, g: {}, fin: 'movimientos', filtro: 'mes', proyecto: null }
};

function guardar() {
  LS.set('cfg', S.cfg); LS.set('personal', S.p); LS.set('finanzas', S.f); LS.set('ambito', S.ambito); LS.set('tab', S.tab); LS.set('cola', S.cola);
  LS.set('fallidas', S.fallidas.slice(-50)); LS.set('sync', S.sync);
}

/* ================================================================== */
/* Utilidades                                                         */
/* ================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = x => { const v = Number(String(x == null ? '' : x).replace(/[$,\s]/g, '')); return isFinite(v) ? v : 0; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const activo = f => String(f.activo) !== 'false';
const pad = x => String(x).padStart(2, '0');

const aStr = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const aFecha = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const hoy = () => aStr(new Date());
const sumar = (s, k) => { const d = aFecha(s); d.setDate(d.getDate() + k); return aStr(d); };
const dow = s => aFecha(s).getDay(); // 0 = domingo
const entre = (a, b) => Math.round((aFecha(b) - aFecha(a)) / 864e5);

const DIA_CORTO = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const DIA_LARGO = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaCorta = s => { const d = aFecha(s); return d.getDate() + ' ' + MES_CORTO[d.getMonth()]; };
const hace = d => d === 0 ? 'hoy' : d === 1 ? 'ayer' : 'hace ' + d + ' días';

/** Pesos sin decimales. Negativos con signo menos real. */
function mxn(x, { sinSigno = false } = {}) {
  const v = Math.round(n(x));
  const s = '$' + Math.abs(v).toLocaleString('es-MX');
  return v < 0 && !sinSigno ? '−' + s : s;
}
/** Número grande con el signo de moneda chico. */
function mxnGrande(x) {
  const v = Math.round(n(x));
  return (v < 0 ? '−' : '') + '<span class="c">$</span>' + Math.abs(v).toLocaleString('es-MX');
}
const cfg = (k, d = '') => { const f = S.p.Config.find(c => c.id === k); return f && f.valor !== '' ? f.valor : d; };

/* ================================================================== */
/* Datos locales + cola                                               */
/* ================================================================== */

function upsertLocal(hoja, fila, libro) {
  const base = libro === 'finanzas' ? S.f : S.p;
  const arr = base[hoja] || (base[hoja] = []);
  const i = arr.findIndex(f => String(f.id) === String(fila.id));
  if (i >= 0) arr[i] = Object.assign({}, arr[i], fila); else arr.push(fila);
}
function borrarLocal(hoja, ref, libro) {
  const base = libro === 'finanzas' ? S.f : S.p;
  base[hoja] = (base[hoja] || []).filter(f => String(f.id) !== String(ref));
}
function aplicarLocal(op) {
  if (op.tipo === 'put') upsertLocal(op.hoja, op.fila, op.libro);
  else if (op.tipo === 'del') borrarLocal(op.hoja, op.ref, op.libro);
}
function encolar(op) {
  op.id = op.id || uid();
  S.cola.push(op);
  guardar();
  programarSync();
  return op.id;
}
function put(hoja, fila) { const op = { tipo: 'put', hoja, fila }; aplicarLocal(op); return encolar(op); }
function del(hoja, ref) { const op = { tipo: 'del', hoja, ref }; aplicarLocal(op); return encolar(op); }
/** Lo mismo, sobre las hojas de finanzas (personal y proyectos). */
function putF(hoja, fila) { const op = { tipo: 'put', libro: 'finanzas', hoja, fila }; aplicarLocal(op); return encolar(op); }

/* ================================================================== */
/* Sincronización con el Apps Script                                  */
/* ================================================================== */

let sincronizando = false, fase = '', timerSync = null;
const entorno = () => S.cfg.entorno || ENTORNO_DEFECTO;
const conectado = () => !!(S.cfg.url && S.cfg.clave);

function programarSync(ms = 700) {
  clearTimeout(timerSync);
  timerSync = setTimeout(() => sincronizar(), ms);
}

async function llamar(opts, ms = 25000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(opts.url, Object.assign({ redirect: 'follow', signal: ctl.signal, cache: 'no-store' }, opts.init || {}));
    if (!r.ok) throw new Error('El servidor respondió ' + r.status);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error === 'clave' ? 'La clave no coincide con la del Apps Script' : (j.error || 'Error del Apps Script'));
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Sin respuesta del Apps Script');
    if (e instanceof TypeError) throw new Error('Sin conexión');
    throw e;
  } finally { clearTimeout(t); }
}
const leer = () => llamar({ url: S.cfg.url + (S.cfg.url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(S.cfg.clave) + '&entorno=' + entorno() });
const enviar = (body, ms) => llamar({
  url: S.cfg.url,
  init: { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ token: S.cfg.clave, entorno: entorno() }, body)) }
}, ms);

async function sincronizar({ silencioso = true } = {}) {
  if (!conectado() || sincronizando) return;
  sincronizando = true; fase = 'enviando'; pintarEstado();
  try {
    while (S.cola.length) {
      const lote = S.cola.slice(0, 40);
      const r = await enviar({ ops: lote });
      const res = r.resultados || [];
      lote.forEach((op, i) => {
        const x = res[i] || { ok: false, error: 'sin respuesta' };
        if (!x.ok) S.fallidas.push({ op, error: x.error, cuando: Date.now() });
      });
      S.cola = S.cola.slice(lote.length);
      guardar();
    }
    fase = 'leyendo'; pintarEstado();
    const r = await leer();
    if (r.personal) S.p = Object.assign(vacias(), r.personal);
    if (r.finanzas) S.f = Object.assign(vaciasFin(), r.finanzas);
    S.sinFinanzas = !r.finanzas;
    S.cola.forEach(aplicarLocal); // lo que se encoló mientras leíamos
    S.sync = { ultimo: Date.now(), error: null };
    if (!silencioso) avisar('Al día con Google Sheets');
  } catch (e) {
    S.sync.error = e.message;
    if (!silencioso) avisar(e.message, { error: true });
  } finally {
    sincronizando = false; fase = '';
    guardar();
    render();
  }
}

function pintarEstado() {
  const el = $('#estado');
  const hora = S.sync.ultimo ? new Date(S.sync.ultimo).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '';
  let e = 'ok', t = 'Al día · ' + hora;
  if (!conectado()) { e = 'off'; t = 'Sin conectar'; }
  else if (sincronizando) { e = 'sync'; t = fase === 'leyendo' ? 'Leyendo' : 'Enviando ' + S.cola.length; }
  else if (!S.sync.ultimo) { e = 'off'; t = 'Nunca sincronizado'; }
  else if (S.sync.error && S.cola.length) { e = 'error'; t = S.cola.length + ' sin enviar'; }
  else if (S.sync.error) { e = 'error'; t = 'Sin conexión'; }
  else if (S.cola.length) { e = 'cola'; t = S.cola.length + ' por enviar'; }
  if (S.fallidas.length && e === 'ok') { e = 'error'; t = S.fallidas.length + ' con error'; }
  el.dataset.e = e;
  el.textContent = t;
}

/* ================================================================== */
/* Candado                                                            */
/* ================================================================== */

const Candado = {
  modo: null, buffer: '', primero: '', intentos: 0, esperaHasta: 0,
  async hash(pin) {
    let sal = LS.get('sal', null);
    if (!sal) { sal = uid(); LS.set('sal', sal); }
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sal + ':' + pin));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },
  abrir(modo) {
    this.modo = modo || (LS.get('pin', null) ? 'abrir' : 'crear');
    this.buffer = ''; this.primero = '';
    $('#app').setAttribute('aria-hidden', 'true');
    $('#candado').hidden = false;
    this.pintar(this.modo === 'abrir' ? 'Escribe tu código' : 'Crea un código de 4 dígitos');
  },
  cerrar() {
    $('#candado').hidden = true;
    $('#app').removeAttribute('aria-hidden');
    LS.set('ultimaVez', Date.now());
  },
  pintar(msg, mal) {
    const puntos = [0, 1, 2, 3].map(i => `<i class="${i < this.buffer.length ? 'lleno' : ''}"></i>`).join('');
    const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map(k =>
      k === '' ? '<span class="vacia"></span>'
        : k === '⌫' ? '<button type="button" class="borrar" data-a="pin-borrar" aria-label="Borrar">Borrar</button>'
          : `<button type="button" data-a="pin" data-k="${k}">${k}</button>`).join('');
    $('#candado').innerHTML = `<div class="candado-in">
      <h1>FORJA</h1><p>${esc(msg)}</p>
      <div class="puntos${mal ? ' mal' : ''}" aria-label="${this.buffer.length} de 4">${puntos}</div>
      <div class="teclado">${teclas}</div></div>`;
  },
  async tecla(k) {
    if (Date.now() < this.esperaHasta) return;
    if (this.buffer.length >= 4) return;
    this.buffer += k;
    this.pintar(this.mensaje());
    if (this.buffer.length < 4) return;
    const pin = this.buffer;
    if (this.modo === 'crear') {
      this.modo = 'confirmar'; this.primero = pin; this.buffer = '';
      return this.pintar('Escríbelo otra vez');
    }
    if (this.modo === 'confirmar') {
      if (pin !== this.primero) { this.modo = 'crear'; this.buffer = ''; return this.pintar('No coincidió. Crea el código de nuevo', true); }
      LS.set('pin', await this.hash(pin));
      this.cerrar(); avisar('Código guardado en este teléfono'); return iniciar();
    }
    if (await this.hash(pin) === LS.get('pin', null)) {
      this.intentos = 0; this.cerrar(); return alAbrir();
    }
    this.intentos++; this.buffer = '';
    if (this.intentos >= 5) {
      this.esperaHasta = Date.now() + 30000;
      return this.pintar('Demasiados intentos. Espera 30 segundos', true);
    }
    this.pintar('Código incorrecto', true);
  },
  mensaje() {
    return this.modo === 'abrir' ? 'Escribe tu código' : this.modo === 'confirmar' ? 'Escríbelo otra vez' : 'Crea un código de 4 dígitos';
  }
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { LS.set('ultimaVez', Date.now()); return; }
  if (LS.get('pin', null) && Date.now() - LS.get('ultimaVez', 0) > BLOQUEO_MS) Candado.abrir('abrir');
  else alAbrir();
});

/* ================================================================== */
/* Cálculos                                                           */
/* ================================================================== */

function diasDe(h) { return String(h.dias == null ? '' : h.dias).split(/[,|]/).filter(x => x !== '').map(Number); }
function aplicaEn(h, f) { return diasDe(h).includes(dow(f)); }

function marcasSet(hoja, campo) {
  const s = new Set();
  (S.p[hoja] || []).forEach(m => s.add(m[campo] + ':' + m.fecha));
  return s;
}

/** Racha actual y récord de un hábito. Los días en que no aplica no rompen la racha. */
function rachaHabito(h, set) {
  const inicio = String(h.creado || cfg('disciplina_inicio') || hoy());
  const marcado = f => set.has(h.id + ':' + f);
  const t = hoy();
  let actual = 0, f = t;
  if (aplicaEn(h, f) && !marcado(f)) f = sumar(f, -1);
  for (let i = 0; i < 800 && f >= inicio; i++, f = sumar(f, -1)) {
    if (!aplicaEn(h, f)) continue;
    if (marcado(f)) actual++; else break;
  }
  let record = 0, corrida = 0;
  for (let d = inicio, i = 0; d <= t && i < 2000; d = sumar(d, 1), i++) {
    if (!aplicaEn(h, d)) continue;
    if (marcado(d)) { corrida++; record = Math.max(record, corrida); } else if (d !== t) corrida = 0;
  }
  return { actual, record };
}

function habitosHoy() { return S.p.Habitos.filter(h => activo(h) && aplicaEn(h, hoy())); }
function habitosPendientes() {
  const set = marcasSet('Marcas', 'habito_id');
  return habitosHoy().filter(h => !set.has(h.id + ':' + hoy())).length;
}

/* ================================================================== */
/* Vistas                                                             */
/* ================================================================== */

const VISTAS = {};

function encabezado(eyebrow, titulo, lema) {
  return `<header class="encabezado"><div class="eyebrow">${esc(eyebrow)}</div>
    <h1 class="titulo">${esc(titulo)}</h1>${lema ? `<p class="lema">${esc(lema)}</p>` : ''}</header>`;
}
function sinConexion() {
  return `<div class="card"><div class="card-tit"><h2>Conecta FORJA con Google Sheets</h2></div>
    <p class="sub">Pega la URL del Apps Script y tu clave. Se guardan solo en este teléfono.</p>
    <div style="margin-top:12px"><button class="btn" type="button" data-a="ajustes">Conectar</button></div></div>`;
}

function campo(label, nombre, valor, extra = '') {
  return `<label class="campo"><span>${label}</span><input id="f-${nombre}" data-f="${nombre}" value="${esc(valor)}" ${extra}></label>`;
}
function campoDinero(label, nombre, valor) {
  return `<label class="campo"><span>${label}</span><div class="pre"><em>$</em><input id="f-${nombre}" class="num-in" data-f="${nombre}" value="${esc(valor)}" inputmode="decimal" autocomplete="off" placeholder="0"></div></label>`;
}
/* ---------- 3 · Disciplina ---------- */
VISTAS.disciplina = () => {
  const t = hoy();
  const set = marcasSet('Marcas', 'habito_id');
  const lista = S.p.Habitos.filter(activo).sort((a, b) => n(a.orden) - n(b.orden));
  const deHoy = lista.filter(h => aplicaEn(h, t));
  const hechos = deHoy.filter(h => set.has(h.id + ':' + t)).length;
  const semana = Array.from({ length: 7 }, (_, i) => sumar(t, i - 6));

  let html = encabezado('Disciplina', `${hechos} de ${deHoy.length}`, 'Lo que haces todos los días, aunque nadie lo vea.');
  html += `<div class="barra-p" style="margin:0 2px"><i style="width:${deHoy.length ? hechos / deHoy.length * 100 : 0}%"></i></div>`;

  const orden = [...deHoy, ...lista.filter(h => !aplicaEn(h, t))];
  html += orden.map(h => {
    const ok = set.has(h.id + ':' + t);
    const aplica = aplicaEn(h, t);
    const r = rachaHabito(h, set);
    return `<article class="card habito ${ok ? 'hecho' : ''}">
      <div class="habito-cab">
        <span class="txt"><b>${esc(h.nombre)}</b><small>${aplica ? esc(h.nota || '') : 'Hoy no aplica'}</small></span>
        ${aplica ? `<button type="button" class="btn-check" data-a="marcar" data-id="${esc(h.id)}" data-f="${t}" aria-pressed="${ok}" aria-label="${ok ? 'Desmarcar' : 'Marcar'} ${esc(h.nombre)}">
          <span class="check"><svg class="ico"><use href="#i-check"/></svg></span></button>` : ''}
      </div>
      <div class="racha"><span class="fuego">Racha <b>${r.actual}</b></span><span>Récord <b>${r.record}</b></span>
        <button type="button" class="btn-3" data-a="editar-habito" data-id="${esc(h.id)}" style="margin-left:auto;min-height:28px;font-size:13px">Editar</button></div>
      <div class="semana">${semana.map(f => {
        const ap = aplicaEn(h, f);
        const si = set.has(h.id + ':' + f);
        return `<button type="button" class="dia-p ${si ? 'si' : ''} ${ap ? '' : 'no-aplica'} ${f === t ? 'hoy' : ''}" data-a="marcar" data-id="${esc(h.id)}" data-f="${f}"
          aria-label="${DIA_LARGO[dow(f)]} ${fechaCorta(f)}: ${si ? 'hecho' : ap ? 'pendiente' : 'no aplica'}" ${ap ? '' : 'disabled'}>${DIA_CORTO[dow(f)]}<i></i></button>`;
      }).join('')}</div>
    </article>`;
  }).join('');
  html += `<button type="button" class="btn btn-2" data-a="editar-habito"><svg class="ico"><use href="#i-mas"/></svg>Nuevo hábito</button>`;
  return html;
};

/* ---------- 4 · Cuerpo ---------- */
const DIAS_GYM = { pierna: 'Pierna', empuje: 'Empuje', tiron: 'Tirón', brazos: 'Brazos', torso: 'Torso', libre: 'Libre', off: 'Descanso' };
const plan = () => String(cfg('plan', 'pierna,empuje,tiron,brazos,torso,libre,off')).split(',');
const diaPlan = f => plan()[(dow(f) + 6) % 7] || 'libre';
const nombreEj = id => { const e = S.p.Ejercicios.find(x => x.id === id); return e ? e.nombre : String(id).replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()); };

VISTAS.cuerpo = () => {
  let html = `<div class="seg" role="group" aria-label="Cuerpo">${[['gym', 'Gym'], ['comida', 'Comida']].map(([k, t]) =>
    `<button type="button" data-a="cuerpo-modo" data-v="${k}" aria-pressed="${S.ui.cuerpo === k}">${t}</button>`).join('')}</div>`;
  return html + (S.ui.cuerpo === 'gym' ? vistaGym() : vistaComida());
};

function vistaGym() {
  const t = hoy();
  const lunes = sumar(t, -((dow(t) + 6) % 7));
  const semana = Array.from({ length: 7 }, (_, i) => sumar(lunes, i));
  const sel = S.ui.diaGym || diaPlan(t);
  const inicio = cfg('ciclo_inicio');
  const nSemana = inicio ? Math.floor(entre(inicio, t) / 7) + 1 : null;
  const conSeries = new Set(S.p.Series.map(s => s.fecha));

  let html = encabezado('Gym' + (nSemana ? ' · Semana ' + nSemana + (nSemana <= 7 ? ' de 7' : '') : ''), DIAS_GYM[sel] || sel,
    sel === diaPlan(t) ? 'Lo que toca hoy.' : 'Viendo otro día. Lo que registres cuenta para hoy.');
  html += `<div class="dias" role="group" aria-label="Días de la semana">${semana.map(f => {
    const d = diaPlan(f);
    return `<button type="button" class="dia ${f === t ? 'hoy' : ''} ${conSeries.has(f) ? 'hecho' : ''}" data-a="dia-gym" data-v="${d}" aria-pressed="${d === sel}">
      ${DIA_CORTO[dow(f)]}<i>${esc((DIAS_GYM[d] || d).slice(0, 7))}</i></button>`;
  }).join('')}</div>`;

  const ejercicios = S.p.Ejercicios.filter(e => activo(e) && e.dia === sel).sort((a, b) => n(a.orden) - n(b.orden));
  const hoySeries = S.p.Series.filter(s => s.fecha === t);
  if (sel === 'off') return html + `<div class="card"><p class="vacio">Descanso. El músculo crece hoy.</p></div>`;

  html += ejercicios.map(e => tarjetaEjercicio(e, hoySeries)).join('');
  if (!ejercicios.length) html += `<div class="card"><p class="vacio">Este día no tiene ejercicios todavía.</p></div>`;
  html += `<button type="button" class="btn btn-2" data-a="nuevo-ejercicio" data-v="${esc(sel)}"><svg class="ico"><use href="#i-mas"/></svg>Agregar ejercicio a ${esc(DIAS_GYM[sel] || sel)}</button>`;
  return html;
}

function historialEj(id) {
  const t = hoy();
  const previas = S.p.Series.filter(s => s.ejercicio_id === id && s.fecha < t);
  const ultFecha = previas.reduce((m, s) => s.fecha > m ? s.fecha : m, '');
  const ultima = previas.filter(s => s.fecha === ultFecha).sort((a, b) => n(a.n) - n(b.n));
  const todas = S.p.Series.filter(s => s.ejercicio_id === id);
  const pr = todas.reduce((m, s) => (!m || n(s.kg) > n(m.kg) || (n(s.kg) === n(m.kg) && n(s.reps) > n(m.reps))) ? s : m, null);
  return { ultFecha, ultima, pr };
}

function tarjetaEjercicio(e, hoySeries) {
  const mias = hoySeries.filter(s => s.ejercicio_id === e.id).sort((a, b) => n(a.n) - n(b.n));
  const h = historialEj(e.id);
  const ref = mias[mias.length - 1] || h.ultima[mias.length] || h.ultima[h.ultima.length - 1];
  const val = S.ui.g[e.id] || (S.ui.g[e.id] = { kg: ref ? n(ref.kg) : '', reps: ref ? n(ref.reps) : '' });
  const meta = [e.esquema, e.descanso_s ? (n(e.descanso_s) >= 60 && n(e.descanso_s) % 60 === 0 ? n(e.descanso_s) / 60 + ' min' : e.descanso_s + ' s') : ''].filter(Boolean).join(' · ');
  return `<article class="card ej">
    <div class="ej-cab"><b>${esc(e.nombre)}</b>${h.pr ? `<span class="sub" style="white-space:nowrap">Mejor <b class="t2">${n(h.pr.kg)} × ${n(h.pr.reps)}</b></span>` : ''}</div>
    <div class="ej-meta">${esc(meta || 'Sin esquema')}${h.ultFecha ? ' · ' + fechaCorta(h.ultFecha) + ': ' + h.ultima.map(s => n(s.kg) + '×' + n(s.reps)).join(', ') : ' · sin registro'}</div>
    ${e.nota ? `<div class="sub" style="margin-top:4px">${esc(e.nota)}</div>` : ''}
    ${mias.length ? `<div class="series">${mias.map((s, i) => `<span class="serie"><em>${i + 1}</em>${n(s.kg)} kg × ${n(s.reps)}
      <button type="button" data-a="borrar-serie" data-id="${esc(s.id)}" aria-label="Borrar serie ${i + 1}"><svg class="ico"><use href="#i-x"/></svg></button></span>`).join('')}</div>` : ''}
    <div class="registrar">
      <label class="campo"><span>kg</span><input class="num-in" data-g="${esc(e.id)}" data-k="kg" value="${esc(val.kg)}" inputmode="decimal" aria-label="Kilos de ${esc(e.nombre)}"></label>
      <label class="campo"><span>reps</span><input class="num-in" data-g="${esc(e.id)}" data-k="reps" value="${esc(val.reps)}" inputmode="numeric" aria-label="Repeticiones de ${esc(e.nombre)}"></label>
      <button type="button" class="btn" data-a="serie" data-id="${esc(e.id)}">Serie ${mias.length + 1}</button>
    </div>
  </article>`;
}

function proteinaMeta() {
  const pesos = S.p.Peso.slice().sort((a, b) => a.fecha < b.fecha ? 1 : -1);
  const kg = pesos.length ? n(pesos[0].kg) : n(cfg('peso_kg', 0));
  const factor = n(cfg('factor_proteina', 1.8)) || 1.8;
  return { kg, factor, meta: Math.round(kg * factor), pesos };
}

function vistaComida() {
  const t = hoy();
  const { kg, factor, meta, pesos } = proteinaMeta();
  const deHoy = S.p.Comidas.filter(c => c.fecha === t);
  const total = deHoy.reduce((a, c) => a + n(c.proteina), 0);
  const faltan = Math.max(0, meta - total);
  const desde = sumar(t, -30);
  const uso = {};
  S.p.Comidas.forEach(c => { if (c.fecha >= desde) uso[c.alimento_id] = (uso[c.alimento_id] || 0) + 1; });
  const alimentos = S.p.Alimentos.filter(activo).sort((a, b) => (uso[b.id] || 0) - (uso[a.id] || 0) || String(a.nombre).localeCompare(b.nombre));
  const visibles = S.ui.todos ? alimentos : alimentos.slice(0, 8);

  let html = encabezado('Alimentación', 'Proteína', 'Proteína, no teatro de calorías.');
  html += `<section class="card"><div class="kpi">
      <div><span class="lbl">Hoy</span><div class="num num-xl" style="margin-top:6px">${Math.round(total)}<span class="u">/ ${meta} g</span></div></div>
      <div style="text-align:right"><span class="lbl">${faltan ? 'Faltan' : 'Meta'}</span><div class="num num-l ${faltan ? 'warn' : 'pos'}" style="margin-top:6px">${faltan ? faltan + '<span class="u">g</span>' : 'Lista'}</div></div></div>
    <div class="barra-p"><i style="width:${meta ? Math.min(100, total / meta * 100) : 0}%"></i></div>
    <p class="sub" style="margin-top:10px">${kg ? kg + ' kg × ' + factor + ' g por kilo' : 'Registra tu peso para calcular la meta'}</p></section>`;

  html += `<section class="card"><div class="card-tit"><h2>Agregar</h2><span class="meta">un toque = una porción</span></div>
    <div class="alimentos">${visibles.map(a => `<button type="button" class="alimento" data-a="comer" data-id="${esc(a.id)}">
      <b>${esc(a.nombre)}</b><small>${n(a.proteina)} g · ${esc(a.porcion)}</small></button>`).join('')}</div>
    <div style="display:flex;justify-content:space-between;margin-top:8px">
      ${alimentos.length > 8 ? `<button type="button" class="btn-3" data-a="todos">${S.ui.todos ? 'Ver menos' : 'Ver los ' + alimentos.length}</button>` : '<span></span>'}
      <button type="button" class="btn-3" data-a="nuevo-alimento">Nuevo alimento</button></div></section>`;

  html += `<section class="card"><div class="card-tit"><h2>Hoy comiste</h2><span class="meta">${deHoy.length} ${deHoy.length === 1 ? 'registro' : 'registros'}</span></div>
    <div class="lista">${deHoy.length ? deHoy.slice().reverse().map(c => `<div class="fila"><span class="txt"><b>${esc(c.nombre)}</b>
      <small>${n(c.porciones) !== 1 ? n(c.porciones) + ' porciones · ' : ''}${n(c.proteina)} g</small></span>
      <button type="button" class="btn-3" data-a="borrar-comida" data-id="${esc(c.id)}" aria-label="Quitar ${esc(c.nombre)}">Quitar</button></div>`).join('')
      : '<p class="vacio">Nada todavía.</p>'}</div></section>`;

  const prom = pesos.filter(p => p.fecha >= sumar(t, -6));
  const promedio = prom.length ? prom.reduce((a, p) => a + n(p.kg), 0) / prom.length : null;
  const pesoHoy = pesos.find(p => p.fecha === t);
  html += `<section class="card"><div class="card-tit"><h2>Peso</h2><span class="meta">${pesos.length ? 'último ' + fechaCorta(pesos[0].fecha) : 'sin registros'}</span></div>
    <div class="kpis" style="margin-top:0">
      <div><span class="lbl">Último</span><span class="num num-m">${pesos.length ? n(pesos[0].kg) + '<span class="u">kg</span>' : '—'}</span></div>
      <div><span class="lbl">Promedio 7 días</span><span class="num num-m">${promedio ? promedio.toFixed(1) + '<span class="u">kg</span>' : '—'}</span></div></div>
    <div class="registrar" style="grid-template-columns:1fr auto">
      <label class="campo"><span>${pesoHoy ? 'Peso de hoy (corrige si hace falta)' : 'Peso de esta mañana, en ayunas'}</span>
        <input id="f-peso" class="num-in" inputmode="decimal" value="${pesoHoy ? esc(pesoHoy.kg) : ''}" placeholder="kg"></label>
      <button type="button" class="btn" data-a="peso">Anotar</button></div>
    <p class="sub" style="margin-top:8px">La báscula manda el promedio, no el día.</p></section>`;
  return html;
}

/* ================================================================== */
/* Render                                                             */
/* ================================================================== */

let renderPendiente = false;
function escribiendo() {
  const a = document.activeElement;
  return a && $('#vista').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
}
function render({ forzar = false } = {}) {
  pintarEstado();
  $$('#tabs button').forEach(b => {
    if (b.dataset.tab === S.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const ph = habitosPendientes();
  $$('[data-ambito]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ambito === S.ambito)));
  document.body.dataset.ambito = S.ambito;
  document.body.dataset.entorno = entorno();
  $('[data-badge="disciplina"]').textContent = ph ? ph : '';
  if (!forzar && escribiendo()) { renderPendiente = true; return; }
  renderPendiente = false;
  $('#vista').innerHTML = VISTAS[S.tab]();
}
document.addEventListener('focusout', () => setTimeout(() => { if (renderPendiente && !escribiendo()) render(); }, 0));

function irA(tab) {
  if (S.tab === tab) return window.scrollTo({ top: 0, behavior: 'smooth' });
  S.tab = tab; guardar();
  render({ forzar: true });
  window.scrollTo(0, 0);
}

/* ================================================================== */
/* Avisos y hojas                                                     */
/* ================================================================== */

let timerAviso = null;
function avisar(texto, { error = false, accion = null, alAccion = null } = {}) {
  const el = $('#aviso');
  el.className = 'aviso' + (error ? ' error' : '');
  el.innerHTML = `<span>${esc(texto)}</span>${accion ? `<button type="button" id="aviso-accion">${esc(accion)}</button>` : ''}`;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('ver'));
  if (accion) $('#aviso-accion').onclick = () => { ocultarAviso(); alAccion(); };
  clearTimeout(timerAviso);
  timerAviso = setTimeout(ocultarAviso, accion ? 5000 : 2600);
}
function ocultarAviso() {
  const el = $('#aviso');
  el.classList.remove('ver');
  setTimeout(() => { if (!el.classList.contains('ver')) el.hidden = true; }, 300);
}

let alCerrarHoja = null;
function abrirHoja(titulo, cuerpo, alCerrar) {
  const h = $('#hoja');
  h.innerHTML = `<div class="hoja-cab"><h2 id="hoja-titulo">${esc(titulo)}</h2>
    <button type="button" class="icono-btn" data-a="cerrar-hoja" aria-label="Cerrar"><svg class="ico"><use href="#i-x"/></svg></button></div>${cuerpo}`;
  alCerrarHoja = alCerrar || null;
  $('#velo').hidden = false; h.hidden = false;
  requestAnimationFrame(() => { $('#velo').classList.add('abierto'); h.classList.add('abierto'); });
  h.scrollTop = 0;
}
function cerrarHoja() {
  const h = $('#hoja');
  if (h.hidden) return;
  h.classList.remove('abierto'); $('#velo').classList.remove('abierto');
  setTimeout(() => { h.hidden = true; $('#velo').hidden = true; h.innerHTML = ''; }, 380);
  const f = alCerrarHoja; alCerrarHoja = null;
  if (f) f();
}

/* ================================================================== */
/* Acciones                                                           */
/* ================================================================== */

const A = {};

A.tab = el => irA(el.dataset.tab);
A.ambito = el => { S.ambito = el.dataset.ambito; guardar(); render({ forzar: true }); window.scrollTo(0, 0); };
A.sincronizar = () => {
  if (!conectado()) return A.ajustes();
  if (S.fallidas.length) return A.ajustes();
  sincronizar({ silencioso: false });
};
A['cerrar-hoja'] = () => cerrarHoja();

/* Disciplina */
A.marcar = el => {
  const id = el.dataset.id, f = el.dataset.f, ref = id + ':' + f;
  if (S.p.Marcas.some(m => m.id === ref)) del('Marcas', ref);
  else put('Marcas', { id: ref, fecha: f, habito_id: id, origen: 'app' });
  render({ forzar: true });
};
A['editar-habito'] = el => {
  const h = el.dataset.id ? S.p.Habitos.find(x => x.id === el.dataset.id) : null;
  const dias = h ? diasDe(h) : [1, 2, 3, 4, 5];
  S.ui.diasHabito = dias.slice();
  abrirHoja(h ? 'Editar hábito' : 'Nuevo hábito', `<form class="form" data-form="habito" data-id="${h ? esc(h.id) : ''}">
    ${campo('Nombre', 'h-nombre', h ? h.nombre : '', 'autocomplete="off" placeholder="Leer 20 minutos"')}
    ${campo('Por qué (opcional)', 'h-nota', h ? h.nota : '', 'autocomplete="off"')}
    <div class="campo"><span>Días que aplica</span><div class="chips" role="group">${[1, 2, 3, 4, 5, 6, 0].map(d =>
      `<button type="button" class="chip" data-a="dia-habito" data-v="${d}" aria-pressed="${dias.includes(d)}" aria-label="${DIA_LARGO[d]}">${DIA_CORTO[d]}</button>`).join('')}</div></div>
    <button type="submit" class="btn">${h ? 'Guardar' : 'Agregar hábito'}</button>
    ${h ? `<button type="button" class="btn btn-2 btn-peligro" data-a="archivar-habito" data-id="${esc(h.id)}">Archivar hábito</button>
      <p class="sub">Archivar lo quita de la lista. Sus marcas y rachas se quedan en Google Sheets.</p>` : ''}
  </form>`);
};
A['dia-habito'] = el => {
  const d = Number(el.dataset.v);
  const s = S.ui.diasHabito;
  const i = s.indexOf(d);
  if (i >= 0) s.splice(i, 1); else s.push(d);
  el.setAttribute('aria-pressed', String(i < 0));
};
A['archivar-habito'] = el => {
  const h = S.p.Habitos.find(x => x.id === el.dataset.id);
  if (!h) return;
  put('Habitos', Object.assign({}, h, { activo: 'false' }));
  cerrarHoja(); render({ forzar: true });
  avisar('Hábito archivado', { accion: 'Deshacer', alAccion: () => { put('Habitos', Object.assign({}, h, { activo: 'true' })); render({ forzar: true }); } });
};

/* Cuerpo */
A['cuerpo-modo'] = el => { S.ui.cuerpo = el.dataset.v; render({ forzar: true }); window.scrollTo(0, 0); };
A['dia-gym'] = el => { S.ui.diaGym = el.dataset.v; render({ forzar: true }); };
A.serie = el => {
  const id = el.dataset.id;
  const val = S.ui.g[id] || {};
  const kg = n(val.kg), reps = Math.round(n(val.reps));
  if (!reps) return avisar('Escribe las repeticiones', { error: true });
  const t = hoy();
  const dia = S.ui.diaGym || diaPlan(t);
  let ses = S.p.Sesiones.find(s => s.fecha === t && s.dia === dia);
  if (!ses) { ses = { id: uid(), fecha: t, dia, cerrada: 'false' }; put('Sesiones', ses); }
  const nSerie = S.p.Series.filter(s => s.fecha === t && s.ejercicio_id === id).length;
  put('Series', { id: uid(), sesion_id: ses.id, fecha: t, ejercicio_id: id, n: nSerie, kg, reps, reps_der: '', seg: '', seg_der: '', origen: 'app' });
  if (S.p.Habitos.some(h => h.id === 'seed-entrenar' && activo(h)) && !S.p.Marcas.some(m => m.id === 'seed-entrenar:' + t)) {
    put('Marcas', { id: 'seed-entrenar:' + t, fecha: t, habito_id: 'seed-entrenar', origen: 'gym' });
  }
  render({ forzar: true });
};
A['borrar-serie'] = el => {
  const s = S.p.Series.find(x => x.id === el.dataset.id);
  if (!s) return;
  del('Series', s.id);
  render({ forzar: true });
  avisar('Serie borrada', { accion: 'Deshacer', alAccion: () => { put('Series', s); render({ forzar: true }); } });
};
A['nuevo-ejercicio'] = el => {
  const dia = el.dataset.v;
  abrirHoja('Ejercicio para ' + (DIAS_GYM[dia] || dia), `<form class="form" data-form="ejercicio" data-dia="${esc(dia)}">
    ${campo('Nombre', 'e-nombre', '', 'autocomplete="off" placeholder="Curl con barra"')}
    <div class="dos">${campo('Series × reps', 'e-esquema', '', 'autocomplete="off" placeholder="3×8–12"')}${campo('Descanso (segundos)', 'e-descanso', '', 'inputmode="numeric" placeholder="90"')}</div>
    ${campo('Nota (opcional)', 'e-nota', '', 'autocomplete="off"')}
    <button type="submit" class="btn">Agregar</button></form>`);
};
A.comer = el => {
  const a = S.p.Alimentos.find(x => x.id === el.dataset.id);
  if (!a) return;
  const id = uid();
  put('Comidas', { id, fecha: hoy(), alimento_id: a.id, nombre: a.nombre, porciones: 1, proteina: n(a.proteina), origen: 'app' });
  render({ forzar: true });
  avisar(a.nombre + ' · ' + n(a.proteina) + ' g', { accion: 'Deshacer', alAccion: () => { del('Comidas', id); render({ forzar: true }); } });
};
A['borrar-comida'] = el => {
  const c = S.p.Comidas.find(x => x.id === el.dataset.id);
  if (!c) return;
  del('Comidas', c.id);
  render({ forzar: true });
  avisar(c.nombre + ' quitado', { accion: 'Deshacer', alAccion: () => { put('Comidas', c); render({ forzar: true }); } });
};
A.todos = () => { S.ui.todos = !S.ui.todos; render({ forzar: true }); };
A['nuevo-alimento'] = () => {
  abrirHoja('Nuevo alimento', `<form class="form" data-form="alimento">
    ${campo('Nombre', 'a-nombre', '', 'autocomplete="off" placeholder="Pechuga asada"')}
    <div class="dos">${campo('Porción', 'a-porcion', '', 'autocomplete="off" placeholder="150 g"')}${campo('Proteína (g)', 'a-proteina', '', 'inputmode="decimal" placeholder="40"')}</div>
    <button type="submit" class="btn">Guardar alimento</button></form>`);
};
A.peso = () => {
  const kg = n($('#f-peso').value);
  if (kg < 30 || kg > 250) return avisar('Escribe tu peso en kilos', { error: true });
  put('Peso', { id: 'peso:' + hoy(), fecha: hoy(), kg });
  $('#f-peso').blur();
  render({ forzar: true });
  avisar('Peso anotado: ' + kg + ' kg');
};

/* Candado */
A.pin = el => Candado.tecla(el.dataset.k);
A['pin-borrar'] = () => { Candado.buffer = Candado.buffer.slice(0, -1); Candado.pintar(Candado.mensaje()); };

/* Ajustes */
A.ajustes = () => {
  const c = S.cfg;
  abrirHoja('Ajustes', `
    <section class="seccion" style="margin-top:0"><h3>Conexión con Google Sheets</h3>
      <form class="form" data-form="conexion">
        ${campo('URL del Apps Script', 'url', c.url, 'type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec"')}
        ${campo('Clave', 'clave', c.clave, 'type="password" autocomplete="off" autocapitalize="off" spellcheck="false"')}
        <button type="submit" class="btn">Guardar y probar</button></form>
      <p class="sub">${S.sync.ultimo ? 'Última sincronización: ' + new Date(S.sync.ultimo).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'Todavía no se ha sincronizado.'}${S.sync.error ? ' · ' + esc(S.sync.error) : ''}</p>
    </section>
    <section class="seccion"><h3>Entorno</h3>
      <div class="seg" role="group">${[['produccion', 'Producción'], ['pruebas', 'Pruebas (copias)']].map(([k, t]) =>
        `<button type="button" data-a="entorno" data-v="${k}" aria-pressed="${entorno() === k}">${t}</button>`).join('')}</div>
      <p class="sub">Pruebas escribe en una copia de LUIS_Personal. Tus datos reales no cambian.</p>
    </section>
    <section class="seccion"><h3>Sincronización</h3>
      <p class="sub">Última confirmada: ${S.sync.ultimo ? new Date(S.sync.ultimo).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'nunca'} · ${S.cola.length} por enviar · ${S.fallidas.length} con error</p>
      ${S.cola.length ? `<div class="lista">${S.cola.slice(0, 12).map(op => `<div class="fila"><span class="txt"><b>${esc(descOp(op))}</b><small>Esperando confirmación del Apps Script</small></span></div>`).join('')}</div>` : ''}
      ${S.fallidas.map((f, i) => `<div class="card" style="background:var(--s2);padding:12px"><b style="font-size:14px">${esc(descOp(f.op))}</b>
        <p class="sub neg">${esc(f.error)}</p><div class="dos" style="margin-top:8px">
        <button type="button" class="btn btn-2" data-a="reintentar" data-i="${i}">Reintentar</button>
        <button type="button" class="btn btn-2 btn-peligro" data-a="descartar" data-i="${i}">Descartar</button></div></div>`).join('')}
      ${S.cola.length ? '<button type="button" class="btn btn-2" data-a="sincronizar">Enviar ahora</button>' : ''}
    </section>
    <section class="seccion"><h3>Candado</h3>
      <div class="dos"><button type="button" class="btn btn-2" data-a="cambiar-pin">Cambiar código</button>
      <button type="button" class="btn btn-2" data-a="bloquear">Bloquear ahora</button></div>
    </section>
    <section class="seccion"><h3>Copia en este teléfono</h3>
      <button type="button" class="btn btn-2" data-a="exportar">Descargar copia de mis datos</button>
      <p class="sub">FORJA ${VERSION} · Google Sheets es la fuente de verdad. Esta copia es para emergencias.</p>
    </section>`);
};
function descOp(op) {
  if (op.tipo === 'put' && op.libro === 'finanzas' && op.hoja === 'Movimientos') return 'Movimiento · ' + (op.fila.categoria || op.fila.tipo) + ' · ' + mxn(op.fila.monto);
  if (op.tipo === 'put' || op.tipo === 'del') return (op.tipo === 'put' ? 'Guardar en ' : 'Borrar de ') + op.hoja;
  return op.tipo === 'exportar' ? 'Exportar a Excel' : op.tipo;
}
A.entorno = el => {
  if (S.cola.length) return avisar('Primero envía lo pendiente: cambiar de entorno con registros en cola los mandaría al lugar equivocado', { error: true });
  S.cfg.entorno = el.dataset.v; S.p = vacias(); S.f = vaciasFin(); S.sync = { ultimo: null, error: null };
  guardar(); cerrarHoja(); render({ forzar: true }); sincronizar({ silencioso: false });
};
A.reintentar = el => {
  const f = S.fallidas.splice(Number(el.dataset.i), 1)[0];
  if (f) { f.op.id = uid(); S.cola.push(f.op); guardar(); }
  cerrarHoja(); sincronizar({ silencioso: false });
};
A.descartar = el => { S.fallidas.splice(Number(el.dataset.i), 1); guardar(); A.ajustes(); render(); };
A['cambiar-pin'] = () => { cerrarHoja(); LS.set('pin', null); Candado.abrir('crear'); };
A.bloquear = () => { cerrarHoja(); Candado.abrir('abrir'); };
A.exportar = () => {
  const blob = new Blob([JSON.stringify({ app: 'FORJA Luis', version: VERSION, exportado: new Date().toISOString(), personal: S.p, finanzas: S.f }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'forja-luis-copia-' + hoy() + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

/* ================================================================== */
/* Formularios                                                        */
/* ================================================================== */

function error(id, msg) {
  const el = $('#' + id);
  if (!el) return avisar(msg, { error: true });
  el.setAttribute('aria-invalid', 'true');
  const c = el.closest('.campo');
  if (c && !c.querySelector('.err')) c.insertAdjacentHTML('beforeend', `<span class="err">${esc(msg)}</span>`);
  el.focus();
  return false;
}
function limpiarErrores(form) {
  $$('[aria-invalid]', form).forEach(e => e.removeAttribute('aria-invalid'));
  $$('.err', form).forEach(e => e.remove());
}

const FORM = {};
FORM.habito = form => {
  const nombre = $('#f-h-nombre').value.trim();
  if (!nombre) return error('f-h-nombre', 'Escribe el nombre');
  if (!S.ui.diasHabito.length) return avisar('Elige al menos un día', { error: true });
  const id = form.dataset.id || uid();
  const previo = S.p.Habitos.find(h => h.id === id) || {};
  put('Habitos', Object.assign({ color: '', creado: hoy(), activo: 'true', orden: S.p.Habitos.length }, previo, {
    id, nombre, nota: $('#f-h-nota').value.trim(), dias: S.ui.diasHabito.slice().sort().join(',')
  }));
  cerrarHoja(); render({ forzar: true });
  avisar(form.dataset.id ? 'Hábito guardado' : 'Hábito agregado');
};
FORM.ejercicio = form => {
  const nombre = $('#f-e-nombre').value.trim();
  if (!nombre) return error('f-e-nombre', 'Escribe el nombre');
  const base = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = S.p.Ejercicios.some(e => e.id === base) ? base + '-' + uid().slice(0, 4) : base;
  put('Ejercicios', { id, nombre, dia: form.dataset.dia, esquema: $('#f-e-esquema').value.trim(), descanso_s: n($('#f-e-descanso').value) || '',
    nota: $('#f-e-nota').value.trim(), orden: S.p.Ejercicios.length, activo: 'true' });
  cerrarHoja(); render({ forzar: true });
};
FORM.alimento = () => {
  const nombre = $('#f-a-nombre').value.trim();
  const prot = n($('#f-a-proteina').value);
  if (!nombre) return error('f-a-nombre', 'Escribe el nombre');
  if (prot <= 0) return error('f-a-proteina', 'Escribe los gramos de proteína');
  put('Alimentos', { id: 'food-' + uid().slice(0, 8), nombre, porcion: $('#f-a-porcion').value.trim() || '1 porción', proteina: prot, activo: 'true' });
  cerrarHoja(); render({ forzar: true });
};
FORM.conexion = async () => {
  const url = $('#f-url').value.trim(), clave = $('#f-clave').value.trim();
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) return error('f-url', 'Debe ser la URL /exec del Apps Script');
  if (!clave) return error('f-clave', 'Escribe la clave');
  S.cfg = { url, clave };
  guardar();
  cerrarHoja();
  await sincronizar({ silencioso: false });
};

/* ================================================================== */
/* Eventos                                                            */
/* ================================================================== */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const f = A[el.dataset.a];
  if (f) { e.preventDefault(); f(el, e); }
});

document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  limpiarErrores(form);
  FORM[form.dataset.form](form);
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.g) { (S.ui.g[el.dataset.g] || (S.ui.g[el.dataset.g] = {}))[el.dataset.k] = el.value; return; }
  if (!el.dataset.f) return;
  const form = el.closest('form[data-form]');
  if (!form) return;
  if (el.getAttribute('aria-invalid')) { el.removeAttribute('aria-invalid'); el.closest('.campo')?.querySelector('.err')?.remove(); }
});


document.addEventListener('keydown', e => {
  if (e.key === 'Escape') cerrarHoja();
  if (!$('#candado').hidden) {
    if (/^\d$/.test(e.key)) Candado.tecla(e.key);
    if (e.key === 'Backspace') A['pin-borrar']();
  }
});

window.addEventListener('online', () => programarSync(200));

/* ================================================================== */
/* Arranque                                                           */
/* ================================================================== */

function alAbrir() {
  LS.set('ultimaVez', Date.now());
  render({ forzar: true });
  sincronizar();
}

function iniciar() {
  render({ forzar: true });
  if (!conectado()) setTimeout(A.ajustes, 300);
  else sincronizar();
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* sin modo sin red */ });
}

/** Lo llama finanzas.js cuando ya registró sus vistas. */
function arrancar() {
  if (!VISTAS[S.tab]) S.tab = 'inicio';
  if (!LS.get('pin', null)) Candado.abrir('crear');
  else if (Date.now() - LS.get('ultimaVez', 0) > BLOQUEO_MS) { render({ forzar: true }); Candado.abrir('abrir'); }
  else iniciar();
}
// Lo tachado se queda tachado todo el día. Al cambiar de día (medianoche) la lista amanece limpia.
let diaPintado = hoy();
function revisarCambioDeDia() {
  if (hoy() === diaPintado) return;
  diaPintado = hoy();
  S.ui.diaGym = null;
  render({ forzar: true });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) revisarCambioDeDia(); });
setInterval(() => {
  if (!document.hidden && $('#candado').hidden) LS.set('ultimaVez', Date.now());
  revisarCambioDeDia();
}, 30000);
