# Waltra

Seguimiento unificado de inversiones en **Cocos Capital** y **Binance**, pensado
para usarse desde el teléfono.

La idea que ordena todo lo demás: **el capital que ponés no es ganancia**. Los
gráficos de los brokers mezclan las dos cosas, y cada transferencia nueva
aparece como si la cartera hubiera crecido. Acá son dos líneas separadas, y la
distancia entre ellas es —literalmente— lo que ganaste.

![Resumen](screenshots/v3-01-resumen.png)

## Qué hace

- **Cargás como si escribieras una nota.** `pasé 100 dólares a cocos`,
  `compré 50 de QQQ a 480`, `vendí 2 QQQ a 520 ayer`, `retiré 200 de binance`.
  La app muestra lo que entendió antes de guardar, y se corrige de un toque.
- **Una sola cartera.** Cocos y Binance en la misma vista, con el detalle por
  cuenta cuando lo querés.
- **Precios al día.** Acciones y ETFs (Yahoo Finance), cripto (Binance), mercado
  local y CEDEARs (data912 / BYMA) y dólar MEP.
- **Métricas que no mienten:**
  - *Capital aportado*: ingresos menos retiros. Las transferencias entre tus
    cuentas no cuentan como capital nuevo.
  - *Ganancia*: valor actual menos capital aportado.
  - *Rendimiento real (TWR)*: encadena los retornos diarios neutralizando los
    aportes. Contesta "qué tan bien elegí", sin que el momento en que pusiste
    la plata ensucie el número.
  - *TIR anual (XIRR)*: lo mismo pero desde tu bolsillo, anualizado.
  - Volatilidad anualizada y peor caída desde un pico.
- **Insights con IA.** Busca noticias recientes sobre tus posiciones, las cruza
  con cómo venís operando y devuelve una lectura con fuentes citadas. Requiere
  tu propia clave de Anthropic; sin ella el resto de la app funciona igual.
- **Todo vive en tu teléfono.** IndexedDB, sin cuenta ni servidor propio. Backup
  y restauración a un archivo JSON que es tuyo.
- **Instalable y offline.** Es una PWA: se agrega a la pantalla de inicio y abre
  sin conexión (lo único que no anda sin internet es traer precios nuevos).

## Arrancar

```bash
npm install
npm run dev
```

Abrí `http://localhost:3000`. La primera vez podés cargar datos de ejemplo para
ver cómo se comporta con historia real antes de meter los tuyos.

### Desde el celular, en tu red

```bash
npm run dev            # ya escucha en 0.0.0.0
```

Entrá desde el teléfono a `http://<ip-de-tu-compu>:3000`. En Chrome de Android:
menú → *Agregar a la pantalla principal*.

### En producción

```bash
npm run build
npm start
```

Anda tal cual en Vercel, Railway, Fly o un VPS con Node. Es una app Next.js
común: las rutas `/api` son server-side y el resto es estático.

## Configuración

Copiá `.env.example` a `.env.local`. Todo es opcional.

| Variable | Para qué |
|---|---|
| `ANTHROPIC_API_KEY` | Habilita la sección de Insights. Se lee **solo en el servidor**: nunca viaja al navegador. |
| `WALTRA_MODEL` | Modelo a usar. Por defecto `claude-opus-5`. |
| `WALTRA_ACCESS_KEY` | Si publicás la app en internet, exige esta clave en las rutas `/api`. La cargás una vez en Ajustes y queda en el teléfono. |
| `WALTRA_MOCK` | `1` usa precios simulados para probar la interfaz. La app lo avisa en pantalla con un cartel. |

> Este repositorio es público: `.env` y `.env.local` están en `.gitignore` y
> ninguna clave se commitea. `.env.example` va siempre con los valores vacíos.

## Cómo se calcula

Los números salen de `src/lib/engine`, que son funciones puras sobre la lista de
movimientos. Están cubiertas por tests (`npm test`).

**Tipos de movimiento.** La distinción que hace que todo lo demás cierre:

| Tipo | Efecto |
|---|---|
| `deposit` / `withdraw` | Capital externo. Mueve "capital aportado". **No** es resultado. |
| `buy` / `sell` | Interno: cambia efectivo por activo. No toca el capital aportado. |
| `transfer` | Entre tus cuentas. No es capital nuevo, solo cambia dónde está la plata. |
| `dividend` / `interest` | Resultado cobrado en efectivo. Suma ganancia, no capital. |
| `fee` | Costo. |

**Costo de las posiciones:** promedio ponderado, con la comisión incorporada al
costo. Una venta realiza resultado contra ese promedio.

**TWR (rendimiento real):** se encadenan los retornos diarios con el flujo
asentado al cierre del día:

```
r = (valor_hoy − flujo_hoy) / valor_ayer − 1
```

Es decir: la plata que depositás hoy no rindió hoy. Con la convención opuesta,
un aporte hecho el mismo día que el mercado se mueve diluye el retorno de ese
día y el número deja de ser comparable.

**TIR (XIRR):** Newton-Raphson con bisección de respaldo sobre los flujos
externos más el valor actual como flujo final.

**Pesos y dólares:** la base es USD. Los movimientos en pesos se convierten al
MEP de esa fecha (o al que cargues a mano en la operación, que tiene prioridad).

**Cuando falta un precio**, la posición se valúa al costo y la app lo dice en
pantalla. Preferimos subestimar antes que inventar.

## Estructura

```
src/
  app/                 Páginas (Resumen, Cartera, Movimientos, Insights, Ajustes)
    api/               market · health · insights · parse
  components/
    charts/            Gráficos SVG propios, sin librería
    ui/                Primitivas: hoja inferior, campos, métricas
  lib/
    engine/            Ledger, valuación diaria, TWR, XIRR, riesgo
    market/            Proveedores de precios + simulador
    parse/             Parser de frases en castellano rioplatense
    db.ts              IndexedDB (Dexie), backup e importación
    store.tsx          Estado de la app y sincronización
```

## Diseño

Modo oscuro único, ángulos rectos en todo, tipografía neutra y números
monoespaciados. La referencia es una terminal de mercado, no una app de
finanzas con degradés.

La paleta de datos está **validada**: banda de luminosidad, piso de croma,
separación para daltonismo (protan/deutan/tritan) y contraste ≥ 3:1 contra la
superficie oscura. El orden de los colores es parte de la garantía, así que no
se cicla ni se reordena. Ninguna información depende del color solo: siempre hay
signo, etiqueta o ícono al lado.

## Comandos

```bash
npm run dev        # desarrollo
npm run build      # build de producción
npm test           # tests del motor y del parser
npm run typecheck  # TypeScript
npm run check      # typecheck + tests
node scripts/icons.mjs   # regenera los íconos de la PWA
```

## Límites conocidos

- Los datos viven en este navegador. Si borrás los datos del sitio o cambiás de
  teléfono, se pierden: **hacé backup desde Ajustes**.
- Las fuentes de precios son APIs públicas gratuitas y sin garantía de
  disponibilidad. Ajustes → Diagnóstico dice cuál está caída.
- El MEP histórico viene de una fuente pública; para operaciones viejas en pesos
  conviene cargar el dólar de esa operación a mano.
- El costo es promedio ponderado, no FIFO. Para impuestos puede no coincidir.
- Los insights son una lectura generada por un modelo a partir de búsquedas
  públicas. No es asesoramiento financiero.
