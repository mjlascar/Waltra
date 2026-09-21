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
    // "1,5" es decimal; "1,234" con exactamente 3 digitos es miles.
    // "0,001" siempre es decimal: nadie escribe cero como grupo de miles.
    if (
      parts.length === 2 &&
      parts[1].length === 3 &&
      parts[0].length <= 3 &&
      parts[0].length > 0 &&
      parts[0] !== "0"
    ) {
      s = s.replace(",", "");
    } else {
      s = s.replace(/,/g, ".");
    }
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
