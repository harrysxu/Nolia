import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main/index.ts", "src/preload/index.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node20",
  sourcemap: true,
  clean: true,
  dts: false,
  external: ["electron"]
});
