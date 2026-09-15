import { readFileSync } from "node:fs";
import { migrate } from "../src/server/db";
import { previewWorkbookImport } from "../src/server/repository";

migrate();

const preview = await previewWorkbookImport({
  movementDate: "2026-09-12",
  listType: "salida_porcionado",
  originalName: "salida_porcionado_1209.xlsx",
  buffer: readFileSync("C:/Users/Usuario/Desktop/contexto/salida_porcionado_1209.xlsx")
});

console.log({
  totalRows: preview.totalRows,
  reviewItems: preview.reviewItems.length,
  firstItems: preview.reviewItems.slice(0, 8)
});
