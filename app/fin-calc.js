/* FORJA · cálculos financieros puros (sin pantalla). Los usa la app y las pruebas.
 * Reglas:
 *  - La liquidez solo cuenta movimientos confirmados o conciliados.
 *  - Traspasos y pagos de tarjeta mueven dinero entre tus cuentas: no son ingreso ni gasto.
 *  - Una compra con tarjeta es gasto y sube la deuda; pagar la tarjeta solo baja la deuda.
 *  - Aportar a un proyecto saca dinero de tus cuentas pero no es gasto personal ni venta del proyecto.
 *  - LUAL no vive aquí: BBVA nunca suma a la deuda personal.
 */
(function (raiz) {
  'use strict';

  const REAL = ['confirmado', 'conciliado'];
  const LIQUIDAS = ['efectivo', 'banco'];
  const n = x => { const v = Number(String(x == null ? '' : x).replace(/[$,\s]/g, '')); return isFinite(v) ? v : 0; };
  const real = m => REAL.indexOf(m.estado) >= 0;
  const activa = c => String(c.activa) !== 'false';
  const r2 = x => Math.round(x * 100) / 100;

  /** Movimientos que cuentan para el saldo de una cuenta: desde la fecha del saldo inicial. */
  function cuentan(c, m) { return m.estado !== 'cancelado' && (!c.fecha_saldo || String(m.fecha_efectiva) >= String(c.fecha_saldo)); }

  /**
   * Saldo de una cuenta. Para cuentas líquidas: dinero disponible.
   * Para tarjetas: deuda (positivo = debes).
   */
  function saldoCuenta(c, movs, { incluirEsperados = false } = {}) {
    let s = n(c.saldo_inicial);
    const tarjeta = c.tipo === 'tarjeta';
    movs.forEach(m => {
      if (!cuentan(c, m) || (!incluirEsperados && !real(m))) return;
      const monto = n(m.monto);
      if (m.cuenta_destino === c.id) s += tarjeta ? -monto : monto;
      if (m.cuenta_origen === c.id) s += tarjeta ? monto : -monto;
    });
    return r2(s);
  }

  function liquidez(cuentas, movs, hoy) {
    const liquidas = cuentas.filter(c => activa(c) && c.ambito === 'personal' && LIQUIDAS.indexOf(c.tipo) >= 0);
    const ids = liquidas.map(c => c.id);
    const porTipo = t => r2(liquidas.filter(c => c.tipo === t).reduce((a, c) => a + saldoCuenta(c, movs), 0));
    const confirmado = r2(porTipo('efectivo') + porTipo('banco'));
    const esperados = movs.filter(m => m.estado === 'esperado' && ids.indexOf(m.cuenta_destino) >= 0 && m.tipo !== 'traspaso');
    const comprometido = movs.filter(m => (m.estado === 'programado' || m.estado === 'esperado') && ids.indexOf(m.cuenta_origen) >= 0);
    const totalEsperado = r2(esperados.reduce((a, m) => a + n(m.monto), 0));
    const totalComprometido = r2(comprometido.reduce((a, m) => a + n(m.monto), 0));
    const conciliados = movs.filter(m => m.estado === 'conciliado').map(m => m.fecha_efectiva).sort();
    return {
      efectivo: porTipo('efectivo'), bancos: porTipo('banco'), confirmado,
      comprometido: totalComprometido, libre: r2(confirmado - totalComprometido),
      esperado: totalEsperado, esperados: esperados.sort((a, b) => a.fecha_efectiva < b.fecha_efectiva ? -1 : 1),
      ultimaConciliacion: conciliados.length ? conciliados[conciliados.length - 1] : null,
      cobrosPorConfirmar: esperados.filter(m => hoy && m.fecha_efectiva <= hoy)
    };
  }

  /** Último estado de cuenta registrado de una tarjeta. */
  function ultimoEstado(tarjetaId, estados) {
    return estados.filter(e => e.tarjeta_id === tarjetaId).sort((a, b) => a.fecha_corte < b.fecha_corte ? 1 : -1)[0] || null;
  }

  function diasEntre(a, b) {
    const f = s => { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((f(b) - f(a)) / 864e5);
  }

  /** Ficha de cada tarjeta personal y deuda total. Solo cuentas con ámbito personal. */
  function deudas(cuentas, tarjetas, estados, movs, hoy) {
    const fichas = cuentas.filter(c => activa(c) && c.tipo === 'tarjeta' && c.ambito === 'personal').map(c => {
      const t = tarjetas.find(x => x.cuenta_id === c.id) || {};
      const e = ultimoEstado(t.id || c.id, estados);
      const saldo = saldoCuenta(c, movs);
      const limite = n(t.limite);
      const desde = e ? e.fecha_corte : c.fecha_saldo;
      const abonos = movs.filter(m => real(m) && m.tipo === 'pago_tarjeta' && m.cuenta_destino === c.id && (!desde || m.fecha_efectiva >= desde));
      const abonado = r2(abonos.reduce((a, m) => a + n(m.monto), 0));
      const minimo = e && e.minimo !== '' ? n(e.minimo) : null;
      const fechaLimite = e && e.fecha_limite ? e.fecha_limite : null;
      const faltaMinimo = minimo == null ? null : r2(Math.max(0, minimo - abonado));
      return {
        id: c.id, nombre: c.nombre, saldo, limite: limite || null,
        sobreLimite: limite ? r2(Math.max(0, saldo - limite)) : 0,
        uso: limite ? saldo / limite : null,
        minimo, faltaMinimo, abonado, fechaLimite, fechaCorte: e ? e.fecha_corte : null,
        diasParaLimite: fechaLimite && hoy ? diasEntre(hoy, fechaLimite) : null,
        tasa: t.tasa_anual !== undefined && t.tasa_anual !== '' ? n(t.tasa_anual) : null,
        pagoSinIntereses: e && e.pago_sin_intereses !== '' ? n(e.pago_sin_intereses) : null,
        estado: minimo == null ? 'pendiente' : faltaMinimo === 0 ? 'minimo_cubierto' : abonado > 0 ? 'abono_parcial' : 'sin_abonos',
        conciliado: e ? String(e.conciliado) === 'true' : false
      };
    });
    return { total: r2(fichas.reduce((a, f) => a + Math.max(0, f.saldo), 0)), fichas };
  }

  /** Ingresos y gastos personales de un rango. Traspasos, pagos de tarjeta y aportaciones no cuentan. */
  function flujo(movs, desde, hasta) {
    const dentro = movs.filter(m => real(m) && m.ambito === 'personal' && m.fecha_efectiva >= desde && m.fecha_efectiva <= hasta);
    const ingresos = r2(dentro.filter(m => m.tipo === 'ingreso' || m.tipo === 'retiro_utilidad').reduce((a, m) => a + n(m.monto), 0));
    const gastos = r2(dentro.filter(m => m.tipo === 'gasto' || m.tipo === 'interes' || m.tipo === 'comision').reduce((a, m) => a + n(m.monto), 0));
    return { ingresos, gastos, neto: r2(ingresos - gastos) };
  }

  /** Presupuesto de la semana. Las estimaciones se marcan como tales. */
  function presupuestoSemana(presupuestos, movs, lunes, domingo) {
    const semanal = p => p.periodo === 'semanal' ? n(p.limite) : p.periodo === 'mensual' ? n(p.limite) * 7 / 30.4 : 0;
    const limite = r2(presupuestos.reduce((a, p) => a + semanal(p), 0));
    const obligatorio = r2(presupuestos.filter(p => p.tipo === 'obligatorio').reduce((a, p) => a + semanal(p), 0));
    const ejecutado = flujo(movs, lunes, domingo).gastos;
    return {
      limite, obligatorio, ejecutado, disponible: r2(limite - ejecutado),
      estimado: presupuestos.some(p => String(p.confirmado) !== 'true')
    };
  }

  /** Proyección diaria del efectivo: confirmado hoy + esperados/programados por fecha. */
  function proyeccion(cuentas, movs, hoy, dias) {
    const liq = cuentas.filter(c => activa(c) && c.ambito === 'personal' && LIQUIDAS.indexOf(c.tipo) >= 0).map(c => c.id);
    let saldo = liquidez(cuentas, movs, hoy).confirmado;
    const pend = movs.filter(m => (m.estado === 'esperado' || m.estado === 'programado'));
    const out = [];
    for (let i = 0; i <= dias; i++) {
      const d = new Date(Date.UTC(...hoy.split('-').map((x, j) => j === 1 ? x - 1 : +x)) + i * 864e5).toISOString().slice(0, 10);
      pend.filter(m => i === 0 ? m.fecha_efectiva <= d : m.fecha_efectiva === d).forEach(m => {
        if (liq.indexOf(m.cuenta_destino) >= 0) saldo += n(m.monto);
        if (liq.indexOf(m.cuenta_origen) >= 0) saldo -= n(m.monto);
      });
      out.push({ fecha: d, saldo: r2(saldo) });
    }
    return out;
  }

  /** Números de un proyecto. Aportaciones y préstamos son capital, no ventas. */
  function proyecto(p, movs, productos) {
    const mios = movs.filter(m => m.proyecto_id === p.id && m.estado !== 'cancelado');
    const suma = (f) => r2(mios.filter(f).reduce((a, m) => a + n(m.monto), 0));
    const aportado = suma(m => real(m) && m.tipo === 'aportacion');
    const prestado = suma(m => real(m) && m.tipo === 'prestamo_ambito');
    const devuelto = suma(m => real(m) && m.tipo === 'devolucion_capital');
    const retirado = suma(m => real(m) && m.tipo === 'retiro_utilidad');
    const cobrado = suma(m => real(m) && m.tipo === 'venta');
    const porCobrar = suma(m => m.estado === 'esperado' && m.tipo === 'venta');
    const variables = suma(m => real(m) && m.tipo === 'gasto' && m.naturaleza !== 'fijo');
    const fijos = suma(m => real(m) && m.tipo === 'gasto' && m.naturaleza === 'fijo');
    const pendientes = suma(m => (m.estado === 'programado' || m.estado === 'esperado') && m.tipo === 'gasto');
    const ventas = r2(cobrado + porCobrar);
    const caja = r2(aportado + prestado + cobrado - variables - fijos - devuelto - retirado);
    const prods = productos.filter(x => x.proyecto_id === p.id).map(x => {
      const unit = n(x.precio) - n(x.costo_unitario);
      return { producto: x.producto, margenUnitario: r2(unit), equilibrio: unit > 0 ? Math.ceil(fijos / unit) : null };
    });
    return {
      inversion: aportado, prestamos: prestado, capitalTrabajo: caja, fijos, variables, cobrado, porCobrar,
      margenContribucion: r2(ventas - variables), utilidadEstimada: r2(ventas - variables - fijos),
      flujoDisponible: r2(caja - pendientes), devuelto, retirado, productos: prods
    };
  }

  const api = { saldoCuenta, liquidez, deudas, flujo, presupuestoSemana, proyeccion, proyecto, diasEntre, ultimoEstado };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else raiz.FC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
