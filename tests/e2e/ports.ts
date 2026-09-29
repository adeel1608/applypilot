function configuredPort(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;

  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer loopback port between 1024 and 65535`);
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${name} must be an integer loopback port between 1024 and 65535`);
  }
  return port;
}

export const E2E_PORT = configuredPort("APPLYPILOT_E2E_PORT", 3100);
export const SHOWCASE_E2E_PORT = configuredPort("APPLYPILOT_SHOWCASE_E2E_PORT", 3200);

if (E2E_PORT === SHOWCASE_E2E_PORT) {
  throw new Error("APPLYPILOT_E2E_PORT and APPLYPILOT_SHOWCASE_E2E_PORT must be different");
}
