import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type { ImportedFile, ParsedRow } from "./types";

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const maybe = value as { text?: unknown; result?: unknown; formula?: unknown; richText?: Array<{ text: string }> };
    if (maybe.text !== undefined) return asText(maybe.text);
    if (maybe.result !== undefined) return asText(maybe.result);
    if (maybe.richText) return maybe.richText.map((item) => item.text).join("").trim();
    if (maybe.formula !== undefined) return `=${String(maybe.formula)}`;
  }
  return String(value).trim().replace(/\s+/g, " ");
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function findHeaderRow(rows: unknown[][]) {
  const index = rows.findIndex((row) => {
    const cells = row.map(asText);
    return cells.includes("Descripción") && (cells.includes("Código") || cells.includes("Producto"));
  });

  if (index < 0) {
    throw new Error("No se encontró una fila de encabezados con Código/Producto y Descripción.");
  }

  return index;
}

export async function parseWorkbook(buffer: Buffer): Promise<ParsedRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const firstSheet = workbook.worksheets[0];
  if (!firstSheet) throw new Error("El archivo Excel no contiene hojas.");

  const rows: unknown[][] = [];
  firstSheet.eachRow({ includeEmpty: false }, (row) => {
    const values: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      values[columnNumber - 1] = cell.value;
    });
    rows.push(values);
  });

  const headerIndex = findHeaderRow(rows);
  const headers = rows[headerIndex].map(asText);
  const codeColumn = headers.includes("Código") ? "Código" : "Producto";
  const kgColumn = headers.includes("Neto") ? "Neto" : "Kgs Neto";

  return rows
    .slice(headerIndex + 1)
    .map((row, offset) => {
      const raw: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        if (header) raw[header] = row[index] ?? "";
      });

      const code = asText(raw[codeColumn]);
      const description = asText(raw["Descripción"]);
      const netKg = asNumber(raw[kgColumn]);

      if (!code || !description || netKg === null) return null;

      return {
        rowIndex: headerIndex + offset + 2,
        code,
        description,
        packages: asNumber(raw["Bultos"]),
        units: asNumber(raw["Unidades"]),
        netKg,
        sourceProdDate: raw["Fecha Prod"] === undefined ? null : asText(raw["Fecha Prod"]),
        sourceSlaughterDate: raw["Fecha Faena"] === undefined ? null : asText(raw["Fecha Faena"]),
        raw
      };
    })
    .filter((row): row is ParsedRow => row !== null);
}

export function hashFile(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function hashRow(file: ImportedFile, row: ParsedRow) {
  const stable = {
    movementDate: file.movementDate,
    listType: file.listType,
    code: row.code,
    description: row.description,
    packages: row.packages,
    units: row.units,
    netKg: row.netKg,
    sourceProdDate: row.sourceProdDate,
    sourceSlaughterDate: row.sourceSlaughterDate,
    rowIndex: row.rowIndex
  };

  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function inferCatalogDefaults(description: string, listType: string) {
  const normalized = description.toLocaleLowerCase("es");
  const isSharedByproduct =
    normalized.includes("grasa") ||
    normalized.includes("hueso") ||
    normalized.includes("decomiso") ||
    normalized.includes("trimming");

  const area = listType.includes("logs")
    ? "logs"
    : isSharedByproduct
      ? "compartido"
      : "porcionado";

  let logsStage = "sin_clasificar";
  if (listType.includes("logs")) {
    if (normalized.includes("sin envasar")) logsStage = "elaboracion";
    if (normalized.includes("sobrante") || normalized.includes("lean") || normalized.includes("phillys best")) {
      logsStage = normalized.includes("sin envasar") ? "elaboracion" : "desmolde";
    }
  }

  return { area, logsStage, isSharedByproduct };
}
