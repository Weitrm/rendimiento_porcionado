import type { ListType, LogsStage } from "../shared/types";

export type ParsedRow = {
  rowIndex: number;
  code: string;
  description: string;
  packages: number | null;
  units: number | null;
  netKg: number;
  sourceProdDate: string | null;
  sourceSlaughterDate: string | null;
  raw: Record<string, unknown>;
};

export type ImportedFile = {
  listType: ListType;
  movementDate: string;
  originalName: string;
  buffer: Buffer;
};

export type AdjustmentLineInput = {
  code: string;
  description: string;
  netKg: number;
  listType?: ListType;
  physicalGroupId?: number | null;
  logsStage?: LogsStage;
  isExcluded?: boolean;
};
