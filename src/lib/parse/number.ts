/**
 * Parseo de numeros escritos como los escribe una persona en Argentina:
 * "1.234,56", "1234.56", "1,5", "2k". Devuelve null si no es un numero.
 */
export function parseLooseNumber(raw: string): number | null {
  let s = raw.trim().replace(/\s+/g, "").replace(/^(usd|u\$s|us\$|ars|\$)/i, "");
  if (!s) return null;

  let multiplier = 1;
  const suffix = s.match(/([kKmM])$/);
  if (suffix) {
    multiplier = suffix[1].toLowerCase() === "k" ? 1_000 : 1_000_000;
    s = s.slice(0, -1);
  }

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    // El separador decimal es el que aparece ultimo.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    const parts = s.split(",");
    // Una coma sola es siempre la coma decimal, como se escribe en
    // Argentina: "108,625" son ciento ocho con algo. Antes, con tres digitos
    // despues se leia como miles y una compra de 108,625 pasaba a 108.625.
    // Solo varias comas son grupos de miles a la inglesa: "1,234,567".
    if (parts.length > 2) s = s.replace(/,/g, "");
    else s = s.replace(",", ".");
  } else if (hasDot) {
    const parts = s.split(".");
    // "1.234" o "1.234.567" son miles; "1.5" y "0.001" son decimales.
    if (
      parts.length > 2 ||
      (parts.length === 2 &&
        parts[1].length === 3 &&
        parts[0].length <= 3 &&
        parts[0] !== "0")
    ) {
      s = s.replace(/\./g, "");
    }
  }

  const n = Number(s);
  return Number.isFinite(n) ? n * multiplier : null;
}

export function formatQuantity(value: number, precision = 6): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Number(value.toFixed(precision));
  return String(rounded);
}

/**
 * Un numero listo para un campo que despues se vuelve a leer con
 * `parseLooseNumber`: coma decimal, sin separador de miles y sin notacion
 * cientifica. `String(108.625)` da "108.625", que al guardar se leia como
 * ciento ocho mil: asi una compra cambiaba de monto con solo abrirla para
 * editar y guardarla.
 */
export function editableNumber(value: number | null | undefined, maxDecimals = 10): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return value
    .toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: maxDecimals })
    .replace(".", ",");
}
