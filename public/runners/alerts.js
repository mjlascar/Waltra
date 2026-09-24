/*
 * El vigia de precios.
 *
 * Corre fuera del WebView, en un motor JavaScript chico que Android despierta
 * cada tanto. No es la app: no tiene React, ni IndexedDB, ni los modulos de
 * src/. Lee el plan que la app le deja en el almacen de clave-valor, consulta
 * los precios y, si algo se movio mas de lo que el usuario pidio, manda una
 * notificacion.
 *
 * Limitaciones del entorno, que explican varias decisiones de abajo:
 *   - `fetch` solo acepta method, headers y body. Nada de AbortController.
 *   - No hay Intl: los numeros se formatean a mano.
 *   - No hay estado entre corridas: todo lo que hay que recordar va al KV.
 *   - Hay que llamar a resolve() o reject() SIEMPRE, o el sistema mata el
 *     proceso de mala manera.
 *
 * Android no garantiza el intervalo. Puede pasar una hora sin correr, o correr
 * dos veces seguidas. La logica de deduplicacion asume las dos cosas.
 *
 * Este archivo se prueba de verdad: src/lib/alerts/__tests__/runner.test.ts lo
 * carga en un contexto con las funciones globales simuladas y le revisa las
 * decisiones.
 */

var PLAN_KEY = "waltra.alertas.plan";
var STATE_KEY = "waltra.alertas.estado";
var TIMEOUT_MS = 20000;

/* --- almacen ------------------------------------------------------------ */

function kvRead(key) {
  try {
    var row = CapacitorKV.get(key);
    if (!row || !row.value) return null;
    return JSON.parse(row.value);
  } catch (err) {
    return null;
  }
}

function kvWrite(key, value) {
  try {
    CapacitorKV.set(key, JSON.stringify(value));
  } catch (err) {
    // Que no se pueda guardar el estado no justifica perder la corrida: a lo
    // sumo se repite un aviso.
  }
}

/* --- fechas y formato --------------------------------------------------- */

/** El dia segun el reloj del telefono, igual que en el resto de la app. */
function localDay(date) {
  var y = date.getFullYear();
  var m = date.getMonth() + 1;
  var d = date.getDate();
  return y + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
}

/** 1234.5 -> "1.234,5". Sin Intl, que en este motor no existe. */
function numero(value, decimals) {
  var neg = value < 0;
  var fixed = Math.abs(value).toFixed(decimals);
  var parts = fixed.split(".");
  var entero = parts[0];
  var out = "";
  for (var i = 0; i < entero.length; i++) {
    if (i > 0 && (entero.length - i) % 3 === 0) out += ".";
    out += entero[i];
  }
  if (parts.length > 1) out += "," + parts[1];
  return (neg ? "-" : "") + out;
}

/**
 * Mismo formato que `money()` en src/lib/format.ts, incluido que el signo va
 * antes del simbolo: "-US$ 1.000" y no "US$ -1.000". Es la misma app hablando.
 */
function dinero(value) {
  var abs = Math.abs(value);
  var decimals = abs >= 1000 ? 0 : 2;
  return (value < 0 ? "-" : "") + "US$ " + numero(abs, decimals);
}

function porcentaje(value) {
  return (value >= 0 ? "+" : "") + numero(value, 1) + "%";
}

/** Un id estable y chico por simbolo: Android pide un entero de 32 bits. */
function notifId(prefijo, texto) {
  var h = 5381;
  var clave = prefijo + ":" + texto;
  for (var i = 0; i < clave.length; i++) h = ((h * 33) ^ clave.charCodeAt(i)) >>> 0;
  return (h % 2000000) + 1000;
}

/* --- horario ------------------------------------------------------------ */

/** Franja sin molestar. [23, 8] cruza la medianoche; [13, 15] no. */
function enSilencio(quiet, hora) {
  if (!quiet) return false;
  var desde = quiet[0];
  var hasta = quiet[1];
  if (desde === hasta) return false;
  if (desde < hasta) return hora >= desde && hora < hasta;
  return hora >= desde || hora < hasta;
}

/* --- red ---------------------------------------------------------------- */

function conTimeout(promise) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () {
        reject(new Error("timeout"));
      }, TIMEOUT_MS);
    }),
  ]);
}

function traerJson(url) {
  return conTimeout(
    fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
        Accept: "application/json,text/plain,*/*",
      },
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }),
  );
}

/* --- proveedores -------------------------------------------------------- */
/*
 * Solo cotizaciones del dia: ni historia ni conversiones finas. Las formas de
 * respuesta son las mismas que lee src/lib/market, y el test las fija en los
 * dos lados para que no se separen sin que nadie se entere.
 */

function precioBinance(assets) {
  var simbolos = [];
  for (var i = 0; i < assets.length; i++) simbolos.push(assets[i].ss.toUpperCase());
  if (simbolos.length === 0) return Promise.resolve({});
  var url =
    "https://api.binance.com/api/v3/ticker/24hr?symbols=" +
    encodeURIComponent(JSON.stringify(simbolos));
  return traerJson(url).then(function (rows) {
    var out = {};
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      out[String(row.symbol).toUpperCase()] = {
        price: Number(row.lastPrice),
        changePct: Number(row.priceChangePercent),
      };
    }
    return out;
  });
}

function precioYahoo(assets) {
  var out = {};
  var tareas = assets.map(function (asset) {
    var url =
      "https://query1.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(asset.ss) +
      "?range=5d&interval=1d&includePrePost=false";
    return traerJson(url)
      .then(function (data) {
        var result = data && data.chart && data.chart.result && data.chart.result[0];
        if (!result) return;
        var meta = result.meta || {};
        var price = meta.regularMarketPrice;
        var prev = meta.chartPreviousClose || meta.previousClose;
        if (typeof price !== "number" || !prev) return;
        out[asset.ss.toUpperCase()] = { price: price, changePct: (price / prev - 1) * 100 };
      })
      .catch(function () {
        // Un simbolo que falla no puede tumbar a los demas.
      });
  });
  return Promise.all(tareas).then(function () {
    return out;
  });
}

function precioByma(assets) {
  if (assets.length === 0) return Promise.resolve({});
  var feeds = ["arg_stocks", "arg_cedears", "arg_bonds"];
  var tablero = {};
  var tareas = feeds.map(function (feed) {
    return traerJson("https://data912.com/live/" + feed)
      .then(function (rows) {
        if (!rows || !rows.length) return;
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          var sym = String(row.symbol || row.ticker || "").toUpperCase();
          if (sym) tablero[sym] = row;
        }
      })
      .catch(function () {});
  });
  return Promise.all(tareas).then(function () {
    var out = {};
    for (var i = 0; i < assets.length; i++) {
      var asset = assets[i];
      var clave = asset.ss.toUpperCase().replace(/\.BA$/, "");
      var row = tablero[clave];
      if (!row) continue;
      var precio = row.c;
      if (typeof precio !== "number") precio = row.close;
      if (typeof precio !== "number") precio = row.last;
      if (typeof precio !== "number" || !(precio > 0)) continue;
      var cambio = typeof row.pct_change === "number" ? row.pct_change : row.variation;
      out[asset.ss.toUpperCase()] = {
        price: precio,
        changePct: typeof cambio === "number" ? cambio : 0,
      };
    }
    return out;
  });
}

/** Cotizaciones de todos los activos del plan, por clave `origen|simbolo`. */
function traerPrecios(assets) {
  var porFuente = { binance: [], yahoo: [], byma: [] };
  for (var i = 0; i < assets.length; i++) {
    var lista = porFuente[assets[i].src];
    if (lista) lista.push(assets[i]);
  }
  return Promise.all([
    precioBinance(porFuente.binance).catch(function () {
      return {};
    }),
    precioYahoo(porFuente.yahoo),
    precioByma(porFuente.byma).catch(function () {
      return {};
    }),
  ]).then(function (res) {
    var out = {};
    var fuentes = ["binance", "yahoo", "byma"];
    for (var f = 0; f < fuentes.length; f++) {
      var mapa = res[f];
      for (var clave in mapa) {
        if (Object.prototype.hasOwnProperty.call(mapa, clave)) {
          out[fuentes[f] + "|" + clave] = mapa[clave];
        }
      }
    }
    return out;
  });
}

/* --- decision ----------------------------------------------------------- */

/**
 * Que avisar, dado el plan, los precios y lo que ya se aviso hoy.
 *
 * Separado del resto a proposito: es la unica parte con reglas de verdad, y
 * asi se puede probar sin red y sin telefono.
 */
function decidir(plan, precios, estado, ahora) {
  var hora = ahora.getHours();
  var dia = localDay(ahora);
  // Los recordatorios no miran precios ni respetan el silencio: la hora la
  // eligio el usuario a proposito.
  var recordados = recordatorios(plan, estado, ahora);
  var silencio = enSilencio(plan.quiet, hora);
  var avisos = [];
  var notificados = estado.day === dia && estado.notified ? estado.notified : {};
  var siguiente = {};

  var totalHoy = plan.cashUsd || 0;
  var totalAyer = plan.cashUsd || 0;
  var conPrecio = 0;

  for (var i = 0; i < plan.assets.length; i++) {
    var a = plan.assets[i];
    var q = precios[a.src + "|" + a.ss.toUpperCase()];
    if (!q || !(q.price > 0)) continue;
    conPrecio++;

    // Los pesos se pasan a dolares al MEP que la app dejo anotado. Sin
    // cotizacion no se convierte: mejor un total corto que uno inventado.
    var aDolar = a.cur === "ARS" ? (plan.arsPerUsd > 0 ? 1 / plan.arsPerUsd : 0) : 1;
    var cambio = typeof q.changePct === "number" ? q.changePct : 0;
    var anterior = q.price / (1 + cambio / 100);
    totalHoy += a.qty * q.price * aDolar;
    totalAyer += a.qty * anterior * aDolar;

    if (!(a.pct > 0)) continue;
    var magnitud = Math.abs(cambio);
    if (magnitud < a.pct) continue;

    // En silencio no se avisa ni se anota: si a las 3 de la mañana algo se
    // desploma, el aviso tiene que salir cuando termina la franja, no
    // perderse por haberlo dado por avisado mientras nadie miraba.
    if (silencio) continue;

    // Ya avisado hoy: solo se vuelve a avisar si se movio otro escalon entero.
    // Sin esto, un activo que pasa el umbral a la mañana notifica en cada
    // corrida hasta que termine el dia.
    var previo = notificados[a.sym];
    if (typeof previo === "number" && magnitud < previo + a.pct) {
      siguiente[a.sym] = previo;
      continue;
    }
    siguiente[a.sym] = magnitud;

    avisos.push({
      id: notifId("activo", a.sym),
      title: a.sym + " " + porcentaje(cambio),
      body:
        (cambio >= 0 ? "Subió" : "Bajó") +
        " " +
        numero(magnitud, 1) +
        "% hoy. Ahora " +
        (a.cur === "ARS" ? "$ " + numero(q.price, 2) : dinero(q.price)) +
        ".",
      group: "waltra-activos",
    });
  }

  // Los avisos que ya estaban vigentes y hoy no se tocaron siguen contando:
  // borrarlos haria que el proximo movimiento chico vuelva a notificar.
  for (var sym in notificados) {
    if (Object.prototype.hasOwnProperty.call(notificados, sym) && siguiente[sym] === undefined) {
      siguiente[sym] = notificados[sym];
    }
  }

  var carteraPct = null;
  if (conPrecio > 0 && totalAyer > 0) carteraPct = (totalHoy / totalAyer - 1) * 100;

  if (
    carteraPct !== null &&
    plan.portfolioPct > 0 &&
    Math.abs(carteraPct) >= plan.portfolioPct &&
    !silencio
  ) {
    var previoCartera = estado.day === dia ? estado.portfolio : undefined;
    var yaAvisado =
      typeof previoCartera === "number" && Math.abs(carteraPct) < previoCartera + plan.portfolioPct;
    if (!yaAvisado) {
      estado.portfolio = Math.abs(carteraPct);
      avisos.push({
        id: notifId("cartera", "total"),
        title: "Tu cartera " + porcentaje(carteraPct),
        body: dinero(totalHoy) + " ahora. " + dinero(totalHoy - totalAyer) + " en el día.",
        group: "waltra-cartera",
      });
    }
  } else if (estado.day !== dia) {
    estado.portfolio = undefined;
  }

  // El resumen diario sale a la hora elegida, una sola vez, y no respeta el
  // silencio porque el usuario eligio la hora a proposito.
  var resumenHecho = estado.digestDay === dia;
  if (plan.digestHour !== null && hora >= plan.digestHour && !resumenHecho && conPrecio > 0) {
    estado.digestDay = dia;
    avisos.push({
      id: notifId("resumen", dia),
      title: "Waltra · " + dinero(totalHoy),
      body:
        carteraPct === null
          ? "Resumen del día."
          : porcentaje(carteraPct) + " en el día, " + dinero(totalHoy - totalAyer) + ".",
      group: "waltra-resumen",
    });
  }

  return {
    avisos: recordados.avisos.concat(avisos),
    estado: {
      day: dia,
      notified: siguiente,
      portfolio: estado.portfolio,
      digestDay: estado.digestDay,
      agenda: recordados.agenda,
    },
  };
}

/* --- informes agendados -------------------------------------------------- */

var NOMBRE_INFORME = {
  cartera: "Análisis de tu cartera",
  mercado: "Resumen de mercado",
};

/** Dia de la semana en ISO (1 = lunes … 7 = domingo) del reloj local. */
function isoWeekday(date) {
  var d = date.getDay();
  return d === 0 ? 7 : d;
}

/**
 * Cuando le tocaba por ultima vez, como fecha local YYYY-MM-DD.
 *
 * Misma logica que `lastOccurrence` en src/lib/insights/schedule.ts, escrita
 * de nuevo porque aca no se pueden importar modulos. El test carga los dos y
 * compara, asi que no pueden separarse sin que salte.
 */
function ultimaVez(item, ahora) {
  var c = new Date(ahora);
  c.setHours(item.h, 0, 0, 0);
  for (var i = 0; i < 8; i++) {
    if (isoWeekday(c) === item.wd && c <= ahora) return localDay(c);
    c.setDate(c.getDate() - 1);
    c.setHours(item.h, 0, 0, 0);
  }
  return null;
}

/**
 * Recordatorios de informe. El vigia no los genera: eso gasta creditos de la
 * cuenta del usuario y se hace con el usuario mirando. Solo avisa.
 */
function recordatorios(plan, estado, ahora) {
  var avisos = [];
  var hechos = estado.agenda || {};
  var siguiente = {};
  var agenda = plan.agenda || [];

  for (var i = 0; i < agenda.length; i++) {
    var item = agenda[i];
    var toco = ultimaVez(item, ahora);
    siguiente[item.kind] = hechos[item.kind];
    if (!toco || hechos[item.kind] === toco) continue;
    siguiente[item.kind] = toco;
    avisos.push({
      id: notifId("informe", item.kind),
      title: NOMBRE_INFORME[item.kind] || "Informe de Waltra",
      body: "Te toca. Abrí Waltra y generalo cuando quieras.",
      group: "waltra-informes",
    });
  }

  return { avisos: avisos, agenda: siguiente };
}

/* --- versiones nuevas ---------------------------------------------------- */

/*
 * La app no esta en Play: nadie le avisa al telefono que salio un APK nuevo.
 * El vigia ya se despierta cada tanto, asi que de paso mira el release de
 * GitHub. No en cada corrida: GitHub deja 60 pedidos por hora sin
 * credenciales y una version nueva no es urgente.
 */
var VERSION_CADA_MS = 6 * 60 * 60 * 1000;

/**
 * El numero de version de un release, "1.0.<n>" en el titulo o en las notas.
 * Misma logica que `releaseBuild` en src/lib/update.ts; el test compara las
 * dos.
 */
function versionPublicada(release) {
  if (!release) return null;
  var textos = [release.name, release.body];
  for (var i = 0; i < textos.length; i++) {
    if (typeof textos[i] !== "string") continue;
    var m = textos[i].match(/\b1\.0\.(\d+)\b/);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Si toca preguntar: hay que saber la version instalada, y no en silencio. */
function tocaRevisarVersion(plan, estado, ahora) {
  if (!plan.update || !(plan.update.build > 0) || !plan.update.api) return false;
  if (enSilencio(plan.quiet, ahora.getHours())) return false;
  var ultima = estado.upd && estado.upd.at;
  return !(typeof ultima === "number" && ahora.getTime() - ultima < VERSION_CADA_MS);
}

/**
 * Que hacer con la version publicada. Se avisa una sola vez por version: si
 * el usuario no actualiza, no se lo recuerda cada seis horas.
 */
function decidirVersion(plan, publicada, estado, ahora) {
  var avisada = estado.upd ? estado.upd.notified : undefined;
  var upd = { at: ahora.getTime(), notified: avisada };
  if (typeof publicada !== "number" || !(publicada > plan.update.build) || avisada === publicada) {
    return { aviso: null, upd: upd };
  }
  upd.notified = publicada;
  return {
    aviso: {
      id: notifId("version", "apk"),
      title: "Hay una versión nueva de Waltra",
      body: "La 1.0." + publicada + " está lista. Abrí la app y actualizala desde Ajustes.",
      group: "waltra-version",
    },
    upd: upd,
  };
}

/* --- corrida ------------------------------------------------------------ */

function correr() {
  var plan = kvRead(PLAN_KEY);
  if (!plan || plan.v !== 1) return Promise.resolve("sin plan");
  var activos = plan.assets || [];
  var agenda = plan.agenda || [];
  if (activos.length === 0 && agenda.length === 0 && !plan.update) return Promise.resolve("sin plan");

  var hayRed = true;
  try {
    var red = CapacitorDevice.getNetworkStatus();
    if (red && red.connected === false) hayRed = false;
  } catch (err) {
    // Si no se puede consultar la red, se intenta igual.
  }

  // Un recordatorio de informe no necesita precios: sin red se manda igual.
  var precios = activos.length > 0 && hayRed ? traerPrecios(activos) : Promise.resolve({});

  // undefined: no se pregunto, o GitHub no contesto. Se vuelve a intentar en
  // la proxima corrida sin anotar nada.
  var estadoPrevio = kvRead(STATE_KEY) || {};
  var version =
    hayRed && tocaRevisarVersion(plan, estadoPrevio, new Date())
      ? traerJson(plan.update.api).then(versionPublicada, function () {
          return undefined;
        })
      : Promise.resolve(undefined);

  return Promise.all([precios, version]).then(function (res) {
    var precios = res[0];
    var publicada = res[1];
    var ahora = new Date();
    var estado = kvRead(STATE_KEY) || {};
    var salida = decidir(plan, precios, estado, ahora);
    salida.estado.upd = estado.upd;
    if (publicada !== undefined) {
      var v = decidirVersion(plan, publicada, estado, ahora);
      salida.estado.upd = v.upd;
      if (v.aviso) salida.avisos.push(v.aviso);
    }
    kvWrite(STATE_KEY, salida.estado);

    if (salida.avisos.length === 0) return "sin novedades";

    var ya = Date.now();
    var programadas = salida.avisos.map(function (aviso, i) {
      return {
        id: aviso.id,
        title: aviso.title,
        body: aviso.body,
        // Un segundo de aire: el motor pide una fecha y "ya" a veces llega
        // tarde a la cola del sistema.
        scheduleAt: new Date(ya + 1000 + i * 200),
        group: aviso.group,
        autoCancel: true,
        // El `smallIcon` de capacitor.config es del plugin de notificaciones
        // locales; este camino es otro y no lo lee. Sin esto, Android dibuja
        // el icono de la app y sale un cuadrado blanco.
        smallIcon: "ic_stat_waltra",
      };
    });
    CapacitorNotifications.schedule(programadas);
    return salida.avisos.length + " aviso(s)";
  });
}

addEventListener("checkPrices", function (resolve, reject) {
  try {
    correr().then(
      function (detalle) {
        console.log("[waltra] " + detalle);
        resolve();
      },
      function (err) {
        console.error("[waltra] " + (err && err.message ? err.message : err));
        // Se resuelve igual: un error de red no es motivo para que Android
        // marque la tarea como fallida y empiece a espaciarla.
        resolve();
      },
    );
  } catch (err) {
    reject(err);
  }
});
