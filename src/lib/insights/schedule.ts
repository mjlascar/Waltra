import type { Settings } from "@/lib/types";

/**
 * Informes que se generan solos, cada tanto.
 *
 * La app no tiene servidor, asi que nadie puede generar un informe mientras
 * el telefono duerme: lo que se agenda es el *recordatorio*. A la hora
 * elegida el vigia manda una notificacion y, al abrir la app, el informe
 * aparece esperando con un boton para generarlo.
 *
 * Se hace asi y no automaticamente a proposito: cada informe gasta creditos
 * de la cuenta del usuario, y gastarlos sin que este mirando es la clase de
 * cosa que se descubre a fin de mes.
 */
export type ReportKind =
  | "cartera"
  | "mercado"
  | "conducta"
  | "riesgo"
  | "posicion"
  | "decision";

export interface Schedule {
  kind: ReportKind;
  enabled: boolean;
  /** 1 = lunes … 7 = domingo, como en ISO. */
  weekday: number;
  /** Hora local, 0-23. */
  hour: number;
  /** Cuando se genero por ultima vez, en ISO. */
  lastRun?: string;
}

export const KIND_LABEL: Record<ReportKind, string> = {
  cartera: "Análisis de tu cartera",
  mercado: "Resumen de mercado",
  conducta: "Cómo invertís de verdad",
  riesgo: "Qué te puede doler",
  posicion: "Una posición a fondo",
  decision: "Tengo plata, ¿qué hago?",
};

export const KIND_DETAIL: Record<ReportKind, string> = {
  cartera: "Qué pasó con tus posiciones y qué hacer con cada una.",
  mercado: "Cómo viene el mercado para lo que tenés, y qué más podría interesarte.",
  conducta: "Tu operatoria real contra el perfil que declarás. Sale del historial, no de una encuesta.",
  riesgo: "Concentración, moneda y cuánto dolería una caída como las que ya pasaron.",
  posicion: "Un activo solo: la tesis, qué cambió y qué la rompería.",
  decision: "Un monto concreto y qué conviene hacer con él, dada tu cartera de hoy.",
};

/**
 * Las que valen la pena agendar.
 *
 * Las otras cuatro son de consulta: uno las pide cuando tiene la pregunta.
 * Agendar "tengo plata, que hago" cada lunes no tiene sentido.
 */
export const AGENDABLES: ReportKind[] = ["mercado", "cartera", "riesgo"];

/** Las que necesitan que el usuario diga sobre que. */
export function needsFocus(kind: ReportKind): boolean {
  return kind === "posicion" || kind === "decision";
}

/**
 * Lo que la app propone cuando todavia no hay nada agendado.
 *
 * El lunes a la manana no es casual: es cuando sirve leer que paso la semana
 * anterior y que se viene, antes de que el mercado abra.
 */
export const SUGERENCIAS: Schedule[] = [
  { kind: "mercado", enabled: false, weekday: 1, hour: 9 },
  { kind: "cartera", enabled: false, weekday: 5, hour: 18 },
  { kind: "riesgo", enabled: false, weekday: 6, hour: 11 },
];

export function schedules(settings: Settings): Schedule[] {
  const guardados = settings.schedules ?? [];
  // Las sugerencias definen el orden y aseguran que siempre esten las dos,
  // aunque en los ajustes guardados falte alguna.
  return SUGERENCIAS.map(
    (base) => guardados.find((s) => s.kind === base.kind) ?? base,
  );
}

/** Dia de la semana en ISO (1 = lunes … 7 = domingo) del reloj local. */
function isoWeekday(date: Date): number {
  const dow = date.getDay();
  return dow === 0 ? 7 : dow;
}

/**
 * La ultima vez que le tocaba correr, en o antes de `now`.
 *
 * Se camina para atras dia por dia en vez de hacer aritmetica de fechas: son
 * como mucho siete pasos y asi el horario de verano, si algun dia existiera,
 * no puede correr el resultado un dia entero.
 */
export function lastOccurrence(schedule: Schedule, now: Date): Date {
  const candidato = new Date(now);
  candidato.setHours(schedule.hour, 0, 0, 0);
  for (let i = 0; i < 8; i++) {
    if (isoWeekday(candidato) === schedule.weekday && candidato <= now) return candidato;
    candidato.setDate(candidato.getDate() - 1);
    candidato.setHours(schedule.hour, 0, 0, 0);
  }
  return candidato;
}

/** Si toca generarlo: ya paso la hora y no se genero desde entonces. */
export function isDue(schedule: Schedule, now: Date): boolean {
  if (!schedule.enabled) return false;
  const toco = lastOccurrence(schedule, now);
  if (now < toco) return false;
  if (!schedule.lastRun) return true;
  const ultimo = Date.parse(schedule.lastRun);
  return Number.isFinite(ultimo) ? ultimo < toco.getTime() : true;
}

const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

export function describeSchedule(schedule: Schedule): string {
  const dia = DIAS[schedule.weekday - 1] ?? "lunes";
  const hora = `${String(schedule.hour).padStart(2, "0")}:00`;
  return `Todos los ${dia} a las ${hora}`;
}

export const DIA_OPCIONES = DIAS.map((label, i) => ({ value: String(i + 1), label }));
