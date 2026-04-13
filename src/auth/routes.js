import { verifyCredentials, getUserById } from "./usersStore.js";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
/** @type {Map<string, { count: number; since: number }>} */
const failedByIp = new Map();

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function isLocked(ip) {
  const rec = failedByIp.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.since > WINDOW_MS) {
    failedByIp.delete(ip);
    return false;
  }
  return rec.count >= MAX_FAILS;
}

function recordFail(ip) {
  const now = Date.now();
  let rec = failedByIp.get(ip);
  if (!rec || now - rec.since > WINDOW_MS) rec = { count: 0, since: now };
  rec.count++;
  failedByIp.set(ip, rec);
}

function clearFails(ip) {
  failedByIp.delete(ip);
}

export async function handleLogin(req, res) {
  const ip = clientIp(req);
  if (isLocked(ip)) {
    return res.status(429).json({
      success: false,
      message: "Demasiados intentos fallidos. Espera unos minutos.",
    });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: "Usuario y contraseña son obligatorios.",
    });
  }

  const user = await verifyCredentials(username, password);
  if (!user) {
    recordFail(ip);
    return res.status(401).json({
      success: false,
      message: "Credenciales incorrectas.",
    });
  }

  clearFails(ip);
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true, user: { username: user.username } });
}

export function handleLogout(req, res) {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: "No se pudo cerrar sesión." });
    }
    res.clearCookie("intimo.acct.sid", { path: "/" });
    res.json({ success: true });
  });
}

export function handleMe(req, res) {
  const id = req.session?.userId;
  if (!id) {
    return res.json({ success: true, user: null });
  }
  const u = getUserById(id);
  if (!u) {
    req.session.destroy(() => {});
    return res.json({ success: true, user: null });
  }
  res.json({ success: true, user: { username: u.username } });
}
