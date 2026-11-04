import { CalendarEdit, LineCalendar, RamoDataset } from '@ramo/domain';

/** Las 7 fechas (lunes a domingo) de la semana que empieza en weekStart. */
export function weekDays(weekStart: string): string[] {
  const start = new Date(`${weekStart}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/** 1 = lunes … 7 = domingo */
function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Horas disponibles de una línea en una semana: horas base de los días hábiles, reemplazadas por las excepciones. */
export function lineAvailableHours(cal: LineCalendar, weekStart: string): number {
  let total = 0;
  for (const date of weekDays(weekStart)) {
    const exception = cal.exceptions.find((e) => e.date === date);
    if (exception) total += exception.hours;
    else if (cal.workingWeekdays.includes(isoWeekday(date))) total += cal.baseHoursPerDay;
  }
  return total;
}

/** Excepciones de calendario que caen dentro de la semana (para explicar por qué baja la capacidad). */
export function weekExceptions(cal: LineCalendar, weekStart: string) {
  const days = new Set(weekDays(weekStart));
  return cal.exceptions.filter((e) => days.has(e.date));
}

/** Horas disponibles de una línea un día concreto (la excepción manda sobre el calendario base). */
export function dayHours(cal: LineCalendar, date: string): number {
  const exception = cal.exceptions.find((e) => e.date === date);
  if (exception) return exception.hours;
  return cal.workingWeekdays.includes(isoWeekday(date)) ? cal.baseHoursPerDay : 0;
}

/**
 * Conjunto de datos con los cambios de calendario hechos en la aplicación (festivos, paradas, mantenimientos, cierres y turnos extendidos).
 * Un cambio reemplaza la excepción que ya hubiera ese día en esa línea; el más reciente gana entre dos del mismo día.
 */
export function applyCalendarEdits(ds: RamoDataset, edits: CalendarEdit[]): RamoDataset {
  if (edits.length === 0) return ds;
  const ordered = [...edits].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    ...ds,
    calendars: ds.calendars.map((cal) => {
      const mine = ordered.filter((e) => e.lineIds.includes(cal.lineId));
      if (mine.length === 0) return cal;
      const byDate = new Map(cal.exceptions.map((x) => [x.date, x]));
      for (const e of mine) byDate.set(e.date, { date: e.date, hours: e.hours, reason: e.reason, note: e.note || undefined });
      return { ...cal, exceptions: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
    }),
  };
}
