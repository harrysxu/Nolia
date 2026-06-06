const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");

const REQUIRED_IDENTITY_PREFIX = "Developer ID Application:";

function main() {
  const cscName = readEnv("CSC_NAME");
  if (!cscName) {
    fail([
      "CSC_NAME is required for release packaging.",
      'Set it to the signing identity name without certificate kind, for example: CSC_NAME="Example Inc. (TEAMID)"'
    ]);
  }

  if (cscName.startsWith(REQUIRED_IDENTITY_PREFIX)) {
    fail([
      `CSC_NAME must not include the "${REQUIRED_IDENTITY_PREFIX}" prefix.`,
      `Received: ${cscName}`,
      `Use: ${cscName.slice(REQUIRED_IDENTITY_PREFIX.length).trim()}`
    ]);
  }

  const fullIdentityName = `${REQUIRED_IDENTITY_PREFIX} ${cscName}`;
  const identities = listCodeSigningIdentities();
  if (!identities.includes(fullIdentityName)) {
    fail([
      "The configured Developer ID Application certificate was not found in the local keychain.",
      `Expected identity: ${fullIdentityName}`,
      "Install the certificate and private key, or update CSC_NAME to match an installed Developer ID Application identity."
    ]);
  }

  const notarization = resolveNotarizationMode();
  if (!notarization.ok) {
    fail([
      "Notarization credentials are required for release packaging.",
      "Use APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or APPLE_API_KEY + APPLE_API_KEY_ID, or NOTARIZE_KEYCHAIN_PROFILE."
    ]);
  }
}

function readEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function listCodeSigningIdentities() {
  let output = "";
  try {
    output = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    fail(["Unable to inspect macOS code signing identities.", error instanceof Error ? error.message : String(error)]);
  }

  const matches = [...output.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  return matches.filter((identity) => identity.startsWith(REQUIRED_IDENTITY_PREFIX));
}

function resolveNotarizationMode() {
  if (readEnv("NOTARIZE_KEYCHAIN_PROFILE")) {
    const keychain = readEnv("NOTARIZE_KEYCHAIN");
    if (keychain && !existsSync(keychain)) {
      fail([`NOTARIZE_KEYCHAIN does not point to an existing keychain: ${keychain}`]);
    }
    return { ok: true };
  }

  if (readEnv("APPLE_ID") && readEnv("APPLE_APP_SPECIFIC_PASSWORD") && readEnv("APPLE_TEAM_ID")) {
    return { ok: true };
  }

  const apiKey = readEnv("APPLE_API_KEY");
  if (apiKey && readEnv("APPLE_API_KEY_ID")) {
    if (!existsSync(apiKey)) {
      fail([`APPLE_API_KEY does not point to an existing .p8 file: ${apiKey}`]);
    }
    return { ok: true };
  }

  return { ok: false };
}

function fail(lines) {
  console.error("");
  console.error("Nolia release packaging is not configured.");
  console.error("");
  for (const line of lines) {
    console.error(`- ${line}`);
  }
  console.error("");
  process.exit(1);
}

main();
