import ExcelJS from "exceljs";
import { LIST_LABELS } from "./constants";
import { getDashboard, getEffectiveRows } from "./repository";

export async function buildExcelReport(date: string) {
  const dashboard = getDashboard(date);
  const rows = getEffectiveRows(date);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Rendimientos";
  workbook.created = new Date();

  const summary = [
    ["Fecha", date],
    ["Canchadas comunes", dashboard.batches.commonCount],
    ["Canchadas Philly's Best", dashboard.batches.phillyCount],
    ["Receta incorporada (kg)", dashboard.batches.recipeKg],
    [],
    ["Porcionado"],
    ["Grupo físico", "Kilos entrados", "Kilos salidos", "Diferencia", "Rendimiento %", "Códigos pendientes"],
    ...dashboard.porcionado.map((row) => [
      row.groupName,
      row.inputKg,
      row.outputKg,
      row.differenceKg,
      row.yieldPercent === null ? "" : row.yieldPercent / 100,
      row.unknownCodes
    ]),
    [],
    ["Logs"],
    ["Etapa", "Kilos carne", "Receta kg", "Kilos salidos", "Diferencia", "Filas"],
    ...dashboard.logs.map((row) => [
      stageLabel(row.stage),
      row.inputKg,
      row.recipeKg,
      row.outputKg,
      row.differenceKg,
      row.rowCount
    ])
  ];

  const summarySheet = workbook.addWorksheet("Resumen");
  summarySheet.addRows(summary);
  summarySheet.columns = [{ width: 26 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 18 }];
  summarySheet.getRow(6).font = { bold: true };
  summarySheet.getRow(7).font = { bold: true };
  summarySheet.getRow(7).fill = headerFill();
  const logsHeaderRow = 10 + dashboard.porcionado.length;
  summarySheet.getRow(logsHeaderRow - 1).font = { bold: true };
  summarySheet.getRow(logsHeaderRow).font = { bold: true };
  summarySheet.getRow(logsHeaderRow).fill = headerFill();

  const detail = rows.map((row) => ({
    Fecha: row.movementDate,
    Lista: LIST_LABELS[row.listType],
    Codigo: row.code,
    Descripcion: row.description,
    "Kg original": row.netKg,
    "Kg efectivo": row.effectiveKg,
    Grupo: row.physicalGroupName ?? "Sin clasificar",
    "Etapa Logs": stageLabel(row.logsStage),
    Ajustado: row.isAdjusted ? "Si" : "No",
    Excluido: row.isExcluded ? "Si" : "No"
  }));
  const detailSheet = workbook.addWorksheet("Detalle");
  if (detail.length) {
    detailSheet.columns = Object.keys(detail[0]).map((key) => ({ header: key, key, width: key === "Descripcion" ? 42 : 16 }));
    detailSheet.addRows(detail);
    detailSheet.getRow(1).font = { bold: true };
    detailSheet.getRow(1).fill = headerFill();
  }

  const pending = dashboard.unknownProducts.map((product) => ({
    Codigo: product.code,
    Descripcion: product.description,
    Area: product.area ?? "",
    Grupo: product.physicalGroupName ?? "",
    "Etapa Logs": stageLabel(product.logsStage),
    Confirmado: product.isConfirmed ? "Si" : "No"
  }));
  const pendingSheet = workbook.addWorksheet("Pendientes");
  pendingSheet.columns = [
    { header: "Codigo", key: "Codigo", width: 14 },
    { header: "Descripcion", key: "Descripcion", width: 44 },
    { header: "Area", key: "Area", width: 14 },
    { header: "Grupo", key: "Grupo", width: 24 },
    { header: "Etapa Logs", key: "Etapa Logs", width: 22 },
    { header: "Confirmado", key: "Confirmado", width: 14 }
  ];
  pendingSheet.addRows(pending);
  pendingSheet.getRow(1).font = { bold: true };
  pendingSheet.getRow(1).fill = headerFill();

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

function stageLabel(stage: string) {
  if (stage === "elaboracion") return "Elaboración";
  if (stage === "desmolde") return "Desmolde y envasado";
  return "Sin clasificar";
}

function headerFill(): ExcelJS.Fill {
  return {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2EADF" }
  };
}
