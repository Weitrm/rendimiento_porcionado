import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ExcelJS from "exceljs";

const sourcePath = "C:/Users/Usuario/Desktop/contexto/Elaborados - Setiembre 2026 Porcionado General.xlsx";
const outputPath = resolve("templates", "base-limpia.xlsx");
const sheetsToClean = ["porcionados", "logs"];

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(sourcePath);
expandSharedFormulas(workbook);

for (const sheetName of sheetsToClean) {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error(`No se encontro la hoja ${sheetName}`);

  const dateStartColumn = 3;
  const accumulatedColumn = findAccumulatedColumn(sheet);

  for (let column = dateStartColumn; column < accumulatedColumn; column += 1) {
    sheet.getColumn(column).hidden = true;
    sheet.getCell(2, column).value = null;
    sheet.getCell(3, column).value = null;

    for (let row = 4; row <= sheet.rowCount; row += 1) {
      sheet.getCell(row, column).value = null;
    }
  }
}

mkdirSync(dirname(outputPath), { recursive: true });
await workbook.xlsx.writeFile(outputPath);
console.log(outputPath);

function findAccumulatedColumn(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(2);
  for (let column = 1; column <= row.cellCount + 20; column += 1) {
    const value = String(row.getCell(column).value ?? "").trim().toLocaleLowerCase("es");
    if (value === "acumulado") return column;
  }
  throw new Error(`No se encontro la columna ACUMULADO en ${sheet.name}`);
}

function expandSharedFormulas(workbook: ExcelJS.Workbook) {
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        const value = cell.value;
        if (value && typeof value === "object" && "sharedFormula" in value && "result" in value) {
          const formula = (value as { formula?: string; result?: unknown }).formula;
          cell.value = formula ? { formula, result: (value as { result?: unknown }).result } : (value as { result?: unknown }).result ?? null;
        }
      });
    });
  });
}
