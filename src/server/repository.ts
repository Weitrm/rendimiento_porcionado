import type {
  BalanceRow,
  DailyBatches,
  DashboardData,
  ListType,
  LogsBalance,
  ProductCatalogItem
} from "../shared/types";
import { ENTRY_LISTS, LOGS_RECIPE } from "./constants";
import { db } from "./db";
import { hashFile, hashRow, inferCatalogDefaults, parseWorkbook } from "./importer";
import type { AdjustmentLineInput, ImportedFile } from "./types";

type EffectiveRow = {
  id: number;
  movementDate: string;
  listType: ListType;
  code: string;
  description: string;
  packages: number | null;
  units: number | null;
  netKg: number;
  effectiveKg: number;
  isAdjusted: number;
  isExcluded: number;
  physicalGroupId: number | null;
  physicalGroupName: string | null;
  area: "porcionado" | "logs" | "compartido" | null;
  logsStage: "elaboracion" | "desmolde" | "sin_clasificar";
};

export async function importWorkbook(file: ImportedFile) {
  const parsedRows = await parseWorkbook(file.buffer);
  const sourceHash = hashFile(file.buffer);
  const totalKg = parsedRows.reduce((sum, row) => sum + row.netKg, 0);

  const importInfo = db
    .prepare(
      `INSERT INTO imports
        (movement_date, list_type, source_file_name, source_hash, row_count, inserted_count, skipped_count, total_kg)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?)`
    )
    .run(file.movementDate, file.listType, file.originalName, sourceHash, parsedRows.length, totalKg);

  const importId = Number(importInfo.lastInsertRowid);
  const insertRaw = db.prepare(`
    INSERT OR IGNORE INTO raw_movements
      (import_id, movement_date, list_type, row_index, code, description, packages, units, net_kg,
       source_prod_date, source_slaughter_date, row_hash, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let insertedRows = 0;
  let skippedRows = 0;

  db.exec("BEGIN");
  try {
    for (const row of parsedRows) {
      ensureCatalog(row.code, row.description, file.listType);
      const result = insertRaw.run(
        importId,
        file.movementDate,
        file.listType,
        row.rowIndex,
        row.code,
        row.description,
        row.packages,
        row.units,
        row.netKg,
        row.sourceProdDate,
        row.sourceSlaughterDate,
        hashRow(file, row),
        JSON.stringify(row.raw)
      );

      if (result.changes) insertedRows += 1;
      else skippedRows += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  db.prepare("UPDATE imports SET inserted_count = ?, skipped_count = ? WHERE id = ?").run(
    insertedRows,
    skippedRows,
    importId
  );

  return {
    importId,
    insertedRows,
    skippedRows,
    totalRows: parsedRows.length,
    totalKg
  };
}

export function ensureCatalog(code: string, description: string, listType: string) {
  const defaults = inferCatalogDefaults(description, listType);
  db.prepare(
    `INSERT INTO product_catalog
      (code, description, area, logs_stage, is_shared_byproduct)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
      description = excluded.description,
      updated_at = CURRENT_TIMESTAMP`
  ).run(code, description, defaults.area, defaults.logsStage, defaults.isSharedByproduct ? 1 : 0);
}

export function getGroups() {
  return db
    .prepare("SELECT id, name, area, notes FROM physical_groups ORDER BY area, name")
    .all();
}

export function createGroup(name: string, area: string, notes: string | null) {
  return db
    .prepare("INSERT INTO physical_groups (name, area, notes) VALUES (?, ?, ?)")
    .run(name.trim(), area, notes?.trim() || null);
}

export function getCatalog(): ProductCatalogItem[] {
  return db
    .prepare(
      `SELECT
        pc.code,
        pc.description,
        pc.physical_group_id AS physicalGroupId,
        pg.name AS physicalGroupName,
        pc.area,
        pc.logs_stage AS logsStage,
        pc.is_shared_byproduct AS isSharedByproduct,
        pc.is_confirmed AS isConfirmed
       FROM product_catalog pc
       LEFT JOIN physical_groups pg ON pg.id = pc.physical_group_id
       ORDER BY pc.is_confirmed, pc.area, pc.description`
    )
    .all()
    .map(mapBooleans) as ProductCatalogItem[];
}

export function updateCatalogItem(
  code: string,
  values: {
    physicalGroupId: number | null;
    area: string | null;
    logsStage: string;
    isSharedByproduct: boolean;
    isConfirmed: boolean;
  }
) {
  db.prepare(
    `UPDATE product_catalog
     SET physical_group_id = ?, area = ?, logs_stage = ?, is_shared_byproduct = ?, is_confirmed = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE code = ?`
  ).run(
    values.physicalGroupId,
    values.area,
    values.logsStage,
    values.isSharedByproduct ? 1 : 0,
    values.isConfirmed ? 1 : 0,
    code
  );
}

export function setDailyBatches(date: string, commonCount: number, phillyCount: number) {
  db.prepare(
    `INSERT INTO daily_batches (movement_date, common_count, philly_count, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(movement_date) DO UPDATE SET
      common_count = excluded.common_count,
      philly_count = excluded.philly_count,
      updated_at = CURRENT_TIMESTAMP`
  ).run(date, commonCount, phillyCount);
}

export function getDailyBatches(date: string): DailyBatches {
  const row = db
    .prepare(
      `SELECT movement_date AS movementDate, common_count AS commonCount, philly_count AS phillyCount
       FROM daily_batches WHERE movement_date = ?`
    )
    .get(date) as Omit<DailyBatches, "recipeKg"> | undefined;

  const base = row ?? { movementDate: date, commonCount: 0, phillyCount: 0 };
  return {
    ...base,
    recipeKg: calculateRecipeKg(base.commonCount, base.phillyCount)
  };
}

export function getDashboard(date: string): DashboardData {
  const rows = getEffectiveRows(date);
  const batches = getDailyBatches(date);

  return {
    date,
    porcionado: buildPorcionadoBalance(rows),
    logs: buildLogsBalance(rows, batches),
    batches,
    unknownProducts: getCatalog().filter((item) => !item.isConfirmed || !item.physicalGroupId),
    recentRows: rows.slice(0, 120).map((row) => ({
      id: row.id,
      movementDate: row.movementDate,
      listType: row.listType,
      code: row.code,
      description: row.description,
      packages: row.packages,
      units: row.units,
      netKg: row.netKg,
      effectiveKg: row.effectiveKg,
      isAdjusted: Boolean(row.isAdjusted),
      isExcluded: Boolean(row.isExcluded),
      physicalGroupName: row.physicalGroupName,
      logsStage: row.logsStage
    }))
  };
}

export function getEffectiveRows(date: string): EffectiveRow[] {
  return db
    .prepare(
      `WITH latest_revision AS (
        SELECT raw_movement_id, MAX(id) AS revision_id
        FROM adjustment_revisions
        GROUP BY raw_movement_id
      )
      SELECT
        rm.id,
        rm.movement_date AS movementDate,
        COALESCE(al.list_type, rm.list_type) AS listType,
        COALESCE(al.code, rm.code) AS code,
        COALESCE(al.description, rm.description) AS description,
        rm.packages,
        rm.units,
        rm.net_kg AS netKg,
        COALESCE(al.net_kg, rm.net_kg) AS effectiveKg,
        CASE WHEN lr.revision_id IS NULL THEN 0 ELSE 1 END AS isAdjusted,
        COALESCE(al.is_excluded, 0) AS isExcluded,
        COALESCE(al.physical_group_id, pc.physical_group_id) AS physicalGroupId,
        pg.name AS physicalGroupName,
        COALESCE(pc.area, 'compartido') AS area,
        COALESCE(al.logs_stage, pc.logs_stage, 'sin_clasificar') AS logsStage
      FROM raw_movements rm
      LEFT JOIN latest_revision lr ON lr.raw_movement_id = rm.id
      LEFT JOIN adjustment_lines al ON al.revision_id = lr.revision_id
      LEFT JOIN product_catalog pc ON pc.code = COALESCE(al.code, rm.code)
      LEFT JOIN physical_groups pg ON pg.id = COALESCE(al.physical_group_id, pc.physical_group_id)
      WHERE rm.movement_date = ?
      ORDER BY rm.created_at DESC, rm.id DESC`
    )
    .all(date) as EffectiveRow[];
}

export function saveAdjustment(rawMovementId: number, reason: string, lines: AdjustmentLineInput[]) {
  if (!reason.trim()) throw new Error("El motivo del ajuste es obligatorio.");
  if (!lines.length) throw new Error("El ajuste necesita al menos una línea.");

  const original = db.prepare("SELECT * FROM raw_movements WHERE id = ?").get(rawMovementId) as
    | { list_type: ListType }
    | undefined;
  if (!original) throw new Error("No se encontró la pesada original.");

  db.exec("BEGIN");
  try {
    const revision = db
      .prepare("INSERT INTO adjustment_revisions (raw_movement_id, reason) VALUES (?, ?)")
      .run(rawMovementId, reason.trim());
    const revisionId = Number(revision.lastInsertRowid);
    const insertLine = db.prepare(
      `INSERT INTO adjustment_lines
        (revision_id, code, description, list_type, net_kg, physical_group_id, logs_stage, is_excluded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const line of lines) {
      ensureCatalog(line.code, line.description, line.listType ?? original.list_type);
      insertLine.run(
        revisionId,
        line.code.trim(),
        line.description.trim(),
        line.listType ?? original.list_type,
        line.netKg,
        line.physicalGroupId ?? null,
        line.logsStage ?? "sin_clasificar",
        line.isExcluded ? 1 : 0
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function buildPorcionadoBalance(rows: EffectiveRow[]): BalanceRow[] {
  const map = new Map<string, BalanceRow>();

  for (const row of rows) {
    if (row.isExcluded) continue;
    if (!["entrada_desosado", "entrada_porcionado", "salida_porcionado"].includes(row.listType)) continue;

    const groupName = row.physicalGroupName ?? "Sin clasificar";
    const key = `${row.physicalGroupId ?? "unknown"}-${groupName}`;
    const existing =
      map.get(key) ??
      ({
        groupId: row.physicalGroupId,
        groupName,
        area: row.area ?? "porcionado",
        inputKg: 0,
        outputKg: 0,
        differenceKg: 0,
        yieldPercent: null,
        unknownCodes: 0,
        rowCount: 0
      } satisfies BalanceRow);

    const kg = Math.abs(row.effectiveKg);
    if (ENTRY_LISTS.has(row.listType)) existing.inputKg += kg;
    else existing.outputKg += kg;

    if (!row.physicalGroupId) existing.unknownCodes += 1;
    existing.rowCount += 1;
    map.set(key, existing);
  }

  return Array.from(map.values())
    .map((row) => ({
      ...roundBalance(row),
      differenceKg: round(row.outputKg - row.inputKg),
      yieldPercent: row.inputKg ? round((row.outputKg / row.inputKg) * 100) : null
    }))
    .sort((a, b) => Math.abs(b.differenceKg) - Math.abs(a.differenceKg));
}

function buildLogsBalance(rows: EffectiveRow[], batches: DailyBatches): LogsBalance[] {
  const stages: LogsBalance[] = [
    { stage: "elaboracion", inputKg: 0, recipeKg: batches.recipeKg, outputKg: 0, differenceKg: 0, rowCount: 0 },
    { stage: "desmolde", inputKg: 0, recipeKg: 0, outputKg: 0, differenceKg: 0, rowCount: 0 },
    { stage: "sin_clasificar", inputKg: 0, recipeKg: 0, outputKg: 0, differenceKg: 0, rowCount: 0 }
  ];

  const byStage = new Map(stages.map((stage) => [stage.stage, stage]));

  for (const row of rows) {
    if (row.isExcluded || !["entrada_logs", "salida_logs"].includes(row.listType)) continue;
    const stage = byStage.get(row.logsStage) ?? byStage.get("sin_clasificar")!;
    const kg = Math.abs(row.effectiveKg);
    if (ENTRY_LISTS.has(row.listType)) stage.inputKg += kg;
    else stage.outputKg += kg;
    stage.rowCount += 1;
  }

  return stages.map((stage) => ({
    ...stage,
    inputKg: round(stage.inputKg),
    recipeKg: round(stage.recipeKg),
    outputKg: round(stage.outputKg),
    differenceKg: round(stage.outputKg - stage.inputKg - stage.recipeKg)
  }));
}

function calculateRecipeKg(commonCount: number, phillyCount: number) {
  return round(
    commonCount * (LOGS_RECIPE.common.waterLiters * LOGS_RECIPE.waterKgPerLiter + LOGS_RECIPE.common.spicesKg) +
      phillyCount * (LOGS_RECIPE.philly.waterLiters * LOGS_RECIPE.waterKgPerLiter + LOGS_RECIPE.philly.spicesKg)
  );
}

function roundBalance(row: BalanceRow) {
  return {
    ...row,
    inputKg: round(row.inputKg),
    outputKg: round(row.outputKg)
  };
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function mapBooleans(row: Record<string, unknown>) {
  return {
    ...row,
    isSharedByproduct: Boolean(row.isSharedByproduct),
    isConfirmed: Boolean(row.isConfirmed)
  };
}
