import { readFileSync } from "node:fs";
import { migrate } from "../src/server/db";
import { buildExcelReport } from "../src/server/exporter";
import { getDashboard, importWorkbook, setDailyBatches } from "../src/server/repository";
import type { ListType } from "../src/shared/types";

const date = process.env.SMOKE_DATE ?? "2026-09-12";
const base = "C:/Users/Usuario/Desktop/contexto";
const files: Array<[ListType, string]> = [
  ["entrada_desosado", "entrada_desosado_1209.xlsx"],
  ["entrada_porcionado", "entrada_porcionado_1209.xlsx"],
  ["salida_porcionado", "salida_porcionado_1209.xlsx"],
  ["entrada_logs", "entrada_logs_1209.xlsx"],
  ["salida_logs", "salida_logs_1209.xlsx"]
];

migrate();

console.log("Primera importacion");
for (const [listType, name] of files) {
  const result = await importWorkbook({
    listType,
    movementDate: date,
    originalName: name,
    buffer: readFileSync(`${base}/${name}`)
  });
  console.log(listType, result);
}

console.log("Segunda importacion");
for (const [listType, name] of files) {
  const result = await importWorkbook({
    listType,
    movementDate: date,
    originalName: name,
    buffer: readFileSync(`${base}/${name}`)
  });
  console.log(listType, result);
}

setDailyBatches(date, 70, 0);

const dashboard = getDashboard(date);
console.log("Porcionado", dashboard.porcionado.slice(0, 5));
console.log("Logs", dashboard.logs);
console.log("Pendientes", dashboard.unknownProducts.length);
console.log("Excel bytes", (await buildExcelReport(date)).length);
