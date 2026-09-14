import type { ListType, LogsStage } from "../../shared/types";

export const listLabels: Record<ListType, string> = {
  entrada_desosado: "Entrada Desosado",
  entrada_porcionado: "Entrada Porcionado",
  salida_porcionado: "Salida Porcionado",
  entrada_logs: "Entrada Logs",
  salida_logs: "Salida Logs"
};

export const stageLabels: Record<LogsStage, string> = {
  elaboracion: "Elaboración",
  desmolde: "Desmolde y envasado",
  sin_clasificar: "Sin clasificar"
};

export function formatKg(value: number) {
  return new Intl.NumberFormat("es-UY", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value);
}

export function formatPercent(value: number | null) {
  if (value === null) return "Sin entrada";
  return `${new Intl.NumberFormat("es-UY", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value)}%`;
}
