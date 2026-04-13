/**
 * Cookie de sesión firmada (no es cifrado de datos contables; evita manipulación del ID de sesión).
 * En producción: SESSION_SECRET largo y aleatorio, HTTPS y cookie secure.
 */
export function getSessionMiddleware(Session) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET debe definirse en .env con al menos 32 caracteres aleatorios (npm run gen:session-secret)."
    );
  }

  const isProd = process.env.NODE_ENV === "production";

  return Session({
    name: "intimo.acct.sid",
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    },
  });
}
