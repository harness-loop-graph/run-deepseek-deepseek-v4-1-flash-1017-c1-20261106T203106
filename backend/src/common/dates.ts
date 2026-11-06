const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return parsed.toISOString().slice(0, 10) === value;
}

export function startOfDayUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function endOfDayUtc(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDaysUtc(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

export function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  return {
    from: toDateOnly(start),
    to: toDateOnly(addDaysUtc(start, 13)),
  };
}
