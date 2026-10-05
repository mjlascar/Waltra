"use client";

import { money } from "@/lib/format";
import { useTween } from "@/lib/use-tween";
import type { Currency } from "@/lib/types";

/** Un monto que corre hasta su valor nuevo. Ver `useTween`. */
export function TweenMoney({
  value,
  currency,
  sign,
}: {
  value: number;
  currency: Currency;
  sign?: boolean;
}) {
  const shown = useTween(value);
  return <>{money(shown, currency, { sign })}</>;
}
