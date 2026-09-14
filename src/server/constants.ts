import type { ListType } from "../shared/types";

export const LIST_LABELS: Record<ListType, string> = {
  entrada_desosado: "Entrada Desosado",
  entrada_porcionado: "Entrada Porcionado",
  salida_porcionado: "Salida Porcionado",
  entrada_logs: "Entrada Logs",
  salida_logs: "Salida Logs"
};

export const ENTRY_LISTS = new Set<ListType>([
  "entrada_desosado",
  "entrada_porcionado",
  "entrada_logs"
]);

export const OUTPUT_LISTS = new Set<ListType>([
  "salida_porcionado",
  "salida_logs"
]);

export const LOGS_RECIPE = {
  common: {
    waterLiters: 60.25,
    spicesKg: 6.75
  },
  philly: {
    waterLiters: 112.12,
    spicesKg: 7.94
  },
  waterKgPerLiter: 1
};
