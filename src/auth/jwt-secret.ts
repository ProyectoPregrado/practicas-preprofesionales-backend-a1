// E3-04 / D-07: el secreto de firma no puede tener un valor por defecto en el
// código. Si falta la variable de entorno, la aplicación no debe arrancar —
// arrancar con un secreto conocido es peor que no arrancar.
export function getRequiredJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.JWT_SECRET
  if (!secret) {
    throw new Error(
      'Falta la variable de entorno JWT_SECRET. Generá una con "openssl rand -base64 48" ' +
        'y agregala a tu .env (ver README.md, sección Variables de entorno). ' +
        'La aplicación no puede arrancar sin un secreto de firma explícito.',
    )
  }
  return secret
}
