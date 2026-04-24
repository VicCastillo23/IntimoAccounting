import * as file from "./usersStoreFile.js";
import * as db from "./authUsersDb.js";

/** @type {"file" | "db"} */
let _authBackend = "file";

/**
 * Con DATABASE_URL: usuarios en auth.app_users (compartido con facturación).
 * Sin DATABASE_URL: archivo cifrado data/users.enc (comportamiento anterior).
 * @param {Buffer} dataKeyForFile
 */
export async function initUsersStoreAsync(dataKeyForFile) {
  if (process.env.DATABASE_URL?.trim()) {
    await db.bootstrapAuthUsersIfEmpty();
    _authBackend = "db";
    console.log("[intimo-accounting] Usuarios de portal: PostgreSQL (auth.app_users).");
  } else {
    file.initFileUsersStore(dataKeyForFile);
    _authBackend = "file";
    console.log("[intimo-accounting] Usuarios de portal: archivo cifrado (data/users.enc).");
  }
}

/**
 * @param {string} username
 * @param {string} password
 */
export async function verifyCredentials(username, password) {
  if (_authBackend === "db") return db.verifyCredentialsDb(username, password);
  return file.verifyCredentialsFile(username, password);
}

/**
 * @param {string} id
 */
export async function getUserById(id) {
  if (_authBackend === "db") return db.getUserByIdDb(id);
  return file.getUserByIdFile(id);
}
