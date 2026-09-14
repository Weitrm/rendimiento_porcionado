import type {
  Area,
  DashboardData,
  ImportResult,
  ListType,
  LogsStage,
  PhysicalGroup,
  ProductCatalogItem
} from "../../shared/types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "No se pudo completar la operación.");
  }
  return response.json() as Promise<T>;
}

export function fetchDashboard(date: string) {
  return request<DashboardData>(`/api/dashboard?date=${date}`);
}

export function fetchGroups() {
  return request<PhysicalGroup[]>("/api/groups");
}

export function fetchCatalog() {
  return request<ProductCatalogItem[]>("/api/catalog");
}

export function importList(date: string, listType: ListType, file: File) {
  const form = new FormData();
  form.append("date", date);
  form.append("listType", listType);
  form.append("file", file);

  return request<ImportResult>("/api/imports", {
    method: "POST",
    body: form
  });
}

export function saveBatches(date: string, commonCount: number, phillyCount: number) {
  return request<{ ok: boolean }>(`/api/batches/${date}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commonCount, phillyCount })
  });
}

export function updateCatalog(
  code: string,
  payload: {
    physicalGroupId: number | null;
    area: Area | null;
    logsStage: LogsStage;
    isSharedByproduct: boolean;
    isConfirmed: boolean;
  }
) {
  return request<{ ok: boolean }>(`/api/catalog/${encodeURIComponent(code)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function createGroup(name: string, area: Area, notes?: string) {
  return request<{ ok: boolean }>("/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, area, notes })
  });
}

export function saveAdjustment(
  rowId: number,
  reason: string,
  lines: Array<{
    code: string;
    description: string;
    netKg: number;
    listType?: ListType;
    physicalGroupId?: number | null;
    logsStage?: LogsStage;
    isExcluded?: boolean;
  }>
) {
  return request<{ ok: boolean }>(`/api/rows/${rowId}/adjustments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason, lines })
  });
}
