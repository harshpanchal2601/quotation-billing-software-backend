/** An inclusive pair of calendar dates represented as a half-open UTC interval. */
export function dateWindow(dateFrom: string, dateTo: string) {
  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const through = new Date(`${dateTo}T00:00:00.000Z`);
  return { from, through, until: new Date(through.getTime() + 86_400_000) };
}

export type DateWindow = ReturnType<typeof dateWindow>;
