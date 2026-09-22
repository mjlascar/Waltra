# Waltra — notas para trabajar en este repo

App de seguimiento de inversiones (Cocos Capital + Binance) para un solo
usuario, en su teléfono. Next.js 16, React 19, TypeScript, Tailwind v4.
Se empaqueta como APK con Capacitor; la versión web sigue andando igual.

## Cómo verificar un cambio

```bash
npm run check   # tipos + lint + tests + escaneo de credenciales
npm run e2e     # recorrido en navegador real (necesita la app levantada)
```

Para el recorrido end-to-end, en otra terminal: `WALTRA_MOCK=1 npm run dev`.
El `e2e` corre en un viewport de 360×760 (Galaxy S10e) y falla si aparece
cualquier error en la consola del navegador.

`npm run pwa` verifica la promesa de PWA (manifest, íconos, service worker y
que la app abra y acepte movimientos sin conexión). Necesita un build de
producción: el service worker no se registra en desarrollo.

`npm run native` recorre el build del APK sin necesitar un teléfono: sirve la
exportación estática como archivos sueltos, igual que el WebView, y verifica
que la app arranca sin servidor. Antes hay que correr `npm run build:native`.

```bash
npm run build && WALTRA_MOCK=1 npm start          # en una terminal
BASE_URL=http://127.0.0.1:3000 npm run pwa        # en otra
```

`npm run shoot` saca capturas de todas las vistas a `screenshots/`;
`node scripts/states.mjs` captura estados puntuales (hojas abiertas,
importación, comparación contra el índice).

## Los dos modos

La app corre en dos envoltorios y el código es el mismo. `src/lib/platform.ts`
decide cuál, **en tiempo de compilación** (`NEXT_PUBLIC_WALTRA_NATIVE`), no en
tiempo de ejecución: así el empaquetador borra el camino que no corresponde y
no hay ventana en la que el primer refresco salga por el transporte equivocado.

| | Web / desarrollo | APK |
|---|---|---|
| Mercado e insights | las rutas `/api` | el mismo código, en el teléfono |
| HTTP a proveedores | `fetch` desde el servidor | `CapacitorHttp`, que no tiene CORS |
| Clave de Anthropic | del entorno del servidor | la carga el usuario en Ajustes |
| Notificaciones | no hay | el vigía de `public/runners/` |

Las pantallas hablan con `src/lib/backend/` y no saben cuál de los dos es. Si
agregás una llamada nueva, va ahí: `fetch("/api/...")` directo desde un
componente rompe el APK y no lo vas a notar hasta compilarlo.

`WALTRA_NATIVE=1` saca las rutas `/api` del build quitando `ts` de
`pageExtensions`. Es la única forma limpia de excluirlas sin mover archivos, y
funciona porque todas las pantallas son `.tsx`. Si algún día hace falta un
`.ts` adentro de `src/app`, esto se rompe.

## Decisiones que no conviene deshacer sin pensarlo

**El capital no es ganancia.** Es la razón de existir de la app. Los tipos de
movimiento se dividen en capital externo (`deposit` / `withdraw`) e internos
(`buy` / `sell` / `transfer` / `dividend` / `interest` / `fee`). Solo los
primeros mueven "capital aportado". Si un cambio hace que una transferencia
entre cuentas propias aparezca como capital nuevo, el cambio está mal.

**Nunca inventar un número.** Sin cotización, una posición se valúa al costo y
la app lo dice (`missingPrices`). Sin dólar MEP, los montos en pesos quedan
sin convertir y la app lo dice (`fxMissing`); el fallback de la tabla de
cambio es 0 y no 1 justamente para eso. Los precios simulados (`WALTRA_MOCK=1`)
siempre viajan marcados y se avisan en pantalla.

**Las fechas son del teléfono, no de UTC.** `today()` usa el reloj local: en
Argentina, `toISOString()` después de las 21 devuelve mañana. Los tests corren
en `America/Argentina/Buenos_Aires` (fijado en `vitest.config.ts`) para que
esos bugs aparezcan acá.

**El TWR asienta el flujo al cierre del día**: `r = (nav − flujo) / nav_ayer − 1`.
La plata que se deposita hoy no rindió hoy. La convención opuesta diluye el
retorno del día en que entró el aporte.

**Nada sensible sale del teléfono.** Los movimientos viven en IndexedDB. Al
modelo solo viajan tickers, pesos y números (ver `src/lib/insights/digest.ts`,
que tiene un test que lo fija). En la web la clave de Anthropic se lee solo en
el servidor; en el APK la carga el usuario, no se vuelve a mostrar y queda
fuera del backup, que es un archivo que termina en Drive o en un mail. El
backup automático de Android está apagado por lo mismo. El repositorio es
público: `scripts/check-secrets.sh` corre en cada verificación y en CI.

## Diseño

Modo oscuro único, `border-radius: 0` en todo, tipografía neutra y números
monoespaciados con `tabular-nums`. Los tokens están en `src/app/globals.css`.

La paleta de datos (`--color-s1` a `--color-s6`) está validada para banda de
luminosidad, croma, separación bajo daltonismo y contraste ≥ 3:1 contra la
superficie oscura. **El orden es la garantía, no una preferencia**: no se cicla
ni se reordena. Más de 5 series se pliegan a "Otros".

Ninguna información depende del color solo: siempre hay signo, etiqueta o
ícono al lado. Con dos o más series hay leyenda; con una, no.

Los gráficos son SVG escritos a mano en `src/components/charts/`. Las
etiquetas del eje se dibujan **después** de las líneas de datos, sobre un
recorte del color de la superficie: al revés, la línea las cruza.

## Mapa del código

| Dónde | Qué |
|---|---|
| `src/lib/engine/` | Ledger, valuación diaria, TWR, XIRR, riesgo. Funciones puras, bien cubiertas por tests. Si tocás esto, corré los tests. |
| `src/lib/parse/` | Frases sueltas en castellano rioplatense (`quick-add.ts`) y pegado de varias líneas (`bulk.ts`). |
| `src/lib/market/` | Proveedores de precios. Cada uno aislado: si uno se cae, devuelve el error en el resultado, nunca lanza. `mock.ts` solo se activa con `WALTRA_MOCK=1`. |
| `src/lib/store.tsx` | Estado de la app, consultas en vivo a IndexedDB y sincronización de mercado. |
| `src/app/api/` | Envoltorio fino sobre lo de arriba, para el modo web. La lógica no vive acá. |
| `src/lib/backend/` | Elige entre las rutas `/api` y correr todo en el teléfono. Es con quien hablan las pantallas. |
| `src/lib/alerts/` | El plan que lee el vigía de precios, y el puente a las preferencias de Android. |
| `public/runners/alerts.js` | El vigía. JavaScript plano, sin módulos: corre fuera del WebView. |

## Al tocar el parser

Probá contra frases reales antes de dar algo por bueno. Los tres bugs que
aparecieron así están fijados en `quick-add.test.ts`: la marca de moneda al
final de la frase no convierte unidades en plata, las palabras que cuentan
unidades ("3 acciones de AAPL") y los sustantivos que funcionan como verbo
("ingreso 250").

## Al tocar los insights

Hay **dos proveedores**, Claude y Gemini, detrás de un contrato chico
(`src/lib/insights/engine.ts`). El informe se arma en dos pasos —investigar con
búsqueda web, después estructurar sin ella— y eso no es una preferencia: en
Gemini la búsqueda de Google y el formato JSON estricto **no se pueden pedir en
el mismo turno**, y en Anthropic pedirlos juntos sale mal. Si el segundo paso
falla, el informe se devuelve en prosa (`degraded`) en vez de perderse: la
búsqueda ya se pagó.

Las fuentes salen distinto en cada uno: Claude las cita dentro del texto y hay
que extraerlas, Gemini las devuelve en `groundingChunks`. Cuando el proveedor
las da aparte, esas mandan: son las que realmente se consultaron.

No todos los modelos de Anthropic aceptan el mismo pedido: `modelShape()`
decide la variante de búsqueda web y si va pensamiento adaptativo. Proveedor y
modelo llegan del navegador, así que se validan contra la lista blanca de
`src/lib/insights/providers.ts` — aceptar cualquier cadena sería dejar que un
pedido cualquiera elija qué se factura.

Las claves de los dos proveedores se guardan por separado (`apiKey` y
`geminiKey`): cambiar de proveedor para probar no tiene que borrar la del otro.
Las dos quedan fuera del backup.

Para revisar cómo se ve un informe sin gastar créditos:
`node scripts/insights-preview.mjs` inyecta uno de muestra en la base local.

## Idioma

Interfaz y mensajes al usuario en castellano rioplatense, con acentos.
Comentarios y commits en castellano. Identificadores en inglés.

## Al tocar los informes programados

La app no tiene servidor, así que nadie puede generar un informe mientras el
teléfono duerme: lo que se agenda es el **recordatorio**. A la hora elegida el
vigía manda una notificación y, al abrir, el informe aparece esperando con un
botón. Generarlo solo gastaría créditos de la cuenta del usuario sin que esté
mirando, que es la clase de cosa que se descubre a fin de mes.

`lastOccurrence` está escrita dos veces —en `src/lib/insights/schedule.ts` y
en el vigía, que no puede importar módulos— y hay un test que carga las dos y
compara. Si se separan, el aviso llega un día antes o un día después y nadie
entiende por qué.

## Al tocar las alertas

El vigía (`public/runners/alerts.js`) no es la app: corre en un motor chico de
Android, sin módulos, sin `Intl` y con un `fetch` que solo acepta `method`,
`headers` y `body`. No lo importes ni lo compiles; está escrito a mano a
propósito. Se prueba cargándolo en un contexto con las globales simuladas
(`src/lib/alerts/__tests__/runner.test.ts`), que es el archivo exacto que viaja
en el APK y no una copia en TypeScript.

El plan viaja por las preferencias compartidas de Android, y la app y el vigía
solo se ven si **`KV_GROUP` en `src/lib/alerts/mirror.ts` es igual al `label`
del runner en `capacitor.config.ts`**. Si se separan, las alertas dejan de
salir sin un solo error en ningún lado.

Android decide cuándo corre: el intervalo que se pide es un pedido, no una
promesa, y nunca baja de 15 minutos. La pantalla lo dice así en vez de prometer
puntualidad.

## Al tocar los plugins de Capacitor

Son proxies que convierten cualquier acceso a una propiedad en una llamada al
puente nativo, `.then` incluido. Devolver uno desde una función `async` hace
que el motor lo tome por una promesa y explote con
`"Preferences.then() is not implemented"`. Va envuelto en un objeto común.

## Al tocar el APK

Android identifica la app por su paquete **y su firma**. Un APK firmado con
otra clave no se instala encima del anterior: hay que desinstalar, y eso borra
la base local. La clave de depuración cambia en cada corrida de CI, así que el
APK de Actions sirve para probar y no para actualizar. La firma estable se
configura con cuatro secretos del repositorio (ver README); sin ellos el build
igual sale, con un aviso en el log.

El `versionCode` viene del número de corrida y tiene que crecer siempre.

Cada push publica el APK en el release `apk-latest`, que se borra y se rehace
para que la etiqueta apunte al commit recién compilado. El enlace de descarga
es siempre el mismo. Existe porque los artefactos de Actions vienen en un zip,
piden estar logueado y no se bajan desde la app de GitHub del celular.
