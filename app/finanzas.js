/* FORJA Luis · Inicio, Finanzas y Proyectos, más el registro rápido (+).
 * Se carga después de app.js y usa sus utilidades.
 */
'use strict';

const CAT_INGRESO = ['Sueldo del negocio familiar', 'Servicios de administración', 'Servicios tecnológicos e IA',
  'Ventas de proyectos independientes', 'Remuneración del negocio', 'Reembolsos', 'Otros ingresos'];
const CAT_GASTO = ['Vivienda', 'Alimentación', 'Transporte', 'Servicios', 'Salud', 'Educación', 'Compras personales',
  'Intereses y comisiones', 'Gastos de proyectos', 'Otros'];
const TIPOS_PROY = [['aportacion', 'Aportación'], ['gasto', 'Gasto'], ['venta', 'Venta'], ['prestamo_ambito', 'Préstamo'],
  ['devolucion_capital', 'Devolución de capital'], ['retiro_utilidad', 'Retiro de utilidad']];
const ESTADOS = [['confirmado', 'Confirmado'], ['esperado', 'Esperado'], ['programado', 'Programado']];

const F = () => S.f;
const cuentasPersonales = () => F().Cuentas.filter(c => c.ambito === 'personal' && String(c.activa) !== 'false');
const liquidas = () => cuentasPersonales().filter(c => c.tipo !== 'tarjeta');
const tarjetasP = () => cuentasPersonales().filter(c => c.tipo === 'tarjeta');
const proyectos = () => F().Proyectos;
const nombreCuenta = id => (F().Cuentas.find(c => c.id === id) || {}).nombre || id || '—';
const semana = () => { const t = hoy(); const l = sumar(t, -((dow(t) + 6) % 7)); return [l, sumar(l, 6)]; };
const mes = () => { const t = hoy(); return [t.slice(0, 8) + '01', t.slice(0, 8) + '31']; };
const TIPO_TXT = { aportacion: 'Aportación', prestamo_ambito: 'Préstamo', devolucion_capital: 'Devolución de capital', retiro_utilidad: 'Retiro de utilidad', venta: 'Venta', gasto: 'Gasto', ingreso: 'Ingreso', traspaso: 'Traspaso', pago_tarjeta: 'Pago de tarjeta', interes: 'Interés', comision: 'Comisión' };
const tipoTxt = t => TIPO_TXT[t] || t;
const pill = e => `<span class="estado-pill ${esc(e)}">${esc(e)}</span>`;

function sinFinanzas() {
  return `<div class="card"><div class="card-tit"><h2>Faltan las hojas de finanzas</h2></div>
    <p class="sub">En Apps Script corre <b>instalar</b> (y <b>instalarPruebas</b> para el entorno de pruebas). Después toca el indicador de arriba.</p></div>`;
}

/* ================================================================== */
/* Inicio                                                             */
/* ================================================================== */

VISTAS.inicio = () => {
  return S.ambito === 'proyectos' ? inicioProyectos() : inicioPersonal();
};

function inicioPersonal() {
  const t = hoy();
  if (!conectado() && !F().Cuentas.length) return encabezado('Personal', 'Tu dinero', '') + sinConexion();
  if (!F().Cuentas.length) return encabezado('Personal', 'Tu dinero', '') + (S.sinFinanzas ? sinFinanzas() : '<div class="card"><p class="vacio">Cargando…</p></div>');
  const L = FC.liquidez(F().Cuentas, F().Movimientos, t);
  const D = FC.deudas(F().Cuentas, F().Tarjetas, F().EstadosTarjeta, F().Movimientos, t);
  const [lu, dom] = semana();
  const P = FC.presupuestoSemana(F().Presupuestos, F().Movimientos, lu, dom);
  const [m1, m2] = mes();
  const fl = FC.flujo(F().Movimientos, m1, m2);
  const prox = L.esperados[0];

  let h = encabezado('Personal · ' + DIA_LARGO[dow(t)] + ' ' + fechaCorta(t), 'Tu dinero', 'Lo cobrado cuenta. Lo esperado se espera.');

  // Alertas: solo con datos registrados.
  const alertas = [];
  D.fichas.forEach(f => {
    if (f.faltaMinimo && f.diasParaLimite != null && f.diasParaLimite >= 0) {
      const alcanza = L.confirmado + L.esperados.filter(m => m.fecha_efectiva <= f.fechaLimite).reduce((a, m) => a + n(m.monto), 0);
      alertas.push(`<div class="alerta"><span><b>${esc(f.nombre)}: mínimo ${mxn(f.minimo)} vence ${f.diasParaLimite === 0 ? 'hoy' : 'en ' + f.diasParaLimite + ' días'}</b> (${fechaCorta(f.fechaLimite)}).
        ${alcanza < f.faltaMinimo ? `Con lo confirmado y lo esperado llegas a ${mxn(alcanza)}: faltan ${mxn(f.faltaMinimo - alcanza)}.` : 'Alcanza si llega lo esperado.'}</span></div>`);
    }
    if (f.sobreLimite > 0) alertas.push(`<div class="alerta warn"><span><b>${esc(f.nombre)} está ${mxn(f.sobreLimite)} arriba de su límite</b> de ${mxn(f.limite)}.</span></div>`);
  });
  L.cobrosPorConfirmar.forEach(m => alertas.push(`<div class="alerta warn"><span><b>¿Ya llegó ${mxn(m.monto)}?</b> ${esc(m.categoria)} (${fechaCorta(m.fecha_efectiva)}).
    <button type="button" class="btn-3" data-a="confirmar-mov" data-id="${esc(m.id)}" style="min-height:28px">Confirmar</button></span></div>`));
  if (alertas.length) h += `<section class="card" aria-label="Alertas" style="display:grid;gap:8px">${alertas.join('')}</section>`;

  h += `<section class="card" aria-labelledby="t-liq">
    <div class="card-tit"><h2 id="t-liq">Liquidez confirmada</h2><span class="meta">${L.ultimaConciliacion ? 'conciliado ' + fechaCorta(L.ultimaConciliacion) : 'sin conciliar'}</span></div>
    <div class="num num-xl ${L.confirmado < 0 ? 'neg' : ''}">${mxnGrande(L.confirmado)}</div>
    <div class="kpis">
      <div><span class="lbl">Efectivo</span><span class="num num-m">${mxn(L.efectivo)}</span></div>
      <div><span class="lbl">Bancos</span><span class="num num-m">${mxn(L.bancos)}</span></div>
      <div><span class="lbl">Comprometido</span><span class="num num-m">${mxn(L.comprometido)}</span></div>
      <div><span class="lbl">Libre</span><span class="num num-m ${L.libre < 0 ? 'neg' : ''}">${mxn(L.libre)}</span></div>
    </div>
    <p class="sub" style="margin-top:10px">Esperado, no sumado: <b class="warn">${mxn(L.esperado)}</b>${prox ? ` · próximo: ${mxn(prox.monto)} el ${fechaCorta(prox.fecha_efectiva)}` : ''}</p>
    ${graficaFlujo()}
  </section>`;

  h += `<section class="card" aria-labelledby="t-deu">
    <div class="card-tit"><h2 id="t-deu">Deuda personal</h2><span class="meta">Nu y Plata</span></div>
    <div class="num num-l neg">${mxn(D.total)}</div>
    <div class="lista" style="margin-top:6px">${D.fichas.map(f => `<button type="button" class="fila" data-a="ver-tarjeta" data-id="${esc(f.id)}">
      <span class="txt"><b>${esc(f.nombre)}</b><small>${f.minimo != null ? 'mínimo ' + mxn(f.minimo) : 'mínimo pendiente'}${f.fechaLimite ? ' · vence ' + fechaCorta(f.fechaLimite) : ' · fecha límite pendiente'}</small></span>
      <span class="der"><span class="num" style="font-size:17px">${mxn(f.saldo)}</span><small class="${f.estado === 'sin_abonos' ? 'neg' : ''}">${esc(f.estado.replace('_', ' '))}</small></span></button>`).join('')}</div>
  </section>`;

  h += `<section class="card" aria-labelledby="t-pre">
    <div class="card-tit"><h2 id="t-pre">Esta semana</h2><span class="meta">${P.estimado ? 'presupuesto estimado' : ''}</span></div>
    <div class="kpis" style="margin-top:0">
      <div><span class="lbl">Límite semanal</span><span class="num num-m">${mxn(P.limite)}</span></div>
      <div><span class="lbl">Gastado</span><span class="num num-m">${mxn(P.ejecutado)}</span></div>
      <div><span class="lbl">Disponible</span><span class="num num-m ${P.disponible < 0 ? 'neg' : ''}">${mxn(P.disponible)}</span></div>
      <div><span class="lbl">Esenciales</span><span class="num num-m">${mxn(P.obligatorio)}</span></div>
    </div>
    <p class="sub" style="margin-top:10px">Octubre: ingresos ${mxn(fl.ingresos)} · gastos ${mxn(fl.gastos)} (confirmados)</p>
  </section>`;

  h += tareasHoy();
  return h;
}

/** Saldo proyectado 14 días: confirmado + esperados y programados en su fecha. */
function graficaFlujo() {
  const pts = FC.proyeccion(F().Cuentas, F().Movimientos, hoy(), 14);
  const vals = pts.map(p => p.saldo);
  const max = Math.max(0, ...vals), min = Math.min(0, ...vals);
  const W = 320, H = 110, pad = 16;
  const x = i => pad + i * (W - 2 * pad) / (pts.length - 1);
  const y = v => max === min ? H / 2 : 10 + (max - v) * (H - 30) / (max - min);
  const linea = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.saldo).toFixed(1)}`).join('');
  const ult = pts[pts.length - 1];
  return `<svg class="grafica" viewBox="0 0 ${W} ${H}" role="img" aria-label="Efectivo proyectado a 14 días: termina en ${mxn(ult.saldo)}">
    <line x1="${pad}" x2="${W - pad}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)" stroke-dasharray="3 3"/>
    <path d="${linea}" fill="none" stroke="var(--t2)" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${x(pts.length - 1)}" cy="${y(ult.saldo)}" r="3.5" fill="${ult.saldo < 0 ? 'var(--accent)' : 'var(--pos)'}"/>
    <text x="${pad}" y="${H - 4}">hoy</text><text x="${W - pad}" y="${H - 4}" text-anchor="end">${fechaCorta(ult.fecha)} · ${mxn(ult.saldo)}</text>
  </svg><p class="sub">Proyección: lo confirmado más lo esperado en su fecha. No es dinero en mano.</p>`;
}

function tareasHoy() {
  const t = hoy();
  const lista = F().Tareas.filter(x => x.fecha === t && !x.subtarea_de).sort((a, b) => n(a.prioridad) - n(b.prioridad));
  return `<section class="card" aria-labelledby="t-tar">
    <div class="card-tit"><h2 id="t-tar">Prioridades de hoy</h2><span class="meta">${lista.filter(x => String(x.hecha) === 'true').length} / ${lista.length}</span></div>
    <div class="lista">${lista.length ? lista.slice(0, 3).map(x => `<button type="button" class="fila tarea ${String(x.hecha) === 'true' ? 'hecho' : ''}" data-a="tarea" data-id="${esc(x.id)}">
      <span class="check"><svg class="ico"><use href="#i-check"/></svg></span><span class="txt"><b>${esc(x.titulo)}</b></span></button>`).join('')
      : '<p class="vacio">Sin prioridades. Agrega hasta tres con el botón +.</p>'}</div>
    ${lista.length > 3 ? `<p class="sub">+${lista.length - 3} más en la agenda</p>` : ''}
  </section>`;
}

A.tarea = el => {
  const x = F().Tareas.find(t => t.id === el.dataset.id);
  if (!x) return;
  putF('Tareas', Object.assign({}, x, { hecha: String(String(x.hecha) !== 'true') }));
  render({ forzar: true });
};
A['confirmar-mov'] = el => {
  const m = F().Movimientos.find(x => x.id === el.dataset.id);
  if (!m) return;
  putF('Movimientos', Object.assign({}, m, { estado: 'confirmado', fecha_efectiva: m.fecha_efectiva > hoy() ? hoy() : m.fecha_efectiva }));
  render({ forzar: true });
  avisar('Confirmado: ya cuenta en tu liquidez');
};

function inicioProyectos() {
  let h = encabezado('Proyectos', 'Tus negocios', 'Cada proyecto con su propia caja.');
  if (!proyectos().length) return h + (S.sinFinanzas ? sinFinanzas() : '<div class="card"><p class="vacio">Sin proyectos.</p></div>');
  return h + proyectos().map(p => {
    const r = FC.proyecto(p, F().Movimientos, F().ProyectoProductos);
    return `<button type="button" class="card fila" style="display:grid;gap:8px;text-align:left" data-a="ver-proyecto" data-id="${esc(p.id)}">
      <span class="chip-amb">${esc(p.estado)}${p.permiso_estado === 'sin_documentos' ? ' · sin permiso' : ''}</span>
      <b style="font-size:17px">${esc(p.nombre)}</b>
      <span class="kpis" style="margin-top:0">
        <span><span class="lbl">Invertido</span><span class="num num-m">${mxn(r.inversion)}</span></span>
        <span><span class="lbl">Cobrado</span><span class="num num-m">${mxn(r.cobrado)}</span></span>
      </span></button>`;
  }).join('');
}

/* ================================================================== */
/* Finanzas                                                           */
/* ================================================================== */

VISTAS.finanzas = () => {
  if (!F().Cuentas.length) return encabezado('Finanzas', 'Personal', '') + (S.sinFinanzas ? sinFinanzas() : sinConexion());
  const subs = S.ambito === 'proyectos' ? [['movimientos', 'Movimientos']] : [['movimientos', 'Movimientos'], ['tarjetas', 'Tarjetas'], ['presupuesto', 'Presupuesto'], ['cuentas', 'Cuentas']];
  if (!subs.some(x => x[0] === S.ui.fin)) S.ui.fin = 'movimientos';
  let h = encabezado(S.ambito === 'proyectos' ? 'Finanzas · Proyectos' : 'Finanzas · Personal', ({ movimientos: 'Movimientos', tarjetas: 'Tarjetas', presupuesto: 'Presupuesto', cuentas: 'Cuentas' })[S.ui.fin], '');
  if (subs.length > 1) h += `<div class="seg" role="group">${subs.map(([k, t]) => `<button type="button" data-a="fin-sub" data-v="${k}" aria-pressed="${S.ui.fin === k}">${t}</button>`).join('')}</div>`;
  h += ({ movimientos: vistaMovimientos, tarjetas: vistaTarjetas, presupuesto: vistaPresupuesto, cuentas: vistaCuentas })[S.ui.fin]();
  if (S.ambito === 'personal') h += `<section class="card"><div class="card-tit"><h2>Excel personal</h2></div>
    <p class="sub">FORJA_Control_Financiero_Personal.xlsx en tu Drive. Espejo de análisis de tus finanzas personales.</p>
    <div style="margin-top:10px"><button type="button" class="btn btn-2" data-a="exportar-excel">Exportar a Excel</button></div><div id="excel-info"></div></section>`;
  return h;
};
A['fin-sub'] = el => { S.ui.fin = el.dataset.v; render({ forzar: true }); };

function vistaMovimientos() {
  const [d1, d2] = S.ui.filtro === 'semana' ? semana() : mes();
  const esProy = S.ambito === 'proyectos';
  let movs = F().Movimientos.filter(m => esProy ? String(m.ambito).startsWith('proyecto:') : m.ambito === 'personal');
  movs = movs.filter(m => m.fecha_efectiva >= d1 && m.fecha_efectiva <= d2 || m.estado === 'esperado' || m.estado === 'programado');
  if (S.ui.fCat) movs = movs.filter(m => m.categoria === S.ui.fCat);
  if (S.ui.fCuenta) movs = movs.filter(m => m.cuenta_origen === S.ui.fCuenta || m.cuenta_destino === S.ui.fCuenta);
  if (esProy && S.ui.fProy) movs = movs.filter(m => m.proyecto_id === S.ui.fProy);
  movs.sort((a, b) => a.fecha_efectiva < b.fecha_efectiva ? 1 : -1);
  const cats = Array.from(new Set(F().Movimientos.map(m => m.categoria).filter(Boolean))).sort();
  const signo = m => ['ingreso', 'venta', 'retiro_utilidad'].indexOf(m.tipo) >= 0 ? '' : ['traspaso', 'pago_tarjeta', 'aportacion', 'prestamo_ambito', 'devolucion_capital'].indexOf(m.tipo) >= 0 ? '↔ ' : '−';
  return `<div class="seg" role="group">${[['semana', 'Semana'], ['mes', 'Mes']].map(([k, t]) => `<button type="button" data-a="filtro" data-v="${k}" aria-pressed="${S.ui.filtro === k}">${t}</button>`).join('')}</div>
    <div class="dos">
      <select class="sel" data-filtro="fCat" aria-label="Categoría"><option value="">Todas las categorías</option>${cats.map(c => `<option ${S.ui.fCat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      ${esProy ? `<select class="sel" data-filtro="fProy" aria-label="Proyecto"><option value="">Todos los proyectos</option>${proyectos().map(p => `<option value="${esc(p.id)}" ${S.ui.fProy === p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select>`
        : `<select class="sel" data-filtro="fCuenta" aria-label="Cuenta"><option value="">Todas las cuentas</option>${cuentasPersonales().map(c => `<option value="${esc(c.id)}" ${S.ui.fCuenta === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>`}
    </div>
    <section class="card"><div class="lista">${movs.length ? movs.map(m => `<button type="button" class="fila" data-a="ver-mov" data-id="${esc(m.id)}">
      <span class="txt"><b>${esc(m.categoria || tipoTxt(m.tipo))}</b><small>${fechaCorta(m.fecha_efectiva)} · ${esc(m.descripcion || nombreCuenta(m.cuenta_origen || m.cuenta_destino))}</small></span>
      <span class="der"><span class="num" style="font-size:16px">${signo(m)}${mxn(m.monto)}</span>${pill(m.estado)}</span></button>`).join('')
      : '<p class="vacio">Sin movimientos en este periodo.</p>'}</div></section>`;
}
A.filtro = el => { S.ui.filtro = el.dataset.v; render({ forzar: true }); };
document.addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.filtro;
  if (!k) return;
  S.ui[k] = e.target.value; render({ forzar: true });
});

A['ver-mov'] = el => {
  const m = F().Movimientos.find(x => x.id === el.dataset.id);
  if (!m) return;
  abrirHoja(m.categoria || m.tipo, `<div class="lista">
    ${[['Monto', mxn(m.monto)], ['Fecha efectiva', fechaCorta(m.fecha_efectiva)], ['Registrado', m.fecha_registro ? fechaCorta(m.fecha_registro) : '—'], ['Tipo', m.tipo],
      ['Estado', m.estado], ['Origen', nombreCuenta(m.cuenta_origen)], ['Destino', nombreCuenta(m.cuenta_destino)], ['Ámbito', m.ambito], ['Descripción', m.descripcion || '—']]
      .map(([k, v]) => `<div class="fila"><span class="txt"><small>${k}</small><b>${esc(v)}</b></span></div>`).join('')}</div>
    <div class="dos" style="margin-top:14px">
      ${m.estado !== 'confirmado' && m.estado !== 'conciliado' && m.estado !== 'cancelado' ? `<button type="button" class="btn" data-a="estado-mov" data-id="${esc(m.id)}" data-v="confirmado">Confirmar</button>` : ''}
      ${m.estado === 'confirmado' ? `<button type="button" class="btn btn-2" data-a="estado-mov" data-id="${esc(m.id)}" data-v="conciliado">Conciliado con comprobante</button>` : ''}
      ${m.estado !== 'cancelado' ? `<button type="button" class="btn btn-2 btn-peligro" data-a="estado-mov" data-id="${esc(m.id)}" data-v="cancelado">Cancelar</button>` : ''}
    </div><p class="sub" style="margin-top:8px">Cancelar no borra: el movimiento queda en el historial y deja de contar.</p>`);
};
A['estado-mov'] = el => {
  const m = F().Movimientos.find(x => x.id === el.dataset.id);
  if (!m) return;
  putF('Movimientos', Object.assign({}, m, { estado: el.dataset.v }));
  cerrarHoja(); render({ forzar: true }); avisar('Movimiento ' + el.dataset.v);
};

function vistaTarjetas() {
  const D = FC.deudas(F().Cuentas, F().Tarjetas, F().EstadosTarjeta, F().Movimientos, hoy());
  return D.fichas.map(f => `<button type="button" class="card fila" style="display:grid;gap:6px;text-align:left" data-a="ver-tarjeta" data-id="${esc(f.id)}">
    <span class="card-tit" style="margin:0"><b style="font-size:17px">${esc(f.nombre)}</b><span class="meta">${f.limite ? 'límite ' + mxn(f.limite) : ''}</span></span>
    <span class="num num-l neg">${mxn(f.saldo)}</span>
    <span class="sub">${f.minimo != null ? 'Mínimo ' + mxn(f.minimo) + (f.faltaMinimo ? ' · faltan ' + mxn(f.faltaMinimo) : ' · cubierto') : 'Mínimo pendiente'}${f.fechaLimite ? ' · vence ' + fechaCorta(f.fechaLimite) : ''}${f.sobreLimite ? ' · ' + mxn(f.sobreLimite) + ' sobre el límite' : ''}</span>
  </button>`).join('') || '<div class="card"><p class="vacio">Sin tarjetas personales.</p></div>';
}

A['ver-tarjeta'] = el => {
  const id = el.dataset.id;
  const f = FC.deudas(F().Cuentas, F().Tarjetas, F().EstadosTarjeta, F().Movimientos, hoy()).fichas.find(x => x.id === id);
  if (!f) return;
  const e = FC.ultimoEstado(id, F().EstadosTarjeta) || {};
  const movs = F().Movimientos.filter(m => m.cuenta_origen === id || m.cuenta_destino === id).sort((a, b) => a.fecha_efectiva < b.fecha_efectiva ? 1 : -1);
  const dif = e.saldo !== undefined && e.saldo !== '' ? Math.round((f.saldo - n(e.saldo)) * 100) / 100 : null;
  abrirHoja(f.nombre, `
    <div class="kpis" style="margin-top:0">
      <div><span class="lbl">Saldo en FORJA</span><span class="num num-m neg">${mxn(f.saldo)}</span></div>
      <div><span class="lbl">Límite</span><span class="num num-m">${f.limite ? mxn(f.limite) : 'pendiente'}</span></div>
      <div><span class="lbl">Mínimo</span><span class="num num-m">${f.minimo != null ? mxn(f.minimo) : 'pendiente'}</span></div>
      <div><span class="lbl">Fecha límite</span><span class="num num-m">${f.fechaLimite ? fechaCorta(f.fechaLimite) : 'pendiente'}</span></div>
      <div><span class="lbl">Sin intereses</span><span class="num num-m">${f.pagoSinIntereses != null ? mxn(f.pagoSinIntereses) : 'pendiente'}</span></div>
      <div><span class="lbl">Tasa anual</span><span class="num num-m">${f.tasa != null ? f.tasa + '%' : 'pendiente'}</span></div>
    </div>
    <p class="sub" style="margin-top:10px">Corte ${f.fechaCorte ? fechaCorta(f.fechaCorte) : 'pendiente'} · abonado desde el corte ${mxn(f.abonado)} · ${esc(e.fuente || '')}</p>
    ${dif !== null ? `<p class="sub ${dif ? 'warn' : 'pos'}">Conciliación: ${dif ? 'FORJA difiere ' + mxn(dif) + ' del estado de cuenta' : 'coincide con el estado de cuenta'}${String(e.conciliado) === 'true' ? ' · conciliado' : ''}</p>` : ''}
    <div class="dos" style="margin-top:12px">
      <button type="button" class="btn" data-a="nuevo" data-tipo="pago_tarjeta" data-destino="${esc(id)}">Registrar pago</button>
      <button type="button" class="btn btn-2" data-a="estado-tarjeta" data-id="${esc(id)}">Estado de cuenta</button>
    </div>
    <section class="seccion"><h3>Simulador</h3>
      <div class="dos">${campoDinero('Pago mensual', 'sim-pago', f.minimo || '')}${campo('Tasa anual % (supuesto)', 'sim-tasa', f.tasa != null ? f.tasa : '', 'inputmode="decimal" placeholder="Escribe una tasa"')}</div>
      <button type="button" class="btn btn-2" data-a="simular" data-id="${esc(id)}">Simular</button><div id="sim-out" class="sub"></div>
      <p class="sub">Supone: sin compras nuevas, tasa fija, interés mensual = tasa/12 sobre el saldo. Sin tasa real el resultado es solo ilustrativo.</p></section>
    <section class="seccion"><h3>Movimientos</h3><div class="lista">${movs.length ? movs.slice(0, 15).map(m => `<div class="fila"><span class="txt"><b>${esc(m.categoria || m.tipo)}</b><small>${fechaCorta(m.fecha_efectiva)} · ${esc(m.estado)}</small></span><span class="der num" style="font-size:15px">${mxn(m.monto)}</span></div>`).join('') : '<p class="vacio">Sin movimientos desde el saldo inicial.</p>'}</div></section>`);
};

A.simular = el => {
  const saldo = FC.deudas(F().Cuentas, F().Tarjetas, F().EstadosTarjeta, F().Movimientos, hoy()).fichas.find(x => x.id === el.dataset.id).saldo;
  const pago = n($('#f-sim-pago').value), tasa = n($('#f-sim-tasa').value) / 100 / 12;
  if (pago <= 0) return error('f-sim-pago', 'Escribe un pago');
  let s = saldo, meses = 0, intereses = 0;
  while (s > 0 && meses < 600) { const i = s * tasa; if (pago <= i) break; intereses += i; s = s + i - pago; meses++; }
  $('#sim-out').innerHTML = s > 0 && meses < 600 && pago <= s * tasa
    ? `<span class="neg">Con ese pago la deuda no baja: los intereses (${mxn(s * tasa)}/mes) son mayores.</span>`
    : `Liquidas en <b>${meses} meses</b> pagando ${mxn(pago)} al mes · intereses estimados ${mxn(intereses)}.`;
};

A['estado-tarjeta'] = el => {
  const id = el.dataset.id;
  const e = FC.ultimoEstado(id, F().EstadosTarjeta) || {};
  abrirHoja('Estado de cuenta', `<form class="form" data-form="estado-tarjeta" data-id="${esc(id)}">
    <div class="dos">${campo('Fecha de corte', 'et-corte', e.fecha_corte || hoy(), 'type="date"')}${campo('Fecha límite', 'et-limite', e.fecha_limite || '', 'type="date"')}</div>
    <div class="dos">${campoDinero('Saldo del estado', 'et-saldo', e.saldo || '')}${campoDinero('Pago mínimo', 'et-minimo', e.minimo || '')}</div>
    <div class="dos">${campoDinero('Pago sin intereses', 'et-sin', e.pago_sin_intereses || '')}${campoDinero('Intereses', 'et-int', e.intereses || '')}</div>
    ${campoDinero('Comisiones', 'et-com', e.comisiones || '')}
    <label class="campo"><span><input type="checkbox" id="f-et-conc" ${String(e.conciliado) === 'true' ? 'checked' : ''}> Revisé contra el estado de cuenta (conciliado)</span></label>
    <button type="submit" class="btn">Guardar</button>
    <p class="sub">Lo vacío queda como pendiente. Intereses y comisiones se registran aparte como movimientos para que suban la deuda.</p></form>`);
};
FORM['estado-tarjeta'] = form => {
  const id = form.dataset.id, corte = $('#f-et-corte').value;
  if (!corte) return error('f-et-corte', 'Escribe la fecha de corte');
  const v = k => $('#f-' + k).value.trim();
  putF('EstadosTarjeta', { id: id + ':' + corte, tarjeta_id: id, fecha_corte: corte, saldo: v('et-saldo'), minimo: v('et-minimo'), pago_sin_intereses: v('et-sin'),
    fecha_limite: v('et-limite'), intereses: v('et-int'), comisiones: v('et-com'), conciliado: String($('#f-et-conc').checked), fuente: 'Capturado en FORJA ' + hoy(), notas: '' });
  cerrarHoja(); render({ forzar: true }); avisar('Estado de cuenta guardado');
};

function vistaPresupuesto() {
  const [lu, dom] = semana();
  const P = FC.presupuestoSemana(F().Presupuestos, F().Movimientos, lu, dom);
  return `<section class="card"><div class="kpis" style="margin-top:0">
      <div><span class="lbl">Semana</span><span class="num num-m">${mxn(P.limite)}</span></div>
      <div><span class="lbl">Disponible</span><span class="num num-m ${P.disponible < 0 ? 'neg' : ''}">${mxn(P.disponible)}</span></div></div></section>
    <section class="card"><div class="lista">${F().Presupuestos.map(p => `<div class="fila"><span class="txt"><b>${esc(p.categoria)}</b>
      <small>${esc(p.periodo)} · ${esc(p.tipo)} · ${String(p.confirmado) === 'true' ? 'confirmado' : 'estimado'}${p.notas ? ' · ' + esc(p.notas) : ''}</small></span>
      <span class="der num" style="font-size:16px">${mxn(p.limite)}</span></div>`).join('') || '<p class="vacio">Sin presupuesto.</p>'}</div>
      <button type="button" class="btn btn-2" data-a="nuevo-presupuesto" style="margin-top:10px">Agregar línea</button></section>`;
}
A['nuevo-presupuesto'] = () => abrirHoja('Presupuesto', `<form class="form" data-form="presupuesto">
  ${campo('Categoría', 'pr-cat', '', 'list="cats-gasto" autocomplete="off"')}<datalist id="cats-gasto">${CAT_GASTO.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
  <div class="dos">${campoDinero('Límite', 'pr-lim', '')}<label class="campo"><span>Periodo</span><select class="sel" id="f-pr-per"><option>semanal</option><option selected>mensual</option></select></label></div>
  <label class="campo"><span>Tipo</span><select class="sel" id="f-pr-tipo"><option>obligatorio</option><option>flexible</option></select></label>
  <label class="campo"><span><input type="checkbox" id="f-pr-conf"> El monto es exacto (no estimado)</span></label>
  <button type="submit" class="btn">Guardar</button></form>`);
FORM.presupuesto = () => {
  const cat = $('#f-pr-cat').value.trim(), lim = n($('#f-pr-lim').value);
  if (!cat) return error('f-pr-cat', 'Escribe la categoría');
  if (lim <= 0) return error('f-pr-lim', 'Escribe el límite');
  putF('Presupuestos', { id: 'p-' + uid().slice(0, 8), periodo: $('#f-pr-per').value, categoria: cat, limite: lim, tipo: $('#f-pr-tipo').value,
    confirmado: String($('#f-pr-conf').checked), escenario: 'base', notas: '' });
  cerrarHoja(); render({ forzar: true });
};

function vistaCuentas() {
  return `<section class="card"><div class="lista">${cuentasPersonales().map(c => `<div class="fila"><span class="txt"><b>${esc(c.nombre)}</b>
    <small>${esc(c.tipo)} · saldo inicial ${mxn(c.saldo_inicial)} al ${fechaCorta(c.fecha_saldo)}</small></span>
    <span class="der num" style="font-size:16px">${mxn(FC.saldoCuenta(c, F().Movimientos))}</span></div>`).join('')}</div>
    <button type="button" class="btn btn-2" data-a="nueva-cuenta" style="margin-top:10px">Agregar cuenta</button></section>
    <p class="note sub">Los saldos cuentan los movimientos confirmados desde la fecha del saldo inicial.</p>`;
}
A['nueva-cuenta'] = () => abrirHoja('Cuenta nueva', `<form class="form" data-form="cuenta">
  ${campo('Nombre', 'cu-nom', '', 'autocomplete="off" placeholder="Débito, ahorro…"')}
  <label class="campo"><span>Tipo</span><select class="sel" id="f-cu-tipo"><option value="banco">Banco o débito</option><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta de crédito</option></select></label>
  <div class="dos">${campoDinero('Saldo de hoy', 'cu-saldo', '')}${campo('Fecha del saldo', 'cu-fecha', hoy(), 'type="date"')}</div>
  <button type="submit" class="btn">Guardar</button></form>`);
FORM.cuenta = () => {
  const nom = $('#f-cu-nom').value.trim();
  if (!nom) return error('f-cu-nom', 'Escribe el nombre');
  putF('Cuentas', { id: nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-') + '-' + uid().slice(0, 4), nombre: nom,
    tipo: $('#f-cu-tipo').value, ambito: 'personal', saldo_inicial: n($('#f-cu-saldo').value), fecha_saldo: $('#f-cu-fecha').value || hoy(), activa: 'true', notas: '' });
  cerrarHoja(); render({ forzar: true });
};

/* ================================================================== */
/* Proyectos                                                          */
/* ================================================================== */

VISTAS.proyectos = () => {
  if (!S.ui.proyecto) return inicioProyectos();
  const p = proyectos().find(x => x.id === S.ui.proyecto);
  if (!p) { S.ui.proyecto = null; return VISTAS.proyectos(); }
  const r = FC.proyecto(p, F().Movimientos, F().ProyectoProductos);
  const movs = F().Movimientos.filter(m => m.proyecto_id === p.id).sort((a, b) => a.fecha_efectiva < b.fecha_efectiva ? 1 : -1);
  return `<button type="button" class="btn-3" data-a="ver-proyecto" data-id="">‹ Proyectos</button>
    ${encabezado('Proyecto · ' + p.estado, p.nombre, p.notas || '')}
    ${p.permiso_estado === 'sin_documentos' ? '<div class="alerta warn"><span><b>Sin permiso documentado.</b> No se marca como autorizado sin documentos.</span></div>' : ''}
    <section class="card"><div class="kpis" style="margin-top:0">
      <div><span class="lbl">Inversión</span><span class="num num-m">${mxn(r.inversion)}</span></div>
      <div><span class="lbl">Caja del proyecto</span><span class="num num-m ${r.capitalTrabajo < 0 ? 'neg' : ''}">${mxn(r.capitalTrabajo)}</span></div>
      <div><span class="lbl">Cobrado</span><span class="num num-m">${mxn(r.cobrado)}</span></div>
      <div><span class="lbl">Por cobrar</span><span class="num num-m warn">${mxn(r.porCobrar)}</span></div>
      <div><span class="lbl">Costos fijos</span><span class="num num-m">${mxn(r.fijos)}</span></div>
      <div><span class="lbl">Costos variables</span><span class="num num-m">${mxn(r.variables)}</span></div>
      <div><span class="lbl">Margen contrib.</span><span class="num num-m">${mxn(r.margenContribucion)}</span></div>
      <div><span class="lbl">Utilidad estimada</span><span class="num num-m ${r.utilidadEstimada < 0 ? 'neg' : ''}">${mxn(r.utilidadEstimada)}</span></div>
    </div><p class="sub" style="margin-top:10px">Flujo después de obligaciones: ${mxn(r.flujoDisponible)} · devuelto ${mxn(r.devuelto)} · retirado ${mxn(r.retirado)}</p></section>
    <section class="card"><div class="card-tit"><h2>Productos</h2></div><div class="lista">${r.productos.map(x => `<div class="fila"><span class="txt"><b>${esc(x.producto)}</b>
      <small>margen ${mxn(x.margenUnitario)} por pieza${x.equilibrio != null ? ' · equilibrio ' + x.equilibrio + ' pzas' : ''}</small></span></div>`).join('') || '<p class="vacio">Sin productos.</p>'}</div>
      <button type="button" class="btn btn-2" data-a="nuevo-producto" data-id="${esc(p.id)}" style="margin-top:10px">Agregar producto</button></section>
    <section class="card"><div class="card-tit"><h2>Movimientos</h2></div><div class="lista">${movs.map(m => `<button type="button" class="fila" data-a="ver-mov" data-id="${esc(m.id)}">
      <span class="txt"><b>${esc(tipoTxt(m.tipo))}${m.categoria ? ' · ' + esc(m.categoria) : ''}</b><small>${fechaCorta(m.fecha_efectiva)}</small></span>
      <span class="der"><span class="num" style="font-size:16px">${mxn(m.monto)}</span>${pill(m.estado)}</span></button>`).join('') || '<p class="vacio">Sin movimientos.</p>'}</div></section>`;
};
A['ver-proyecto'] = el => { S.ui.proyecto = el.dataset.id || null; S.tab = 'proyectos'; render({ forzar: true }); window.scrollTo(0, 0); };
A['nuevo-producto'] = el => abrirHoja('Producto', `<form class="form" data-form="producto" data-id="${esc(el.dataset.id)}">
  ${campo('Producto', 'pp-nom', '', 'autocomplete="off"')}<div class="dos">${campoDinero('Costo unitario', 'pp-costo', '')}${campoDinero('Precio', 'pp-precio', '')}</div>
  ${campo('Inventario', 'pp-inv', '', 'inputmode="numeric"')}<button type="submit" class="btn">Guardar</button></form>`);
FORM.producto = form => {
  const nom = $('#f-pp-nom').value.trim();
  if (!nom) return error('f-pp-nom', 'Escribe el producto');
  putF('ProyectoProductos', { id: 'pp-' + uid().slice(0, 8), proyecto_id: form.dataset.id, producto: nom, costo_unitario: n($('#f-pp-costo').value),
    precio: n($('#f-pp-precio').value), inventario: $('#f-pp-inv').value, notas: '' });
  cerrarHoja(); render({ forzar: true });
};

/* ================================================================== */
/* Registro rápido (+)                                                */
/* ================================================================== */

A.registrar = () => {
  const ops = S.ambito === 'personal'
    ? [['gasto', 'Gasto'], ['ingreso', 'Ingreso'], ['traspaso', 'Traspaso entre cuentas'], ['pago_tarjeta', 'Pago de tarjeta'], ['tarea', 'Prioridad de hoy']]
    : TIPOS_PROY;
  abrirHoja('Registrar · ' + (S.ambito === 'personal' ? 'Personal' : 'Proyectos'), `<div class="lista">${ops.map(([k, t]) =>
    `<button type="button" class="fila" data-a="nuevo" data-tipo="${k}"><span class="txt"><b>${t}</b></span><svg class="ico"><use href="#i-flecha"/></svg></button>`).join('')}</div>`);
};

A.nuevo = el => {
  const tipo = el.dataset.tipo;
  if (tipo === 'tarea') return abrirHoja('Prioridad de hoy', `<form class="form" data-form="tarea">${campo('Qué', 'ta-tit', '', 'autocomplete="off" placeholder="Una sola cosa, concreta"')}
    <label class="campo"><span>Proyecto (opcional)</span><select class="sel" id="f-ta-proy"><option value="">Ninguno</option>${proyectos().map(p => `<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join('')}</select></label>
    <button type="submit" class="btn">Agregar</button><p class="sub">Una tarea nunca crea pagos ni cobros por sí sola.</p></form>`);
  const proy = S.ambito === 'proyectos';
  const m = S.ui.m = { tipo, monto: '', fecha: hoy(), estado: 'confirmado', categoria: '', origen: '', destino: el.dataset.destino || '', descripcion: '',
    proyecto: S.ui.proyecto || (proyectos()[0] || {}).id || '', naturaleza: 'variable' };
  const liq = liquidas(), tj = tarjetasP();
  if (tipo === 'gasto' && !proy) m.origen = (liq[0] || {}).id || '';
  if (tipo === 'ingreso') m.destino = (liq[0] || {}).id || '';
  if (tipo === 'traspaso') { m.origen = (liq[0] || {}).id || ''; m.destino = (liq[1] || {}).id || ''; }
  if (tipo === 'pago_tarjeta') { m.origen = (liq[0] || {}).id || ''; m.destino = m.destino || (tj[0] || {}).id || ''; }
  if (proy && ['aportacion', 'prestamo_ambito'].indexOf(tipo) >= 0) m.origen = (liq[0] || {}).id || '';
  if (proy && ['devolucion_capital', 'retiro_utilidad'].indexOf(tipo) >= 0) m.destino = (liq[0] || {}).id || '';
  const opt = (lista, sel) => lista.map(c => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');
  const titulo = ({ gasto: 'Gasto', ingreso: 'Ingreso', traspaso: 'Traspaso', pago_tarjeta: 'Pago de tarjeta' })[tipo] || (TIPOS_PROY.find(x => x[0] === tipo) || [, tipo])[1];
  const conOrigen = ['gasto', 'traspaso', 'pago_tarjeta'].indexOf(tipo) >= 0 && !proy || (proy && ['aportacion', 'prestamo_ambito'].indexOf(tipo) >= 0);
  const conDestino = ['ingreso', 'traspaso', 'pago_tarjeta'].indexOf(tipo) >= 0 || (proy && ['devolucion_capital', 'retiro_utilidad'].indexOf(tipo) >= 0);
  const cats = tipo === 'gasto' ? CAT_GASTO : tipo === 'ingreso' ? CAT_INGRESO : [];
  abrirHoja(titulo, `<form class="form" data-form="mov" novalidate>
    ${campoDinero('Monto', 'mv-monto', '')}
    ${proy ? `<label class="campo"><span>Proyecto</span><select class="sel" data-m="proyecto">${proyectos().map(p => `<option value="${esc(p.id)}" ${p.id === m.proyecto ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label>` : ''}
    ${cats.length ? `<div class="campo"><span>Categoría</span><div class="chips">${cats.map(c => `<button type="button" class="chip" data-a="chip-m" data-k="categoria" data-v="${esc(c)}" aria-pressed="false">${esc(c)}</button>`).join('')}</div></div>` : ''}
    ${conOrigen ? `<label class="campo"><span>${tipo === 'traspaso' || tipo === 'pago_tarjeta' ? 'Sale de' : 'Pagado con'}</span><select class="sel" data-m="origen">${opt(tipo === 'gasto' ? liq.concat(tj) : liq, m.origen)}</select></label>` : ''}
    ${conDestino ? `<label class="campo"><span>${tipo === 'pago_tarjeta' ? 'Tarjeta' : 'Entra a'}</span><select class="sel" data-m="destino">${opt(tipo === 'pago_tarjeta' ? tj : liq, m.destino)}</select></label>` : ''}
    ${proy && tipo === 'gasto' ? `<div class="campo"><span>Costo</span><div class="seg">${[['variable', 'Variable'], ['fijo', 'Fijo']].map(([k, t]) => `<button type="button" data-a="chip-m" data-k="naturaleza" data-v="${k}" aria-pressed="${m.naturaleza === k}">${t}</button>`).join('')}</div></div>` : ''}
    <div class="campo"><span>Estado</span><div class="seg">${ESTADOS.map(([k, t]) => `<button type="button" data-a="chip-m" data-k="estado" data-v="${k}" aria-pressed="${m.estado === k}">${t}</button>`).join('')}</div></div>
    <div class="dos">${campo('Fecha efectiva', 'mv-fecha', m.fecha, 'type="date"')}${campo('Descripción', 'mv-desc', '', 'autocomplete="off"')}</div>
    <button type="submit" class="btn">Guardar</button>
    <p class="sub">${tipo === 'traspaso' || tipo === 'pago_tarjeta' ? 'Mueve dinero entre tus cuentas: no cuenta como ingreso ni gasto.' : tipo === 'aportacion' ? 'Es capital del proyecto: no es venta ni gasto personal.' : 'Esperado y programado no suman a tu liquidez hasta que los confirmes.'}</p>
  </form>`);
};

A['chip-m'] = el => {
  const m = S.ui.m; if (!m) return;
  m[el.dataset.k] = el.dataset.v;
  $$(`[data-a="chip-m"][data-k="${el.dataset.k}"]`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === m[el.dataset.k])));
};
document.addEventListener('change', e => { const k = e.target.dataset && e.target.dataset.m; if (k && S.ui.m) S.ui.m[k] = e.target.value; });

FORM.mov = () => {
  const m = S.ui.m;
  const monto = n($('#f-mv-monto').value);
  if (monto <= 0) return error('f-mv-monto', 'Escribe el monto');
  if ((m.tipo === 'gasto' || m.tipo === 'ingreso') && S.ambito === 'personal' && !m.categoria) return avisar('Elige una categoría', { error: true });
  if ((m.tipo === 'traspaso' || m.tipo === 'pago_tarjeta') && (!m.origen || !m.destino || m.origen === m.destino)) return avisar('Elige dos cuentas distintas', { error: true });
  const proy = S.ambito === 'proyectos';
  const fila = {
    id: uid(), fecha_efectiva: $('#f-mv-fecha').value || hoy(), fecha_registro: hoy(), tipo: m.tipo, categoria: m.categoria || '', monto, moneda: 'MXN',
    cuenta_origen: m.origen || '', cuenta_destino: m.destino || '', ambito: proy ? 'proyecto:' + m.proyecto : 'personal', proyecto_id: proy ? m.proyecto : '',
    descripcion: $('#f-mv-desc').value.trim(), comprobante: '', estado: m.estado, naturaleza: proy && m.tipo === 'gasto' ? m.naturaleza : '', grupo_id: '', origen: 'app'
  };
  putF('Movimientos', fila);
  S.ui.m = null; cerrarHoja(); render({ forzar: true });
  avisar(fila.estado === 'confirmado' ? 'Guardado' : 'Guardado como ' + fila.estado + ': no suma todavía');
};

FORM.tarea = () => {
  const t = $('#f-ta-tit').value.trim();
  if (!t) return error('f-ta-tit', 'Escribe la tarea');
  const deHoy = F().Tareas.filter(x => x.fecha === hoy());
  putF('Tareas', { id: uid(), fecha: hoy(), titulo: t, prioridad: deHoy.length + 1, proyecto_id: $('#f-ta-proy').value, obligacion_id: '', hecha: 'false', subtarea_de: '', creada: new Date().toISOString() });
  cerrarHoja(); render({ forzar: true });
};

/* ================================================================== */
/* Excel                                                              */
/* ================================================================== */

A['exportar-excel'] = async el => {
  if (!conectado()) return avisar('Primero conecta el Apps Script', { error: true });
  if (S.cola.length) return avisar('Espera a que se envíe lo pendiente para exportar datos completos', { error: true });
  const t = hoy();
  const L = FC.liquidez(F().Cuentas, F().Movimientos, t), D = FC.deudas(F().Cuentas, F().Tarjetas, F().EstadosTarjeta, F().Movimientos, t);
  const filas = [['Liquidez confirmada', L.confirmado, 'confirmado + conciliado'], ['Ingresos esperados', L.esperado, 'no suman a la liquidez'],
    ['Comprometido', L.comprometido, 'programado y esperado de salida'], ['Deuda personal', D.total, 'Nu y Plata']]
    .concat(D.fichas.map(f => ['Tarjeta ' + f.nombre, f.saldo, (f.minimo != null ? 'mínimo ' + f.minimo : 'mínimo pendiente') + (f.fechaLimite ? ' · vence ' + f.fechaLimite : '')]));
  el.disabled = true; el.textContent = 'Exportando…';
  try {
    const r = await enviar({ ops: [{ id: 'exportar-' + uid(), tipo: 'exportar', resumen: { filas, version: VERSION } }] }, 120000);
    const x = (r.resultados || [])[0] || {};
    if (!x.ok) throw new Error(x.error || 'No se pudo exportar');
    $('#excel-info').innerHTML = `<p class="sub pos" style="margin-top:8px">Listo: ${esc(x.nombre)} (${x.filas} movimientos). <a href="${esc(x.url)}" target="_blank" rel="noopener" style="color:var(--t1)">Abrir en Drive</a></p>`;
  } catch (e) { avisar(e.message, { error: true }); }
  finally { el.disabled = false; el.textContent = 'Exportar a Excel'; }
};

arrancar();
