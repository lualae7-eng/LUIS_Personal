/* FORJA Luis · Tareas diarias, meditación, guitarra e idioma.
 * Se carga después de app.js y antes de finanzas.js (que arranca la app).
 */
'use strict';

const MEDITAR_META = 10; // minutos al día
const ESTADOS_CANCION = [['aprendiendo', 'Aprendiendo'], ['aprendida', 'Aprendida']];
const ESTADOS_TECNICA = [['aprendiendo', 'Aprendiendo'], ['dominado', 'Dominado']];
const ESTADOS_LECTURA = [['leyendo', 'Leyendo'], ['terminada', 'Terminada']];
const idiomaActual = () => cfg('idioma_actual', 'Inglés');

/* ================================================================== */
/* Tareas diarias: se tachan y lo tachado dura hasta medianoche        */
/* ================================================================== */

function rituales() { return S.p.Rituales.filter(activo).sort((a, b) => n(a.orden) - n(b.orden)); }
function ritualesPendientes(f = hoy()) {
  const set = marcasSet('RitualesHechos', 'ritual_id');
  return rituales().filter(r => !set.has(r.id + ':' + f)).length;
}
/** Días seguidos con todas las tareas tachadas. */
function rachaRituales() {
  const lista = rituales();
  if (!lista.length) return { actual: 0, record: 0 };
  const set = marcasSet('RitualesHechos', 'ritual_id');
  const completo = f => lista.every(r => set.has(r.id + ':' + f));
  const inicio = S.p.RitualesHechos.map(x => x.fecha).sort()[0] || hoy();
  const t = hoy();
  let actual = 0, f = completo(t) ? t : sumar(t, -1);
  for (let i = 0; i < 800 && f >= inicio && completo(f); i++, f = sumar(f, -1)) actual++;
  let record = 0, c = 0;
  for (let d = inicio, i = 0; d <= t && i < 2000; d = sumar(d, 1), i++) {
    if (completo(d)) { c++; record = Math.max(record, c); } else c = 0;
  }
  return { actual, record };
}

function tareasDiarias() {
  const t = hoy();
  const lista = rituales();
  const set = marcasSet('RitualesHechos', 'ritual_id');
  const hechas = lista.filter(r => set.has(r.id + ':' + t)).length;
  const rr = rachaRituales();
  return `<section class="card" aria-labelledby="t-diarias">
    <div class="card-tit"><h2 id="t-diarias">Tareas del día</h2>
      <span class="meta"><span class="${hechas === lista.length && lista.length ? 'pos' : 'neg'}">${hechas}</span> / ${lista.length}</span></div>
    <div class="lista">${lista.length ? lista.map(r => {
      const ok = set.has(r.id + ':' + t);
      return `<button type="button" class="fila ${ok ? 'hecho' : ''}" data-a="ritual" data-id="${esc(r.id)}" aria-pressed="${ok}">
        <span class="check"><svg class="ico"><use href="#i-check"/></svg></span>
        <span class="txt"><b>${esc(r.etiqueta)}</b></span></button>`;
    }).join('') : '<p class="vacio">Sin tareas. Agrégalas con Editar.</p>'}</div>
    <div class="racha" style="margin-top:10px;justify-content:space-between">
      <span class="fuego">Días completos <b>${rr.actual}</b></span><span>Récord <b>${rr.record}</b></span>
      <button type="button" class="btn-3" data-a="editar-rituales" style="min-height:28px">Editar</button></div>
  </section>`;
}

A.ritual = el => {
  const id = el.dataset.id, f = hoy(), ref = id + ':' + f;
  if (S.p.RitualesHechos.some(x => x.id === ref)) del('RitualesHechos', ref);
  else {
    put('RitualesHechos', { id: ref, fecha: f, ritual_id: id, origen: 'app' });
    if (!ritualesPendientes()) avisar('Tareas del día completas.');
  }
  render({ forzar: true });
};
A['editar-rituales'] = () => {
  abrirHoja('Tareas del día', `<p class="sub">Las tareas que tachas cada día. Archivar la quita de hoy en adelante; su historial se queda.</p>
    <div class="lista" style="margin-top:10px">${rituales().map(r => `<div class="fila"><span class="txt"><b>${esc(r.etiqueta)}</b></span>
      <button type="button" class="btn-3" data-a="archivar-ritual" data-id="${esc(r.id)}">Archivar</button></div>`).join('')}</div>
    <form class="form seccion" data-form="ritual"><label class="campo"><span>Nueva tarea</span><input id="f-ritual" placeholder="Una sola cosa, concreta" autocomplete="off"></label>
    <button type="submit" class="btn">Agregar tarea</button></form>`, () => render({ forzar: true }));
};
A['archivar-ritual'] = el => {
  const r = S.p.Rituales.find(x => x.id === el.dataset.id);
  if (!r) return;
  put('Rituales', Object.assign({}, r, { activo: 'false' }));
  el.closest('.fila').remove();
  avisar('Tarea archivada', { accion: 'Deshacer', alAccion: () => { put('Rituales', Object.assign({}, r, { activo: 'true' })); render({ forzar: true }); } });
};
FORM.ritual = () => {
  const t = $('#f-ritual').value.trim();
  if (!t) return error('f-ritual', 'Escribe la tarea');
  put('Rituales', { id: 'r-' + uid().slice(0, 8), etiqueta: t, orden: S.p.Rituales.length, activo: 'true' });
  A['editar-rituales']();
};

/* ================================================================== */
/* Práctica: minutos de meditación, guitarra e idioma                  */
/* ================================================================== */

function minutos(actividad, desde, hasta = desde) {
  return S.p.Practicas.filter(p => p.actividad === actividad && p.fecha >= desde && p.fecha <= hasta)
    .reduce((a, p) => a + n(p.minutos), 0);
}
/** Días seguidos que cumplen: meditación con la meta, lo demás con cualquier minuto. */
function rachaPractica(actividad, meta = 1) {
  const cumple = f => minutos(actividad, f) >= meta;
  const fechas = S.p.Practicas.filter(p => p.actividad === actividad).map(p => p.fecha).sort();
  if (!fechas.length) return { actual: 0, record: 0 };
  const t = hoy();
  let actual = 0, f = cumple(t) ? t : sumar(t, -1);
  for (let i = 0; i < 800 && f >= fechas[0] && cumple(f); i++, f = sumar(f, -1)) actual++;
  let record = 0, c = 0;
  for (let d = fechas[0], i = 0; d <= t && i < 2000; d = sumar(d, 1), i++) {
    if (cumple(d)) { c++; record = Math.max(record, c); } else c = 0;
  }
  return { actual, record };
}
const lunes = () => { const t = hoy(); return sumar(t, -((dow(t) + 6) % 7)); };

function semanaPuntos(actividad, meta) {
  const t = hoy();
  return `<div class="semana">${Array.from({ length: 7 }, (_, i) => sumar(t, i - 6)).map(f => {
    const m = minutos(actividad, f);
    return `<span class="dia-p ${m >= meta ? 'si' : ''} ${f === t ? 'hoy' : ''}" aria-label="${DIA_LARGO[dow(f)]}: ${m} min">${DIA_CORTO[dow(f)]}<i></i></span>`;
  }).join('')}</div>`;
}

function anotar(actividad, mins, nota = '') {
  put('Practicas', { id: uid(), fecha: hoy(), actividad, minutos: mins, idioma: actividad === 'idioma' ? idiomaActual() : '', nota, origen: 'app' });
}

/** Tarjeta de Hoy: lo que llevas de práctica. */
function practicaHoy() {
  const t = hoy();
  const med = minutos('meditacion', t), gui = minutos('guitarra', t), idi = minutos('idioma', t);
  const fila = (k, titulo, valor, sub, ok) => `<button type="button" class="fila ${ok ? 'hecho' : ''}" data-a="ir-crecer" data-v="${k}">
    <span class="check"><svg class="ico"><use href="#i-check"/></svg></span>
    <span class="txt"><b>${titulo}</b><small>${sub}</small></span><span class="der"><span class="num" style="font-size:16px">${valor}</span></span></button>`;
  return `<section class="card" aria-labelledby="t-prac">
    <div class="card-tit"><h2 id="t-prac">Práctica de hoy</h2></div>
    <div class="lista">
      ${fila('meditar', 'Meditación', med + ' min', med >= MEDITAR_META ? 'Cumplida' : 'Meta ' + MEDITAR_META + ' min', med >= MEDITAR_META)}
      ${fila('guitarra', 'Guitarra', gui + ' min', 'Esta semana ' + minutos('guitarra', lunes(), t) + ' min', gui > 0)}
      ${fila('idioma', esc(idiomaActual()), idi + ' min', 'Esta semana ' + minutos('idioma', lunes(), t) + ' min', idi > 0)}
    </div>
    ${med < MEDITAR_META ? `<button type="button" class="btn" data-a="meditar" style="margin-top:12px">Meditar ${MEDITAR_META} min · ya lo hice</button>` : ''}
  </section>`;
}

A['ir-crecer'] = el => { S.ui.disc = el.dataset.v; irA('disciplina'); render({ forzar: true }); };
A.meditar = () => {
  anotar('meditacion', MEDITAR_META);
  render({ forzar: true });
  avisar('Meditación anotada: ' + MEDITAR_META + ' min');
};
A['anotar-min'] = el => {
  abrirHoja({ guitarra: 'Guitarra', idioma: idiomaActual(), meditacion: 'Meditación' }[el.dataset.v] + ' · minutos', `<form class="form" data-form="minutos" data-v="${esc(el.dataset.v)}">
    ${campo('Minutos', 'min', el.dataset.v === 'meditacion' ? MEDITAR_META : '', 'inputmode="numeric" autocomplete="off" placeholder="20"')}
    ${campo('Qué practicaste (opcional)', 'min-nota', '', 'autocomplete="off" placeholder="' + (el.dataset.v === 'idioma' ? 'Leí 3 páginas de…' : el.dataset.v === 'guitarra' ? 'Cambios de Do a Sol' : '') + '"')}
    <button type="submit" class="btn">Anotar</button></form>`);
  setTimeout(() => $('#f-min')?.focus(), 80);
};
FORM.minutos = form => {
  const m = Math.round(n($('#f-min').value));
  if (m <= 0 || m > 600) return error('f-min', 'Escribe los minutos');
  anotar(form.dataset.v, m, $('#f-min-nota').value.trim());
  cerrarHoja(); render({ forzar: true });
  avisar(m + ' min anotados');
};
A['borrar-practica'] = el => {
  const p = S.p.Practicas.find(x => x.id === el.dataset.id);
  if (!p) return;
  del('Practicas', p.id); render({ forzar: true });
  avisar('Quitado', { accion: 'Deshacer', alAccion: () => { put('Practicas', p); render({ forzar: true }); } });
};

function practicasRecientes(actividad) {
  const l = S.p.Practicas.filter(p => p.actividad === actividad).sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).slice(0, 7);
  if (!l.length) return '';
  return `<section class="card"><div class="card-tit"><h2>Últimas sesiones</h2></div><div class="lista">${l.map(p => `<div class="fila">
    <span class="txt"><b>${n(p.minutos)} min</b><small>${fechaCorta(p.fecha)}${p.nota ? ' · ' + esc(p.nota) : ''}</small></span>
    <button type="button" class="btn-3" data-a="borrar-practica" data-id="${esc(p.id)}">Quitar</button></div>`).join('')}</div></section>`;
}

/* ================================================================== */
/* Disciplina: Hábitos · Meditar · Guitarra · Idioma                   */
/* ================================================================== */

const vistaHabitos = VISTAS.disciplina;
VISTAS.disciplina = () => {
  const modo = S.ui.disc || 'habitos';
  const seg = `<div class="seg" role="group" aria-label="Disciplina">${[['habitos', 'Hábitos'], ['meditar', 'Meditar'], ['guitarra', 'Guitarra'], ['idioma', 'Idioma']].map(([k, t]) =>
    `<button type="button" data-a="disc-modo" data-v="${k}" aria-pressed="${modo === k}">${t}</button>`).join('')}</div>`;
  if (modo === 'meditar') return seg + vistaMeditar();
  if (modo === 'guitarra') return seg + vistaGuitarra();
  if (modo === 'idioma') return seg + vistaIdioma();
  return seg + vistaHabitos();
};
A['disc-modo'] = el => { S.ui.disc = el.dataset.v; render({ forzar: true }); window.scrollTo(0, 0); };

function cabPractica(actividad, meta) {
  const t = hoy(), r = rachaPractica(actividad, meta);
  return `<section class="card">
    <div class="kpis" style="margin-top:0">
      <div><span class="lbl">Hoy</span><span class="num num-m ${actividad === 'meditacion' && minutos(actividad, t) < meta ? 'warn' : ''}">${minutos(actividad, t)}<span class="u"> min</span></span></div>
      <div><span class="lbl">Esta semana</span><span class="num num-m">${minutos(actividad, lunes(), t)}<span class="u"> min</span></span></div>
    </div>
    <div class="racha" style="margin-top:10px"><span class="fuego">Racha <b>${r.actual}</b></span><span>Récord <b>${r.record}</b></span></div>
    ${semanaPuntos(actividad, meta)}
    <button type="button" class="btn btn-2" data-a="anotar-min" data-v="${actividad}" style="margin-top:12px"><svg class="ico"><use href="#i-mas"/></svg>Anotar minutos</button>
  </section>`;
}

function vistaMeditar() {
  const hechos = minutos('meditacion', hoy()) >= MEDITAR_META;
  return encabezado('Disciplina · ' + (hechos ? 'hecha hoy' : 'meta ' + MEDITAR_META + ' min'), 'Meditación', 'Mínimo una vez al día.') +
    (hechos ? '' : `<button type="button" class="btn" data-a="meditar">Meditar ${MEDITAR_META} min · ya lo hice</button>`) +
    cabPractica('meditacion', MEDITAR_META) + practicasRecientes('meditacion');
}

/* ---------- Guitarra ---------- */
function listaEstado(hoja, items, estados, vacio) {
  return `<div class="lista">${items.length ? items.map(x => `<div class="fila">
    <span class="txt"><b>${esc(x.titulo || x.nombre)}</b><small>${[x.artista, x.tipo === 'acorde' ? 'Acorde' : x.tipo === 'tecnica' ? 'Técnica' : '', x.notas].filter(Boolean).map(esc).join(' · ')}</small></span>
    <span class="der"><button type="button" class="chip" data-a="ciclar-estado" data-hoja="${hoja}" data-id="${esc(x.id)}" aria-pressed="${x.estado === estados[estados.length - 1][0]}">${esc((estados.find(e => e[0] === x.estado) || [0, 'Sin estado'])[1])}</button></span></div>`).join('')
    : `<p class="vacio">${vacio}</p>`}</div>`;
}
A['ciclar-estado'] = el => {
  const hoja = el.dataset.hoja;
  const estados = { Canciones: ESTADOS_CANCION, Tecnicas: ESTADOS_TECNICA, Lecturas: ESTADOS_LECTURA }[hoja];
  const x = S.p[hoja].find(y => y.id === el.dataset.id);
  if (!x || !estados) return;
  const i = estados.findIndex(e => e[0] === x.estado);
  put(hoja, Object.assign({}, x, { estado: estados[(i + 1) % estados.length][0] }));
  render({ forzar: true });
};

function vistaGuitarra() {
  const can = S.p.Canciones.slice().sort((a, b) => (a.estado === 'aprendida') - (b.estado === 'aprendida') || String(a.titulo).localeCompare(b.titulo));
  const aprendidas = can.filter(c => c.estado === 'aprendida').length;
  const acordes = S.p.Tecnicas.filter(x => x.tipo === 'acorde'), tecnicas = S.p.Tecnicas.filter(x => x.tipo === 'tecnica');
  return encabezado('Disciplina · ' + aprendidas + ' ' + (aprendidas === 1 ? 'canción aprendida' : 'canciones aprendidas'), 'Guitarra', 'Poco cada día le gana a mucho un día.') +
    cabPractica('guitarra', 1) +
    `<section class="card"><div class="card-tit"><h2>Canciones</h2><span class="meta">${can.length}</span></div>
      ${listaEstado('Canciones', can, ESTADOS_CANCION, 'Agrega la primera canción.')}
      <button type="button" class="btn-3" data-a="nuevo-item" data-hoja="Canciones" style="margin-top:8px">+ Canción</button></section>
    <section class="card"><div class="card-tit"><h2>Acordes</h2><span class="meta">${acordes.filter(x => x.estado === 'dominado').length} / ${acordes.length} dominados</span></div>
      ${listaEstado('Tecnicas', acordes, ESTADOS_TECNICA, 'Agrega los acordes que estás practicando.')}
      <button type="button" class="btn-3" data-a="nuevo-item" data-hoja="Tecnicas" data-tipo="acorde" style="margin-top:8px">+ Acorde</button></section>
    <section class="card"><div class="card-tit"><h2>Técnica</h2><span class="meta">${tecnicas.filter(x => x.estado === 'dominado').length} / ${tecnicas.length} dominadas</span></div>
      ${listaEstado('Tecnicas', tecnicas, ESTADOS_TECNICA, 'Rasgueos, cejilla, cambios, arpegios…')}
      <button type="button" class="btn-3" data-a="nuevo-item" data-hoja="Tecnicas" data-tipo="tecnica" style="margin-top:8px">+ Técnica</button></section>` +
    practicasRecientes('guitarra');
}

/* ---------- Idioma ---------- */
function vistaIdioma() {
  const idioma = idiomaActual();
  const lect = S.p.Lecturas.filter(l => (l.idioma || 'Inglés') === idioma);
  const otros = Array.from(new Set(S.p.Practicas.filter(p => p.actividad === 'idioma' && p.idioma && p.idioma !== idioma).map(p => p.idioma)));
  return encabezado('Disciplina · Idioma', idioma, 'Leerlo completo. Una página al día, hasta que se lea solo.') +
    cabPractica('idioma', 1) +
    `<section class="card"><div class="card-tit"><h2>Lecturas</h2><span class="meta">${lect.filter(l => l.estado === 'terminada').length} terminadas</span></div>
      ${listaEstado('Lecturas', lect, ESTADOS_LECTURA, 'Agrega lo que estás leyendo: un libro, un artículo, una canción.')}
      <button type="button" class="btn-3" data-a="nuevo-item" data-hoja="Lecturas" style="margin-top:8px">+ Lectura</button></section>
    <section class="card"><div class="card-tit"><h2>Idioma que estudias</h2></div>
      <p class="sub">Cuando domines ${esc(idioma)}, cámbialo aquí. El historial de cada idioma se guarda.${otros.length ? ' Antes: ' + otros.map(esc).join(', ') + '.' : ''}</p>
      <button type="button" class="btn btn-2" data-a="cambiar-idioma" style="margin-top:10px">Cambiar idioma</button></section>` +
    practicasRecientes('idioma');
}
A['cambiar-idioma'] = () => abrirHoja('Idioma', `<form class="form" data-form="idioma">
  ${campo('Idioma', 'idioma', idiomaActual(), 'autocomplete="off" autocapitalize="words" placeholder="Inglés, Francés, Italiano…"')}
  <button type="submit" class="btn">Guardar</button></form>`);
FORM.idioma = () => {
  const v = $('#f-idioma').value.trim();
  if (!v) return error('f-idioma', 'Escribe el idioma');
  put('Config', { id: 'idioma_actual', valor: v.charAt(0).toUpperCase() + v.slice(1) });
  cerrarHoja(); render({ forzar: true });
};

/* ---------- Alta de canción, acorde, técnica o lectura ---------- */
A['nuevo-item'] = el => {
  const hoja = el.dataset.hoja, tipo = el.dataset.tipo || '';
  const titulo = { Canciones: 'Canción', Lecturas: 'Lectura', Tecnicas: tipo === 'acorde' ? 'Acorde' : 'Técnica' }[hoja];
  abrirHoja('Nueva ' + titulo.toLowerCase(), `<form class="form" data-form="item" data-hoja="${hoja}" data-tipo="${tipo}">
    ${campo(hoja === 'Tecnicas' ? 'Nombre' : 'Título', 'it-nombre', '', 'autocomplete="off" placeholder="' + ({ Canciones: 'Wonderwall', Lecturas: 'The Little Prince', Tecnicas: tipo === 'acorde' ? 'Fa con cejilla' : 'Rasgueo abajo-arriba' })[hoja] + '"')}
    ${hoja === 'Canciones' ? campo('Artista (opcional)', 'it-artista', '', 'autocomplete="off"') : ''}
    ${campo('Notas (opcional)', 'it-notas', '', 'autocomplete="off"')}
    <button type="submit" class="btn">Agregar</button></form>`);
};
FORM.item = form => {
  const nombre = $('#f-it-nombre').value.trim();
  if (!nombre) return error('f-it-nombre', 'Escribe el nombre');
  const hoja = form.dataset.hoja, base = { id: uid(), notas: $('#f-it-notas').value.trim(), creada: hoy() };
  if (hoja === 'Canciones') put(hoja, Object.assign(base, { titulo: nombre, artista: $('#f-it-artista').value.trim(), estado: 'aprendiendo' }));
  else if (hoja === 'Lecturas') put(hoja, Object.assign(base, { titulo: nombre, idioma: idiomaActual(), estado: 'leyendo' }));
  else put(hoja, Object.assign(base, { nombre, tipo: form.dataset.tipo || 'tecnica', estado: 'aprendiendo' }));
  cerrarHoja(); render({ forzar: true });
};
