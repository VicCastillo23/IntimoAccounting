/**
 * Debe importarse antes que cualquier módulo que lea process.env.
 * Carga .env desde la raíz del proyecto (no desde process.cwd), para que systemd u otros
 * lanzadores no dependan de WorkingDirectory.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.join(__dirname, "..", ".env");
dotenv.config({ path: rootEnv });
