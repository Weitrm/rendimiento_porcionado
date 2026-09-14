export const LIST_TYPES = [
  "entrada_desosado",
  "entrada_porcionado",
  "salida_porcionado",
  "entrada_logs",
  "salida_logs"
] as const;

export type ListType = (typeof LIST_TYPES)[number];

export type Area = "porcionado" | "logs" | "compartido";

export type LogsStage = "elaboracion" | "desmolde" | "sin_clasificar";

export type ImportResult = {
  importId: number;
  insertedRows: number;
  skippedRows: number;
  totalRows: number;
  totalKg: number;
};

export type ProductCatalogItem = {
  code: string;
  description: string;
  physicalGroupId: number | null;
  physicalGroupName: string | null;
  area: Area | null;
  logsStage: LogsStage;
  isSharedByproduct: boolean;
  isConfirmed: boolean;
};

export type PhysicalGroup = {
  id: number;
  name: string;
  area: Area;
  notes: string | null;
};

export type BalanceRow = {
  groupId: number | null;
  groupName: string;
  area: Area;
  inputKg: number;
  outputKg: number;
  differenceKg: number;
  yieldPercent: number | null;
  unknownCodes: number;
  rowCount: number;
};

export type LogsBalance = {
  stage: LogsStage;
  inputKg: number;
  recipeKg: number;
  outputKg: number;
  differenceKg: number;
  rowCount: number;
};

export type DailyBatches = {
  movementDate: string;
  commonCount: number;
  phillyCount: number;
  recipeKg: number;
};

export type MovementRow = {
  id: number;
  movementDate: string;
  listType: ListType;
  code: string;
  description: string;
  packages: number | null;
  units: number | null;
  netKg: number;
  effectiveKg: number;
  isAdjusted: boolean;
  isExcluded: boolean;
  physicalGroupName: string | null;
  logsStage: LogsStage;
};

export type DashboardData = {
  date: string;
  porcionado: BalanceRow[];
  logs: LogsBalance[];
  batches: DailyBatches;
  unknownProducts: ProductCatalogItem[];
  recentRows: MovementRow[];
};
