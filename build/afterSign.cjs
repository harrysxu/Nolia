const { notarize } = require("@electron/notarize");

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  if (process.env.NOLIA_SKIP_NOTARIZE === "1") {
    return;
  }

  await notarize({
    appPath: `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`,
    ...resolveNotarizationCredentials()
  });
};

function resolveNotarizationCredentials() {
  const keychainProfile = readEnv("NOTARIZE_KEYCHAIN_PROFILE");
  if (keychainProfile) {
    const keychain = readEnv("NOTARIZE_KEYCHAIN");
    return { keychainProfile, ...(keychain ? { keychain } : {}) };
  }

  const appleId = readEnv("APPLE_ID");
  const appleIdPassword = readEnv("APPLE_APP_SPECIFIC_PASSWORD");
  const teamId = readEnv("APPLE_TEAM_ID");
  if (appleId && appleIdPassword && teamId) {
    return { appleId, appleIdPassword, teamId };
  }

  const appleApiKey = readEnv("APPLE_API_KEY");
  const appleApiKeyId = readEnv("APPLE_API_KEY_ID");
  const appleApiIssuer = readEnv("APPLE_API_ISSUER");
  if (appleApiKey && appleApiKeyId) {
    return {
      appleApiKey,
      appleApiKeyId,
      ...(appleApiIssuer ? { appleApiIssuer } : {})
    };
  }

  throw new Error(
    "Missing notarization credentials. Configure APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, APPLE_API_KEY + APPLE_API_KEY_ID, or NOTARIZE_KEYCHAIN_PROFILE."
  );
}

function readEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
