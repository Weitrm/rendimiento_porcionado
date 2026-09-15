import cors from "cors";
import express from "express";
import multer from "multer";
import { LIST_TYPES, type ListType } from "../shared/types";
import { migrate } from "./db";
import { buildExcelReport } from "./exporter";
import {
  createGroup,
  getCatalog,
  getClassificationRules,
  getDashboard,
  getGroups,
  importWorkbook,
  previewWorkbookImport,
  saveAdjustment,
  setDailyBatches,
  startWorkMonth,
  updateCatalogItem
} from "./repository";

migrate();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = Number(process.env.PORT ?? 5174);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/dashboard", (req, res, next) => {
  try {
    const date = requireDate(req.query.date);
    res.json(getDashboard(date));
  } catch (error) {
    next(error);
  }
});

app.post("/api/imports", upload.single("file"), async (req, res, next) => {
  try {
    const movementDate = requireDate(req.body.date);
    const listType = requireListType(req.body.listType);
    if (!req.file) throw new Error("Falta adjuntar un archivo Excel.");

    res.json(
      await importWorkbook({
        movementDate,
        listType,
        originalName: req.file.originalname,
        buffer: req.file.buffer,
        decisions: parseJsonField(req.body.decisions, [])
      })
    );
  } catch (error) {
    next(error);
  }
});

app.post("/api/import-preview", upload.single("file"), async (req, res, next) => {
  try {
    const movementDate = requireDate(req.body.date);
    const listType = requireListType(req.body.listType);
    if (!req.file) throw new Error("Falta adjuntar un archivo Excel.");

    res.json(
      await previewWorkbookImport({
        movementDate,
        listType,
        originalName: req.file.originalname,
        buffer: req.file.buffer
      })
    );
  } catch (error) {
    next(error);
  }
});

app.get("/api/catalog", (_req, res, next) => {
  try {
    res.json(getCatalog());
  } catch (error) {
    next(error);
  }
});

app.patch("/api/catalog/:code", (req, res, next) => {
  try {
    updateCatalogItem(req.params.code, req.body);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/groups", (_req, res, next) => {
  try {
    res.json(getGroups());
  } catch (error) {
    next(error);
  }
});

app.get("/api/classification-rules", (_req, res, next) => {
  try {
    res.json(getClassificationRules());
  } catch (error) {
    next(error);
  }
});

app.post("/api/groups", (req, res, next) => {
  try {
    createGroup(req.body.name, req.body.area, req.body.notes ?? null);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.put("/api/batches/:date", (req, res, next) => {
  try {
    const date = requireDate(req.params.date);
    setDailyBatches(date, Number(req.body.commonCount ?? 0), Number(req.body.phillyCount ?? 0));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/months/:month/start", (req, res, next) => {
  try {
    startWorkMonth(req.params.month);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/rows/:id/adjustments", (req, res, next) => {
  try {
    saveAdjustment(Number(req.params.id), req.body.reason, req.body.lines);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/export", async (req, res, next) => {
  try {
    const date = requireDate(req.query.date);
    const report = await buildExcelReport(date);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"rendimientos-${date}.xlsx\"`
    );
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(report);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Error inesperado";
  res.status(400).json({ error: message });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`API de rendimientos en http://127.0.0.1:${port}`);
});

function requireDate(value: unknown) {
  const date = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("La fecha debe tener formato YYYY-MM-DD.");
  return date;
}

function requireListType(value: unknown): ListType {
  const listType = String(value ?? "") as ListType;
  if (!LIST_TYPES.includes(listType)) throw new Error("Tipo de lista inválido.");
  return listType;
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return value as T;
  return JSON.parse(value) as T;
}
