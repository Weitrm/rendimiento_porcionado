import { existsSync } from "node:fs";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import type { ListType } from "../shared/types";
import { getDailyBatches, getEffectiveRowsForMonth, getMovementDatesForMonth, type EffectiveRow } from "./repository";

const TEMPLATE_PATH = resolve("templates", "base-limpia.xlsx");
const DATE_START_COLUMN = 3;
const DIFFERENCE_TOLERANCE_KG = 100;

type WorkbookSection = {
  sheetName: "porcionados" | "logs";
  startRow: number;
  totalRow: number;
  dateColumns: Map<string, number>;
};

type AggregatedMovement = {
  listType: ListType;
  date: string;
  code: string;
  description: string;
  kg: number;
  physicalGroupName: string | null;
};

export async function buildExcelReport(date: string) {
  return buildMonthlyWorkbook(date.slice(0, 7));
}

export async function buildMonthlyWorkbook(month: string) {
  if (!existsSync(TEMPLATE_PATH)) {
    throw new Error("No existe templates/base-limpia.xlsx. Primero hay que generar la plantilla limpia.");
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);
  normalizeSharedFormulas(workbook);

  const dates = getMovementDatesForMonth(month);
  const rows = getEffectiveRowsForMonth(month).filter((row) => !row.isExcluded);
  const movements = aggregateMovements(rows);

  const porcionados = worksheetOrThrow(workbook, "porcionados");
  const logs = worksheetOrThrow(workbook, "logs");
  const porcionadoDates = prepareDateColumns(porcionados, dates);
  const logsDates = prepareDateColumns(logs, dates);

  const porcionadosEntrada = resolvePorcionadosEntrada(porcionados, porcionadoDates);
  writeMovements(porcionadosEntrada, movements.filter((row) => isPorcionadoInput(row.listType)));
  const porcionadosSalida = resolvePorcionadosSalida(porcionados, porcionadoDates);
  writeMovements(porcionadosSalida, movements.filter((row) => row.listType === "salida_porcionado"));

  const logsEntrada = resolveLogsEntrada(logs, logsDates);
  writeMovements(logsEntrada, movements.filter((row) => row.listType === "entrada_logs"));
  const logsSalida = resolveLogsSalida(logs, logsDates);
  writeMovements(logsSalida, movements.filter((row) => row.listType === "salida_logs"));

  writeLogsBatches(logs, logsDates, dates);
  refreshSectionFormulas(porcionadosEntrada);
  refreshSectionFormulas(porcionadosSalida);
  refreshSectionFormulas(logsEntrada);
  refreshSectionFormulas(logsSalida);
  refreshPorcionadoDifferenceRows(porcionados, porcionadoDates, dates);
  refreshLogsSummaryRows(logs, logsEntrada, logsSalida, logsDates);
  highlightPorcionadoDifferences(porcionados, porcionadosEntrada, porcionadosSalida, movements);

  workbook.calcProperties.fullCalcOnLoad = true;
  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

function aggregateMovements(rows: EffectiveRow[]): AggregatedMovement[] {
  const map = new Map<string, AggregatedMovement>();

  for (const row of rows) {
    const key = [row.listType, row.movementDate, row.code, row.description, row.physicalGroupName ?? ""].join("|");
    const current =
      map.get(key) ??
      ({
        listType: row.listType,
        date: row.movementDate,
        code: row.code,
        description: row.description,
        kg: 0,
        physicalGroupName: row.physicalGroupName
      } satisfies AggregatedMovement);

    current.kg += Math.abs(row.effectiveKg);
    map.set(key, current);
  }

  return Array.from(map.values()).map((row) => ({ ...row, kg: round(row.kg) }));
}

function prepareDateColumns(sheet: ExcelJS.Worksheet, dates: string[]) {
  let accumulatedColumn = findAccumulatedColumn(sheet);
  const currentCapacity = accumulatedColumn - DATE_START_COLUMN;

  if (dates.length > currentCapacity) {
    const extraColumns = dates.length - currentCapacity;
    sheet.spliceColumns(accumulatedColumn, 0, ...Array.from({ length: extraColumns }, () => []));
    for (let column = accumulatedColumn; column < accumulatedColumn + extraColumns; column += 1) {
      copyColumnFormat(sheet, DATE_START_COLUMN, column);
    }
    accumulatedColumn = findAccumulatedColumn(sheet);
  }

  for (let column = DATE_START_COLUMN; column < accumulatedColumn; column += 1) {
    const date = dates[column - DATE_START_COLUMN];
    sheet.getColumn(column).hidden = !date;
    sheet.getCell(2, column).value = date ? excelSerialDate(date) : null;
    sheet.getCell(3, column).value = date ? "kls." : null;
    sheet.getCell(2, column).numFmt = "dd/mm";

    for (let row = 4; row <= sheet.rowCount; row += 1) {
      sheet.getCell(row, column).value = null;
    }
  }

  return new Map(dates.map((date, index) => [date, DATE_START_COLUMN + index]));
}

function writeMovements(section: WorkbookSection, movements: AggregatedMovement[]) {
  for (const movement of movements) {
    const column = section.dateColumns.get(movement.date);
    if (!column) continue;

    const rowNumber = findOrInsertCode(section, movement.code, movement.description);
    const cell = worksheetOrThrowByName(section.sheetName).getCell(rowNumber, column);
    cell.value = round(Number(cell.value ?? 0) + movement.kg);
    cell.numFmt = "#,##0.00";
  }
}

function findOrInsertCode(section: WorkbookSection, code: string, description: string) {
  const sheet = worksheetOrThrowByName(section.sheetName);
  for (let row = section.startRow; row < section.totalRow; row += 1) {
    if (String(sheet.getCell(row, 1).value ?? "").trim() === code) return row;
  }

  const insertAt = findSortedInsertRow(sheet, section.startRow, section.totalRow, code);
  sheet.spliceRows(insertAt, 0, []);
  copyRowFormat(sheet, Math.max(section.startRow, insertAt - 1), insertAt);
  sheet.getCell(insertAt, 1).value = code;
  sheet.getCell(insertAt, 2).value = description;
  section.totalRow += 1;
  return insertAt;
}

function refreshSectionFormulas(section: WorkbookSection) {
  const sheet = worksheetOrThrowByName(section.sheetName);
  const accumulatedColumn = findAccumulatedColumn(sheet);
  const accumulatedLetter = sheet.getColumn(accumulatedColumn).letter;
  const lastDateColumn = Math.max(DATE_START_COLUMN, DATE_START_COLUMN + section.dateColumns.size - 1);
  const lastDateLetter = sheet.getColumn(lastDateColumn).letter;

  for (let row = section.startRow; row < section.totalRow; row += 1) {
    if (!sheet.getCell(row, 1).value) continue;
    sheet.getCell(row, accumulatedColumn).value = { formula: `SUM(C${row}:${lastDateLetter}${row})` };
  }

  for (const column of section.dateColumns.values()) {
    const letter = sheet.getColumn(column).letter;
    sheet.getCell(section.totalRow, column).value = {
      formula: `SUM(${letter}${section.startRow}:${letter}${section.totalRow - 1})`
    };
  }
  sheet.getCell(section.totalRow, accumulatedColumn).value = {
    formula: `SUM(${accumulatedLetter}${section.startRow}:${accumulatedLetter}${section.totalRow - 1})`
  };
}

function refreshPorcionadoDifferenceRows(sheet: ExcelJS.Worksheet, dateColumns: Map<string, number>, dates: string[]) {
  const inputTotalRow = findRowByLabel(sheet, "TOTAL", 4, findRowByLabel(sheet, "SALIDA", 1, sheet.rowCount));
  const outputTotalRow = findRowByLabel(sheet, "TOTAL", inputTotalRow + 1, sheet.rowCount);
  const differenceRow = findRowByLabel(sheet, "Diferencia entrada / salida", outputTotalRow + 1, sheet.rowCount);
  const yieldRow = findRowByLabel(sheet, "Rendimiento", differenceRow + 1, sheet.rowCount);
  const accumulatedColumn = findAccumulatedColumn(sheet);

  for (const column of dateColumns.values()) {
    const letter = sheet.getColumn(column).letter;
    sheet.getCell(differenceRow, column).value = { formula: `${letter}${inputTotalRow}-${letter}${outputTotalRow}` };
    sheet.getCell(yieldRow, column).value = { formula: `${letter}${outputTotalRow}/${letter}${inputTotalRow}` };
  }

  const accumulatedLetter = sheet.getColumn(accumulatedColumn).letter;
  sheet.getCell(differenceRow, accumulatedColumn).value = {
    formula: `${accumulatedLetter}${inputTotalRow}-${accumulatedLetter}${outputTotalRow}`
  };
  sheet.getCell(yieldRow, accumulatedColumn).value = {
    formula: `${accumulatedLetter}${outputTotalRow}/${accumulatedLetter}${inputTotalRow}`
  };

  for (let index = dates.length; index < accumulatedColumn - DATE_START_COLUMN; index += 1) {
    const column = DATE_START_COLUMN + index;
    sheet.getCell(differenceRow, column).value = null;
    sheet.getCell(yieldRow, column).value = null;
  }
}

function refreshLogsSummaryRows(
  sheet: ExcelJS.Worksheet,
  inputSection: WorkbookSection,
  outputSection: WorkbookSection,
  dateColumns: Map<string, number>
) {
  const yieldRow = findRowByLabel(sheet, "Rendimiento", outputSection.totalRow + 1, sheet.rowCount);
  const accumulatedColumn = findAccumulatedColumn(sheet);

  for (const column of dateColumns.values()) {
    const letter = sheet.getColumn(column).letter;
    sheet.getCell(yieldRow, column).value = {
      formula: `(${letter}${outputSection.totalRow}/${letter}${inputSection.totalRow})-1`
    };
  }

  const accumulatedLetter = sheet.getColumn(accumulatedColumn).letter;
  sheet.getCell(yieldRow, accumulatedColumn).value = {
    formula: `(${accumulatedLetter}${outputSection.totalRow}/${accumulatedLetter}${inputSection.totalRow})-1`
  };
}

function highlightPorcionadoDifferences(
  sheet: ExcelJS.Worksheet,
  inputSection: WorkbookSection,
  outputSection: WorkbookSection,
  movements: AggregatedMovement[]
) {
  const groupBalance = new Map<string, { input: number; output: number }>();

  for (const movement of movements) {
    if (!["entrada_desosado", "entrada_porcionado", "salida_porcionado"].includes(movement.listType)) continue;
    const group = movement.physicalGroupName ?? inferGroupFromDescription(movement.description);
    const current = groupBalance.get(group) ?? { input: 0, output: 0 };
    if (isPorcionadoInput(movement.listType)) current.input += movement.kg;
    else current.output += movement.kg;
    groupBalance.set(group, current);
  }

  const groupsOverTolerance = new Set(
    Array.from(groupBalance.entries())
      .filter(([, value]) => Math.abs(value.input - value.output) > DIFFERENCE_TOLERANCE_KG)
      .map(([group]) => group)
  );

  for (const movement of movements) {
    const group = movement.physicalGroupName ?? inferGroupFromDescription(movement.description);
    if (!groupsOverTolerance.has(group)) continue;
    const section = isPorcionadoInput(movement.listType) ? inputSection : outputSection;
    if (movement.listType === "entrada_logs" || movement.listType === "salida_logs") continue;
    const row = findCodeRow(sheet, section.startRow, section.totalRow, movement.code);
    if (row) {
      sheet.getCell(row, 1).fill = warningFill();
      sheet.getCell(row, 2).fill = warningFill();
    }
  }
}

function writeLogsBatches(sheet: ExcelJS.Worksheet, dateColumns: Map<string, number>, dates: string[]) {
  const phillyRow = findRowByLabel(sheet, "Canchadas Philly's Best", 1, sheet.rowCount);
  const commonRow = findRowByLabel(sheet, "Canchadas Comun", 1, sheet.rowCount);
  const accumulatedColumn = findAccumulatedColumn(sheet);
  const lastDateColumn = Math.max(DATE_START_COLUMN, DATE_START_COLUMN + dates.length - 1);
  const lastDateLetter = sheet.getColumn(lastDateColumn).letter;

  for (const date of dates) {
    const column = dateColumns.get(date);
    if (!column) continue;
    const batches = getDailyBatches(date);
    sheet.getCell(commonRow, column).value = batches.commonCount || null;
    sheet.getCell(phillyRow, column).value = batches.phillyCount || null;
  }

  sheet.getCell(commonRow, accumulatedColumn).value = { formula: `SUM(C${commonRow}:${lastDateLetter}${commonRow})` };
  sheet.getCell(phillyRow, accumulatedColumn).value = { formula: `SUM(C${phillyRow}:${lastDateLetter}${phillyRow})` };
}

function resolvePorcionadosEntrada(sheet: ExcelJS.Worksheet, dateColumns: Map<string, number>): WorkbookSection {
  const salidaRow = findRowByLabel(sheet, "SALIDA", 1, sheet.rowCount);
  return {
    sheetName: "porcionados",
    startRow: 4,
    totalRow: findRowByLabel(sheet, "TOTAL", 4, salidaRow),
    dateColumns
  };
}

function resolvePorcionadosSalida(sheet: ExcelJS.Worksheet, dateColumns: Map<string, number>): WorkbookSection {
  const salidaRow = findRowByLabel(sheet, "SALIDA", 1, sheet.rowCount);
  return {
    sheetName: "porcionados",
    startRow: salidaRow + 1,
    totalRow: findRowByLabel(sheet, "TOTAL", salidaRow + 1, sheet.rowCount),
    dateColumns
  };
}

function resolveLogsEntrada(sheet: ExcelJS.Worksheet, dateColumns: Map<string, number>): WorkbookSection {
  const salidaRow = findRowByLabel(sheet, "Salida Producto Final", 1, sheet.rowCount);
  return {
    sheetName: "logs",
    startRow: 4,
    totalRow: findRowByLabel(sheet, "Total", 4, salidaRow),
    dateColumns
  };
}

function resolveLogsSalida(sheet: ExcelJS.Worksheet, dateColumns: Map<string, number>): WorkbookSection {
  const salidaRow = findRowByLabel(sheet, "Salida Producto Final", 1, sheet.rowCount);
  return {
    sheetName: "logs",
    startRow: salidaRow + 2,
    totalRow: findRowByLabel(sheet, "Total", salidaRow + 2, sheet.rowCount),
    dateColumns
  };
}

let currentWorkbook: ExcelJS.Workbook | null = null;

function worksheetOrThrow(workbook: ExcelJS.Workbook, name: "porcionados" | "logs") {
  currentWorkbook = workbook;
  const sheet = workbook.getWorksheet(name);
  if (!sheet) throw new Error(`No existe la hoja ${name} en la plantilla.`);
  return sheet;
}

function worksheetOrThrowByName(name: "porcionados" | "logs") {
  const sheet = currentWorkbook?.getWorksheet(name);
  if (!sheet) throw new Error(`No existe la hoja ${name} en la plantilla.`);
  return sheet;
}

function findAccumulatedColumn(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(2);
  for (let column = 1; column <= row.cellCount + 40; column += 1) {
    const value = normalize(String(row.getCell(column).value ?? ""));
    if (value === "acumulado") return column;
  }
  throw new Error(`No se encontro la columna ACUMULADO en ${sheet.name}`);
}

function findRowByLabel(sheet: ExcelJS.Worksheet, label: string, startRow: number, endRow: number) {
  const wanted = normalize(label);
  for (let row = startRow; row <= endRow; row += 1) {
    if (normalize(String(sheet.getCell(row, 2).value ?? "")) === wanted) return row;
  }
  throw new Error(`No se encontro "${label}" en ${sheet.name}`);
}

function findCodeRow(sheet: ExcelJS.Worksheet, startRow: number, totalRow: number, code: string) {
  for (let row = startRow; row < totalRow; row += 1) {
    if (String(sheet.getCell(row, 1).value ?? "").trim() === code) return row;
  }
  return null;
}

function findSortedInsertRow(sheet: ExcelJS.Worksheet, startRow: number, totalRow: number, code: string) {
  const target = codeSortValue(code);
  for (let row = startRow; row < totalRow; row += 1) {
    const currentCode = String(sheet.getCell(row, 1).value ?? "").trim();
    if (!currentCode) continue;
    if (codeSortValue(currentCode) > target) return row;
  }
  return totalRow;
}

function codeSortValue(code: string) {
  const normalized = code.trim();
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && normalized !== "" ? numeric : Number.MAX_SAFE_INTEGER;
}

function copyColumnFormat(sheet: ExcelJS.Worksheet, sourceColumn: number, targetColumn: number) {
  sheet.getColumn(targetColumn).width = sheet.getColumn(sourceColumn).width;
  for (let row = 1; row <= sheet.rowCount; row += 1) {
    sheet.getCell(row, targetColumn).style = cloneStyle(sheet.getCell(row, sourceColumn).style);
  }
}

function copyRowFormat(sheet: ExcelJS.Worksheet, sourceRow: number, targetRow: number) {
  sheet.getRow(targetRow).height = sheet.getRow(sourceRow).height;
  for (let column = 1; column <= Math.max(sheet.columnCount, 35); column += 1) {
    sheet.getCell(targetRow, column).style = cloneStyle(sheet.getCell(sourceRow, column).style);
    if (column >= DATE_START_COLUMN && column < findAccumulatedColumn(sheet)) {
      sheet.getCell(targetRow, column).value = null;
    }
  }
}

function cloneStyle(style: Partial<ExcelJS.Style>) {
  return JSON.parse(JSON.stringify(style ?? {})) as Partial<ExcelJS.Style>;
}

function isPorcionadoInput(listType: ListType) {
  return listType === "entrada_desosado" || listType === "entrada_porcionado";
}

function excelSerialDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day);
  return Math.round(utc / 86400000 + 25569);
}

function inferGroupFromDescription(description: string) {
  const value = normalize(description);
  if (value.includes("asado")) return "Asado";
  if (value.includes("entrana")) return "Entraña";
  if (value.includes("falda")) return "Falda";
  if (value.includes("lomo")) return "Lomo";
  if (value.includes("matambre")) return "Matambre";
  if (value.includes("bife ancho")) return "Bife ancho";
  if (value.includes("bife angosto")) return "Bife angosto";
  if (value.includes("tapa de nalga")) return "Tapa de nalga";
  return "Sin clasificar";
}

function warningFill(): ExcelJS.Fill {
  return {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFE4B5" }
  };
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeSharedFormulas(workbook: ExcelJS.Workbook) {
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        const value = cell.value;
        if (value && typeof value === "object" && "sharedFormula" in value) {
          const formula = (value as { formula?: string }).formula;
          const result = (value as { result?: unknown }).result;
          cell.value = (formula ? { formula, result } : result ?? null) as ExcelJS.CellValue;
        }
      });
    });
  });
}
