const fs = require("node:fs");
const path = require("node:path");

const preloadPath = path.resolve(__dirname, "../dist/preload/index.js");
const source = fs.readFileSync(preloadPath, "utf8");
const externalModules = [...source.matchAll(/require\(["']([^"']+)["']\)/g)]
  .map((match) => match[1])
  .filter((moduleId) => moduleId !== "electron");

if (externalModules.length > 0) {
  const modules = [...new Set(externalModules)].join(", ");
  throw new Error(`Sandbox preload contains unsupported runtime dependencies: ${modules}`);
}

console.log("Sandbox preload dependency check passed.");
