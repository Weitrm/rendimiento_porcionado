import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate } from "../src/server/db";
import { buildMonthlyWorkbook } from "../src/server/exporter";

const month = process.env.SMOKE_MONTH ?? "2026-09";
const outputPath = resolve("outputs", `planilla-${month}.xlsx`);

migrate();
mkdirSync("outputs", { recursive: true });
writeFileSync(outputPath, await buildMonthlyWorkbook(month));
console.log(outputPath);
