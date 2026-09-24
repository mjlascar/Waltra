# Waltra — notas para trabajar en este repo

App de seguimiento de inversiones (Cocos Capital + Binance) para diferentes
usuarios, en sus teléfonos. Next.js 16, React 19, TypeScript, Tailwind v4.
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

|                    | Web / desarrollo          | APK                                |
| ------------------ | ------------------------- | ---------------------------------- |
| Mercado e insights | las rutas `/api`          | el mismo código, en el teléfono    |
| HTTP a proveedores | `fetch` desde el servidor | `CapacitorHttp`, que no tiene CORS |
| Clave de Anthropic | del entorno del servidor  | la carga el usuario en Ajustes     |
| Notificaciones     | no hay                    | el vigía de `public/runners/`      |

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

**El modelo contable cierra, y hay tests que lo prueban.**
`src/lib/engine/__tests__/invariantes.test.ts` recorre los flujos reales
—comprar, vender, transferir, cobrar, pagar comisión, retirar, pesos— y fija
dos identidades que no pueden fallar nunca: `valor = efectivo + invertido` y
`ganancia = valor − capital aportado`. Más una tercera que es la que de verdad
audita: la ganancia se descompone en no realizado + realizado + cobrado −
comisiones sueltas (las de compra y venta ya están adentro del costo y del
realizado; restarlas otra vez es contarlas dos veces). Si un cambio rompe
alguna, la plata está saliendo de algún lado que no corresponde.

Caso que se pregunta solo: comprar 300 teniendo 100. **No genera ganancia
fantasma**: el efectivo se va a −200 y ese negativo cancela exactamente el
activo de más. Pero describe algo que no pudo pasar, así que la app lo dice
—al cargar el movimiento, en el inicio y en el detalle de cuenta— en vez de
taparlo. Casi siempre significa que falta cargar el ingreso que lo financió.

**Una acción de EE.UU. operada en pesos, o desde Cocos, es su CEDEAR**
(`src/lib/cedear.ts`). Un CEDEAR es una fracción de la acción —el de SPY es 20
a 1—, así que confundir los dos es un error de unidades y no de cotización: 9
CEDEARs de SPY son unos US$ 300 y 9 acciones, unos US$ 6.000. Pasó con la
primera compra real cargada en la app. Ni con pesos ni desde un broker
argentino se compra la acción de Nueva York (desde Cocos se compran CEDEARs
también en dólares MEP), así que la regla no tiene falso positivo: el activo
se guarda como `SPY.BA` (fuente BYMA, en pesos), la pantalla lo dice antes de
guardar, y lo que quedó mal cargado de antes se ofrece corregir con un toque
en el inicio. En dólares desde otro broker sí puede ser la acción, y la app es
para más de un usuario: por eso la regla mira el broker (`BROKERS_LOCALES`) y
no solo la moneda. Todo camino que convierta un símbolo en activo pasa por
`resolveTradeAsset`; si agregás uno nuevo y no pasa por ahí, el bug vuelve.

Un CEDEAR comprado en dólares cotiza en pesos, así que el ledger guarda el
costo promedio **en la moneda del activo**, convertido al dólar de la
operación. Sumar los dólares tal cual daba un CEDEAR que "costó $ 33".

El parser encuentra un CEDEAR por el símbolo pelado ("vendí todo el QQQ" es
`QQQ.BA`), y si están cargados la acción y el CEDEAR decide la cuenta.

Los datos de ejemplo tienen CEDEARs en Cocos, comprados en dólares: el
ejemplo no puede contradecir la regla que se aplica a los datos reales. El
simulador de precios cotiza `X.BA` como la acción de `X` dividida por un ratio
de juguete y pasada a pesos; la app real nunca usa ratios.

**Los cambios de ratio y los splits se registran** (`src/lib/engine/splits.ts`,
`type: "split"`). Cuando un CEDEAR cambia de ratio, cada unidad pasa a ser
varias, más baratas. Yahoo entrega **toda la historia ya ajustada** —los
cierres viejos divididos por el ratio—, así que sin registrar el split la app
multiplicaba unidades viejas por precios nuevos: el caso real fue SPY.BA, que
mostró una pérdida de US$ 200 el mismo día de la compra y "bajó 59,6%" desde
ella. Un split cambia las unidades en el ledger (cantidad × ratio, costo por
unidad ÷ ratio, sin plata ni resultado), y la valuación diaria deshace el
ajuste de la serie con `priceFactor`. Si la serie en cambio muestra el salto
(es cruda), no se deshace nada: `seriesAdjustedFor` lo decide mirando los dos
lados de la fecha, para no ajustar dos veces.

Los splits vienen de dos lados: Yahoo los informa junto con la serie
(`events=split`) y se aplican solos, y se pueden cargar a mano para cuando el
proveedor no los informa. Si están los dos, cuenta uno. Los del proveedor
anteriores a la primera operación de un activo se ignoran: si no, la historia
de la cartera arrancaría en esa fecha. Un split aplicado solo se muestra en el
detalle de la posición: las unidades no pueden cambiar sin que se vea por qué.

`priceMismatches` detecta compras que no cierran con la cotización histórica
de ese día (pagado sobre cotizado fuera de 0,55–1,8), que casi siempre es un
split que nadie informó; el inicio lo avisa y ofrece cargarlo con el ratio
sugerido. Solo para acciones, ETFs y CEDEARs: la cripto no se divide. Las
operaciones del historial que va a los insights viajan en unidades de hoy.

**Comprar dólares es un cambio de moneda, no capital** (`type: "exchange"`).
Salen `amount` en `currency` y entran `toAmount` en `toCurrency`, en la misma
cuenta. No mueve el capital aportado ni el rendimiento. Cada lado se valúa al
dólar del día, así que si se pagó más caro que ese dólar la diferencia aparece
como una pérdida chica, que es lo que fue; está fijado en los invariantes.

**Nunca inventar un número.** Sin cotización, una posición se valúa al costo y
la app lo dice (`missingPrices`). Sin dólar MEP, los montos en pesos quedan
sin convertir y la app lo dice (`fxMissing`); el fallback de la tabla de
cambio es 0 y no 1 justamente para eso. Los precios simulados (`WALTRA_MOCK=1`)
siempre viajan marcados y se avisan en pantalla.

**Las métricas siguen la ventana del gráfico.** Las cuatro de la pantalla
principal (capital, ganancia, TWR, TIR) y el número grande de arriba se
recalculan con el rango elegido: `periodView()` en `src/lib/engine/period.ts`.
Antes eran siempre las de toda la historia y cambiar de ventana movía el
gráfico dejándolas quietas, que se lee como un bug. El corte respeta la
convención del TWR —el flujo se asienta al cierre—, así que el valor inicial
de la ventana es el del cierre de su primer día y los aportes que se restan
son los de los días siguientes; restarlos dos veces haría aparecer un aporte
como pérdida. Con la ventana completa tiene que dar **exactamente** los
números de siempre, y hay un test que lo fija. Una TIR anualizada sobre menos
de 90 días es ruido de tres cifras: no se muestra.

**Las fechas son del teléfono, no de UTC.** `today()` usa el reloj local: en
Argentina, `toISOString()` después de las 21 devuelve mañana. Los tests corren
en `America/Argentina/Buenos_Aires` (fijado en `vitest.config.ts`) para que
esos bugs aparezcan acá.

**El TWR asienta el flujo al cierre del día**: `r = (nav − flujo) / nav_ayer − 1`.
La plata que se deposita hoy no rindió hoy. La convención opuesta diluye el
retorno del día en que entró el aporte.

**Nada sensible sale del teléfono.** Los movimientos viven en IndexedDB. Al
modelo solo viajan tickers, pesos y números (ver `src/lib/insights/digest.ts`,
que tiene un test que lo fija). Eso incluye, a propósito, la historia de cada
posición —fecha, cantidad y precio en dólares de cada compra y venta, y las
posiciones ya cerradas—: sin eso el informe solo ve una foto y no puede decir
si alguien promedió a la baja o vendió las ganadoras temprano. Lo que **no**
viaja son la nota y la frase original de un movimiento, que son texto del
usuario y pueden decir cualquier cosa; el esquema las descarta aunque alguien
las mande, y hay un test que lo verifica. Van las 30 operaciones más recientes
por activo y se cuenta cuántas quedaron afuera. En la web la clave de Anthropic se lee solo en
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

La barra de abajo es solo íconos. El nombre de cada pestaña viaja en
`aria-label` y la actual se marca con `aria-current` además de la barrita:
sacar el rótulo visible no puede dejar la navegación muda para un lector de
pantalla.

Los gráficos son SVG escritos a mano en `src/components/charts/`. Las
etiquetas del eje se dibujan **después** de las líneas de datos, sobre un
recorte del color de la superficie: al revés, la línea las cruza. La excepción
son las marcas de movimientos del `ReturnChart`, que van después de las
etiquetas: el recorte de una etiqueta tapaba entera la marca que cayera cerca
del borde derecho, y entre perder un dato y pisar un rótulo del eje se pisa el
rótulo. Llevan un halo del color de la superficie para separarse de lo que
haya abajo.

En el gráfico principal, **la banda entre el valor y el capital aportado es la
ganancia** (`bandRuns` en `scale.ts`). Se corta en cada cruce para que un tramo
en pérdida no quede pintado de verde; tiene tests. El relleno anterior iba de
la línea al piso del eje, que no significaba nada.

El eje del gráfico principal **no arranca en cero**: se ajusta a los datos
(`fitDomain`), con un rango mínimo del 0,5% para que un mes quieto no parezca
una montaña rusa. Desde cero, un mes de una cartera de diez mil eran dos
líneas planas pegadas arriba. Las etiquetas usan `axisMoney`, que pone todas
las marcas en la misma unidad y saca los decimales del paso: si no, marcas a
US$ 50 de distancia se escribían iguales. El de rendimiento sí incluye el
cero, pero porque la ventana arranca ahí por construcción.

El último punto de la serie se pisa con el valor en vivo: la serie diaria usa
el cierre guardado y el total de arriba la cotización del momento, y ver dos
números distintos a diez píxeles se lee como un error.

## Mapa del código

| Dónde                      | Qué                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/engine/`          | Ledger, valuación diaria, TWR, XIRR, riesgo y el recorte por ventana (`period.ts`). Funciones puras, bien cubiertas por tests. Si tocás esto, corré los tests. |
| `src/lib/parse/`           | Frases sueltas en castellano rioplatense (`quick-add.ts`), pegado de varias líneas (`bulk.ts`) y la exportación de Binance (`binance.ts`).                     |
| `src/lib/market/`          | Proveedores de precios. Cada uno aislado: si uno se cae, devuelve el error en el resultado, nunca lanza. `mock.ts` solo se activa con `WALTRA_MOCK=1`.         |
| `src/lib/store.tsx`        | Estado de la app, consultas en vivo a IndexedDB y sincronización de mercado.                                                                                   |
| `src/app/api/`             | Envoltorio fino sobre lo de arriba, para el modo web. La lógica no vive acá.                                                                                   |
| `src/lib/backend/`         | Elige entre las rutas `/api` y correr todo en el teléfono. Es con quien hablan las pantallas.                                                                  |
| `src/lib/alerts/`          | El plan que lee el vigía de precios, y el puente a las preferencias de Android.                                                                                |
| `public/runners/alerts.js` | El vigía. JavaScript plano, sin módulos: corre fuera del WebView.                                                                                              |

## Al tocar el parser

Probá contra frases reales antes de dar algo por bueno. Los bugs que
aparecieron así están fijados en `quick-add.test.ts`: la marca de moneda al
final de la frase no convierte unidades en plata, las palabras que cuentan
unidades ("3 acciones de AAPL"), los sustantivos que funcionan como verbo
("ingreso 250"), y **"por" / "pagando" / "pagué"**, que introducen el total y
no el precio: "compré 9 SPY por 456.345 pesos" se leía como 9 × 456.345. "A"
sigue siendo el precio de cada una.

"Compré 100 dólares a 1450", sin un activo en la frase, es un cambio de
moneda y no una compra a la que le falta el activo. USDT y USDC no entran:
son cripto.

## Al tocar la importación de Binance

Es la exportación "Spot Order History", una fila por orden. La otra
("Transaction History") parte cada operación en varias filas que hay que
aparear por timestamp: no vale la pena.

Tres cosas del formato que ya mordieron y están fijadas en los tests:
el archivo tiene **dos columnas llamadas `Time`** (la segunda es la de
ejecución, y es la que vale: una orden limit se ejecuta días después de
ponerse), los encabezados traen los superíndices de las llamadas al pie
(`Type¹`, `Executed²`, `Trading total³`) y las cantidades vienen con el símbolo
pegado al número, sin espacio (`0.033ETH`).

El par se separa del sufijo más largo al más corto, o `BTCFDUSD` se lee como
`BTCF` contra `USD`. Un par que no cotiza contra dólares se **rechaza con su
motivo**: contarlo como una operación en dólares ensuciaría el costo para
siempre.

El id de cada movimiento sale del número de orden, así que reimportar el mismo
archivo reemplaza en vez de duplicar. El ingreso de capital que ofrece la
pantalla tiene id fijo por la misma razón.

**La exportación no trae ingresos, retiros ni comisiones.** Sin cargar el
capital aparte, el efectivo de la cuenta queda en negativo y el capital
aportado en cero, que es justo lo que la app existe para arreglar. De ahí el
`netoUsd` del resumen y la casilla que ofrece anotarlo: el número sale de las
órdenes, pero el monto y la fecha los decide el usuario.

Los tests usan filas inventadas con el formato exacto. **El historial del
usuario no entra al repositorio**, que es público.

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

**El informe externo** (`src/lib/insights/external.ts`) es el tercer camino:
la app arma el pedido completo para copiar y acepta de vuelta lo que venga. El
JSON si vino, la prosa pelada si no — rechazarla por una formalidad sería
perder el informe. Existe porque un abono de claude.ai no se puede llamar desde
código, y es además el punto de enganche para una automatización: lo que sale
de ahí es lo que un proceso programado leería, y lo que se pega es lo que
escribiría. Sin credenciales nuevas y sin que la app dependa de que ese proceso
exista.

El cuerpo del pedido lo arma un solo memo en la pantalla de Insights
(`datosCartera`) que usan los dos caminos. Armarlos por separado terminaría en
que dicen cosas distintas.

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

`./scripts/firma.sh` genera la clave estable e imprime los cuatro secretos. Se
niega a escribir adentro del repositorio (es público) y a pisar una clave que
ya exista (perderla obliga a desinstalar, y eso borra la base).

El `versionCode` viene del número de corrida y tiene que crecer siempre.

Cada push publica el APK en el release `apk-latest`, que se borra y se rehace
para que la etiqueta apunte al commit recién compilado. El enlace de descarga
es siempre el mismo. Existe porque los artefactos de Actions vienen en un zip,
piden estar logueado y no se bajan desde la app de GitHub del celular.
