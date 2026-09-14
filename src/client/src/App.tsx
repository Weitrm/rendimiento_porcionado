import {
  AlertTriangle,
  BarChart3,
  Check,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FolderKanban,
  Plus,
  RefreshCcw,
  Save,
  Scissors,
  Search,
  Settings2,
  Upload
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  Area,
  DashboardData,
  ListType,
  LogsStage,
  MovementRow,
  PhysicalGroup,
  ProductCatalogItem
} from "../../shared/types";
import {
  createGroup,
  fetchDashboard,
  fetchGroups,
  importList,
  saveAdjustment,
  saveBatches,
  updateCatalog
} from "./api";
import { formatKg, formatPercent, listLabels, stageLabels } from "./labels";

type SectionId = "resumen" | "importar" | "balance" | "catalogo" | "ajustes" | "exportar";

const importOrder: ListType[] = [
  "entrada_desosado",
  "entrada_porcionado",
  "salida_porcionado",
  "entrada_logs",
  "salida_logs"
];

const sections: Array<{ id: SectionId; label: string; icon: typeof BarChart3 }> = [
  { id: "resumen", label: "Resumen", icon: BarChart3 },
  { id: "importar", label: "Importacion", icon: Upload },
  { id: "balance", label: "Balance fisico", icon: ClipboardList },
  { id: "catalogo", label: "Catalogo", icon: FolderKanban },
  { id: "ajustes", label: "Ajustes", icon: Settings2 },
  { id: "exportar", label: "Exportar", icon: Download }
];

const defaultDate = "2026-09-12";

export function App() {
  const [activeSection, setActiveSection] = useState<SectionId>("resumen");
  const [date, setDate] = useState(defaultDate);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [groups, setGroups] = useState<PhysicalGroup[]>([]);
  const [files, setFiles] = useState<Partial<Record<ListType, File>>>({});
  const [status, setStatus] = useState("Listo.");
  const [busy, setBusy] = useState(false);
  const [commonCount, setCommonCount] = useState(0);
  const [phillyCount, setPhillyCount] = useState(0);
  const [editingRow, setEditingRow] = useState<MovementRow | null>(null);

  async function load() {
    const [nextDashboard, nextGroups] = await Promise.all([fetchDashboard(date), fetchGroups()]);
    setDashboard(nextDashboard);
    setGroups(nextGroups);
    setCommonCount(nextDashboard.batches.commonCount);
    setPhillyCount(nextDashboard.batches.phillyCount);
  }

  useEffect(() => {
    load().catch((error) => setStatus(error.message));
  }, [date]);

  async function handleImportAll() {
    setBusy(true);
    setStatus("Importando listas...");
    try {
      const selected = importOrder.filter((type) => files[type]);
      for (const listType of selected) {
        const file = files[listType]!;
        const result = await importList(date, listType, file);
        setStatus(`${listLabels[listType]}: ${result.insertedRows} nuevas, ${result.skippedRows} repetidas.`);
      }
      await load();
      setStatus("Importacion terminada.");
      setActiveSection("balance");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo importar.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveBatches() {
    setBusy(true);
    try {
      await saveBatches(date, commonCount, phillyCount);
      await load();
      setStatus("Canchadas guardadas.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudieron guardar las canchadas.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCatalogSave(item: ProductCatalogItem, patch: Partial<ProductCatalogItem>) {
    await updateCatalog(item.code, {
      physicalGroupId: patch.physicalGroupId ?? item.physicalGroupId,
      area: patch.area ?? item.area,
      logsStage: patch.logsStage ?? item.logsStage,
      isSharedByproduct: patch.isSharedByproduct ?? item.isSharedByproduct,
      isConfirmed: patch.isConfirmed ?? item.isConfirmed
    });
    await load();
  }

  const sectionTitle = sections.find((section) => section.id === activeSection)?.label ?? "Resumen";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Scissors size={24} />
          <div>
            <strong>Rendimientos</strong>
            <span>Porcionado y Logs</span>
          </div>
        </div>

        <label className="field">
          Fecha de trabajo
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>

        <nav className="section-nav">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                className={activeSection === section.id ? "nav-item active" : "nav-item"}
                key={section.id}
                onClick={() => setActiveSection(section.id)}
              >
                <Icon size={18} />
                {section.label}
                {section.id === "catalogo" && (dashboard?.unknownProducts.length ?? 0) > 0 && (
                  <b>{dashboard?.unknownProducts.length}</b>
                )}
              </button>
            );
          })}
        </nav>

        <p className="status">{status}</p>
      </aside>

      <main className="workspace">
        <section className="topbar">
          <div>
            <h1>{sectionTitle}</h1>
            <p>{date}</p>
          </div>
          <button className="ghost" onClick={() => load()}>
            <RefreshCcw size={18} />
            Actualizar
          </button>
        </section>

        {activeSection === "resumen" && (
          <SummaryPage dashboard={dashboard} onOpen={setActiveSection} />
        )}

        {activeSection === "importar" && (
          <ImportPage
            busy={busy}
            files={files}
            setFiles={setFiles}
            commonCount={commonCount}
            phillyCount={phillyCount}
            setCommonCount={setCommonCount}
            setPhillyCount={setPhillyCount}
            onImport={handleImportAll}
            onSaveBatches={handleSaveBatches}
          />
        )}

        {activeSection === "balance" && <BalancePage dashboard={dashboard} />}

        {activeSection === "catalogo" && (
          <CatalogPanel
            items={dashboard?.unknownProducts ?? []}
            groups={groups}
            onReload={load}
            onSave={handleCatalogSave}
          />
        )}

        {activeSection === "ajustes" && (
          <RowsPanel rows={dashboard?.recentRows ?? []} groups={groups} onAdjust={setEditingRow} />
        )}

        {activeSection === "exportar" && <ExportPage date={date} dashboard={dashboard} />}
      </main>

      {editingRow && (
        <AdjustmentModal
          row={editingRow}
          groups={groups}
          onClose={() => setEditingRow(null)}
          onSaved={async () => {
            setEditingRow(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function SummaryPage({
  dashboard,
  onOpen
}: {
  dashboard: DashboardData | null;
  onOpen: (section: SectionId) => void;
}) {
  const biggestDifference = dashboard?.porcionado[0];

  return (
    <>
      <section className="metrics-grid">
        <Metric title="Grupos en balance" value={dashboard?.porcionado.length ?? 0} />
        <Metric
          title="Productos pendientes"
          value={dashboard?.unknownProducts.length ?? 0}
          tone={(dashboard?.unknownProducts.length ?? 0) > 0 ? "warn" : "ok"}
        />
        <Metric title="Receta Logs kg" value={formatKg(dashboard?.batches.recipeKg ?? 0)} />
      </section>

      <section className="function-grid">
        <FunctionTile
          icon={Upload}
          title="Importacion diaria"
          value={`${importOrder.length} listas`}
          action="Cargar archivos"
          onClick={() => onOpen("importar")}
        />
        <FunctionTile
          icon={ClipboardList}
          title="Balance fisico"
          value={biggestDifference ? `${formatKg(biggestDifference.differenceKg)} kg` : "Sin datos"}
          action="Ver diferencias"
          onClick={() => onOpen("balance")}
        />
        <FunctionTile
          icon={FolderKanban}
          title="Catalogo"
          value={`${dashboard?.unknownProducts.length ?? 0} pendientes`}
          action="Clasificar"
          onClick={() => onOpen("catalogo")}
        />
        <FunctionTile
          icon={Settings2}
          title="Ajustes"
          value={`${dashboard?.recentRows.length ?? 0} filas visibles`}
          action="Revisar detalle"
          onClick={() => onOpen("ajustes")}
        />
      </section>

      <BalancePage dashboard={dashboard} compact />
    </>
  );
}

function ImportPage({
  busy,
  files,
  setFiles,
  commonCount,
  phillyCount,
  setCommonCount,
  setPhillyCount,
  onImport,
  onSaveBatches
}: {
  busy: boolean;
  files: Partial<Record<ListType, File>>;
  setFiles: React.Dispatch<React.SetStateAction<Partial<Record<ListType, File>>>>;
  commonCount: number;
  phillyCount: number;
  setCommonCount: (value: number) => void;
  setPhillyCount: (value: number) => void;
  onImport: () => Promise<void>;
  onSaveBatches: () => Promise<void>;
}) {
  return (
    <div className="page-grid two-columns">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Listas del dia</h2>
            <p>La fecha sale del selector lateral, no del contenido de los archivos.</p>
          </div>
          <button className="primary compact" disabled={busy || !Object.keys(files).length} onClick={onImport}>
            <Upload size={16} />
            Importar
          </button>
        </div>

        <div className="import-cards">
          {importOrder.map((listType) => (
            <label className={files[listType] ? "file-card ready" : "file-card"} key={listType}>
              <span>{listLabels[listType]}</span>
              <small>{files[listType]?.name ?? "Sin archivo seleccionado"}</small>
              <input
                type="file"
                accept=".xlsx"
                onChange={(event) =>
                  setFiles((current) => ({ ...current, [listType]: event.target.files?.[0] }))
                }
              />
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Canchadas Logs</h2>
            <p>Agua: 1 kg por litro. La receta se suma solo en elaboracion.</p>
          </div>
          <button className="secondary compact" onClick={onSaveBatches}>
            <Save size={16} />
            Guardar
          </button>
        </div>
        <div className="batch-grid">
          <label className="field">
            Comunes
            <input
              type="number"
              min="0"
              value={commonCount}
              onChange={(event) => setCommonCount(Number(event.target.value))}
            />
          </label>
          <label className="field">
            Philly's Best
            <input
              type="number"
              min="0"
              value={phillyCount}
              onChange={(event) => setPhillyCount(Number(event.target.value))}
            />
          </label>
        </div>
      </section>
    </div>
  );
}

function BalancePage({ dashboard, compact = false }: { dashboard: DashboardData | null; compact?: boolean }) {
  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Porcionado</h2>
            <p>Asados integrado. Subproductos compartidos sin reparto automatico.</p>
          </div>
        </div>
        <PorcionadoTable rows={compact ? dashboard?.porcionado.slice(0, 5) ?? [] : dashboard?.porcionado ?? []} />
      </section>

      {!compact && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Logs por etapa</h2>
              <p>Elaboracion y desmolde se miran separados.</p>
            </div>
          </div>
          <LogsCards dashboard={dashboard} />
        </section>
      )}
    </>
  );
}

function ExportPage({ date, dashboard }: { date: string; dashboard: DashboardData | null }) {
  return (
    <section className="panel export-panel">
      <FileSpreadsheet size={34} />
      <h2>Informe Excel</h2>
      <p>Incluye resumen, detalle de movimientos efectivos y productos pendientes.</p>
      <div className="export-facts">
        <span>{dashboard?.recentRows.length ?? 0} filas visibles</span>
        <span>{dashboard?.unknownProducts.length ?? 0} productos pendientes</span>
        <span>{formatKg(dashboard?.batches.recipeKg ?? 0)} kg receta Logs</span>
      </div>
      <a className="primary" href={`/api/export?date=${date}`}>
        <Download size={18} />
        Descargar Excel
      </a>
    </section>
  );
}

function PorcionadoTable({ rows }: { rows: DashboardData["porcionado"] }) {
  const maxDifference = useMemo(() => Math.max(1, ...rows.map((row) => Math.abs(row.differenceKg))), [rows]);

  return (
    <div className="table">
      <div className="table-row table-head porcionado-grid">
        <span>Grupo fisico</span>
        <span>Entrado</span>
        <span>Salido</span>
        <span>Diferencia</span>
        <span>Rendimiento</span>
      </div>
      {rows.map((row) => (
        <div className="table-row porcionado-grid" key={`${row.groupId}-${row.groupName}`}>
          <span>
            <strong>{row.groupName}</strong>
            {row.unknownCodes > 0 && <small>{row.unknownCodes} codigos sin grupo</small>}
          </span>
          <span>{formatKg(row.inputKg)} kg</span>
          <span>{formatKg(row.outputKg)} kg</span>
          <span className={row.differenceKg < 0 ? "negative" : "positive"}>
            {formatKg(row.differenceKg)} kg
            <i style={{ width: `${Math.min(100, (Math.abs(row.differenceKg) / maxDifference) * 100)}%` }} />
          </span>
          <span>{formatPercent(row.yieldPercent)}</span>
        </div>
      ))}
    </div>
  );
}

function LogsCards({ dashboard }: { dashboard: DashboardData | null }) {
  return (
    <div className="logs-grid">
      {dashboard?.logs.map((row) => (
        <div className="stage-card" key={row.stage}>
          <h3>{stageLabels[row.stage]}</h3>
          <dl>
            <dt>Carne</dt>
            <dd>{formatKg(row.inputKg)} kg</dd>
            <dt>Receta</dt>
            <dd>{formatKg(row.recipeKg)} kg</dd>
            <dt>Salida</dt>
            <dd>{formatKg(row.outputKg)} kg</dd>
            <dt>Diferencia</dt>
            <dd className={row.differenceKg < 0 ? "negative" : "positive"}>{formatKg(row.differenceKg)} kg</dd>
          </dl>
        </div>
      ))}
    </div>
  );
}

function Metric({ title, value, tone }: { title: string; value: string | number; tone?: "ok" | "warn" }) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FunctionTile({
  icon: Icon,
  title,
  value,
  action,
  onClick
}: {
  icon: typeof Upload;
  title: string;
  value: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <button className="function-tile" onClick={onClick}>
      <Icon size={22} />
      <span>{title}</span>
      <strong>{value}</strong>
      <em>{action}</em>
    </button>
  );
}

function CatalogPanel({
  items,
  groups,
  onReload,
  onSave
}: {
  items: ProductCatalogItem[];
  groups: PhysicalGroup[];
  onReload: () => Promise<void>;
  onSave: (item: ProductCatalogItem, patch: Partial<ProductCatalogItem>) => Promise<void>;
}) {
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupArea, setNewGroupArea] = useState<Area>("porcionado");

  async function addGroup() {
    if (!newGroupName.trim()) return;
    await createGroup(newGroupName, newGroupArea);
    setNewGroupName("");
    await onReload();
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Productos pendientes</h2>
          <p>Confirmar grupo fisico antes de usar el balance por corte.</p>
        </div>
      </div>

      <div className="new-group">
        <input
          placeholder="Nuevo grupo fisico"
          value={newGroupName}
          onChange={(event) => setNewGroupName(event.target.value)}
        />
        <select value={newGroupArea} onChange={(event) => setNewGroupArea(event.target.value as Area)}>
          <option value="porcionado">Porcionado</option>
          <option value="logs">Logs</option>
          <option value="compartido">Compartido</option>
        </select>
        <button className="secondary compact" onClick={addGroup}>
          <Plus size={16} />
          Crear grupo
        </button>
      </div>

      <div className="table">
        <div className="table-row table-head catalog-grid">
          <span>Codigo</span>
          <span>Descripcion</span>
          <span>Grupo</span>
          <span>Etapa Logs</span>
          <span></span>
        </div>
        {items.map((item) => (
          <CatalogRow key={item.code} item={item} groups={groups} onSave={onSave} />
        ))}
      </div>
    </section>
  );
}

function CatalogRow({
  item,
  groups,
  onSave
}: {
  item: ProductCatalogItem;
  groups: PhysicalGroup[];
  onSave: (item: ProductCatalogItem, patch: Partial<ProductCatalogItem>) => Promise<void>;
}) {
  const [groupId, setGroupId] = useState(item.physicalGroupId ?? "");
  const [logsStage, setLogsStage] = useState<LogsStage>(item.logsStage);

  return (
    <div className="table-row catalog-grid">
      <span>{item.code}</span>
      <span>{item.description}</span>
      <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
        <option value="">Sin grupo</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>
      <select value={logsStage} onChange={(event) => setLogsStage(event.target.value as LogsStage)}>
        <option value="sin_clasificar">Sin clasificar</option>
        <option value="elaboracion">Elaboracion</option>
        <option value="desmolde">Desmolde y envasado</option>
      </select>
      <button
        className="icon-button"
        title="Confirmar producto"
        onClick={() =>
          onSave(item, {
            physicalGroupId: groupId ? Number(groupId) : null,
            logsStage,
            isConfirmed: Boolean(groupId)
          })
        }
      >
        <Check size={17} />
      </button>
    </div>
  );
}

function RowsPanel({
  rows,
  groups,
  onAdjust
}: {
  rows: MovementRow[];
  groups: PhysicalGroup[];
  onAdjust: (row: MovementRow) => void;
}) {
  const [query, setQuery] = useState("");
  const visibleRows = rows.filter((row) =>
    `${row.code} ${row.description} ${row.listType}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es"))
  );

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Detalle y ajustes</h2>
          <p>El ajuste conserva el dato original y crea una version efectiva.</p>
        </div>
        <label className="search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar codigo o corte" />
        </label>
      </div>

      <div className="table">
        <div className="table-row table-head rows-grid">
          <span>Lista</span>
          <span>Codigo</span>
          <span>Descripcion</span>
          <span>Kg</span>
          <span>Grupo</span>
          <span></span>
        </div>
        {visibleRows.map((row) => (
          <div className="table-row rows-grid" key={`${row.id}-${row.code}-${row.effectiveKg}`}>
            <span>{listLabels[row.listType]}</span>
            <span>{row.code}</span>
            <span>
              {row.description}
              {row.isAdjusted && <small>Ajustado</small>}
            </span>
            <span>{formatKg(row.effectiveKg)} kg</span>
            <span>{row.physicalGroupName ?? "Sin grupo"}</span>
            <button className="icon-button" title="Registrar ajuste" onClick={() => onAdjust(row)}>
              <AlertTriangle size={17} />
            </button>
          </div>
        ))}
      </div>
      {!groups.length && <p className="empty-note">Cargar grupos fisicos para clasificar productos.</p>}
    </section>
  );
}

function AdjustmentModal({
  row,
  groups,
  onClose,
  onSaved
}: {
  row: MovementRow;
  groups: PhysicalGroup[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState([
    {
      code: row.code,
      description: row.description,
      netKg: row.effectiveKg,
      physicalGroupId: "",
      logsStage: row.logsStage,
      isExcluded: false
    }
  ]);
  const total = lines.reduce((sum, line) => sum + Number(line.netKg || 0), 0);
  const delta = total - row.netKg;

  async function submit() {
    await saveAdjustment(
      row.id,
      reason,
      lines.map((line) => ({
        ...line,
        netKg: Number(line.netKg),
        physicalGroupId: line.physicalGroupId ? Number(line.physicalGroupId) : null
      }))
    );
    await onSaved();
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="panel-header">
          <div>
            <h2>Ajustar pesada</h2>
            <p>
              {row.code} - {row.description}
            </p>
          </div>
          <button className="ghost" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <label className="field">
          Motivo
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>

        {lines.map((line, index) => (
          <div className="adjust-line" key={index}>
            <input
              value={line.code}
              onChange={(event) =>
                setLines((current) => current.map((item, i) => (i === index ? { ...item, code: event.target.value } : item)))
              }
            />
            <input
              value={line.description}
              onChange={(event) =>
                setLines((current) =>
                  current.map((item, i) => (i === index ? { ...item, description: event.target.value } : item))
                )
              }
            />
            <input
              type="number"
              value={line.netKg}
              onChange={(event) =>
                setLines((current) =>
                  current.map((item, i) => (i === index ? { ...item, netKg: Number(event.target.value) } : item))
                )
              }
            />
            <select
              value={line.physicalGroupId}
              onChange={(event) =>
                setLines((current) =>
                  current.map((item, i) => (i === index ? { ...item, physicalGroupId: event.target.value } : item))
                )
              }
            >
              <option value="">Sin grupo</option>
              {groups.map((group) => (
                <option value={group.id} key={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            <label className="check-field">
              <input
                type="checkbox"
                checked={line.isExcluded}
                onChange={(event) =>
                  setLines((current) =>
                    current.map((item, i) => (i === index ? { ...item, isExcluded: event.target.checked } : item))
                  )
                }
              />
              Excluir
            </label>
          </div>
        ))}

        <div className="modal-actions">
          <span className={Math.abs(delta) > 0.01 ? "negative" : "positive"}>
            Total ajustado: {formatKg(total)} kg - diferencia contra original: {formatKg(delta)} kg
          </span>
          <button
            className="secondary compact"
            onClick={() =>
              setLines((current) => [
                ...current,
                {
                  code: row.code,
                  description: row.description,
                  netKg: 0,
                  physicalGroupId: "",
                  logsStage: row.logsStage,
                  isExcluded: false
                }
              ])
            }
          >
            <Plus size={16} />
            Dividir
          </button>
          <button className="primary compact" onClick={submit}>
            <FileSpreadsheet size={16} />
            Guardar ajuste
          </button>
        </div>
      </div>
    </div>
  );
}
