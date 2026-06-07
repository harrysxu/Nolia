import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  acceleratorForCommand,
  acceleratorForFullScreen,
  createMainWindowOptions,
  resolveDiagnosticsLogRoot,
  resolveWindowIconPath
} from "../src/main/utils/platform";

describe("platform helpers", () => {
  it("keeps macOS diagnostics, window chrome, and shortcuts unchanged", () => {
    expect(resolveDiagnosticsLogRoot("/Users/test", "darwin")).toBe(path.join("/Users/test", "Library", "Logs", "Nolia"));

    const options = createMainWindowOptions(undefined, "darwin", "/tmp/preload.js", "/tmp/icon.png");
    expect(options.titleBarStyle).toBe("hiddenInset");
    expect(options.trafficLightPosition).toEqual({ x: 16, y: 16 });
    expect(options.icon).toBeUndefined();
    expect(options.webPreferences?.preload).toBe("/tmp/preload.js");

    expect(acceleratorForCommand("document.save", "darwin")).toBe("Command+S");
    expect(acceleratorForCommand("view.lineNumbers.toggle", "darwin")).toBe("Command+Shift+L");
    expect(acceleratorForFullScreen("darwin")).toBe("Control+Command+F");
  });

  it("uses Linux-native state paths, window chrome, and shortcuts", () => {
    expect(resolveDiagnosticsLogRoot("/home/test", "linux", {})).toBe(path.join("/home/test", ".local", "state", "Nolia", "logs"));
    expect(resolveDiagnosticsLogRoot("/home/test", "linux", { XDG_STATE_HOME: "/var/state/test" })).toBe(path.join("/var/state/test", "Nolia", "logs"));

    const options = createMainWindowOptions(
      { bounds: { x: 11, y: 22, width: 900, height: 700 } },
      "linux",
      "/tmp/preload.js",
      "/tmp/icon.png"
    );
    expect(options.titleBarStyle).toBeUndefined();
    expect(options.trafficLightPosition).toBeUndefined();
    expect(options.icon).toBe("/tmp/icon.png");
    expect(options.width).toBe(900);
    expect(options.height).toBe(700);

    expect(acceleratorForCommand("document.save", "linux")).toBe("Control+S");
    expect(acceleratorForCommand("view.lineNumbers.toggle", "linux")).toBe("Control+Shift+L");
    expect(acceleratorForFullScreen("linux")).toBe("F11");
  });

  it("resolves Linux window icons from packaged resources before development assets", () => {
    const existing = new Set([
      path.join("/opt/Nolia/resources", "assets", "icon.png"),
      path.join("/workspace/Nolia", "build", "icon.png")
    ]);

    expect(resolveWindowIconPath(
      "linux",
      "/opt/Nolia/resources",
      "/workspace/Nolia",
      (filePath) => existing.has(filePath)
    )).toBe(path.join("/opt/Nolia/resources", "assets", "icon.png"));

    existing.delete(path.join("/opt/Nolia/resources", "assets", "icon.png"));
    expect(resolveWindowIconPath(
      "linux",
      "/opt/Nolia/resources",
      "/workspace/Nolia",
      (filePath) => existing.has(filePath)
    )).toBe(path.join("/workspace/Nolia", "build", "icon.png"));

    expect(resolveWindowIconPath(
      "darwin",
      "/Applications/Nolia.app/Contents/Resources",
      "/workspace/Nolia",
      () => true
    )).toBeUndefined();
  });
});
