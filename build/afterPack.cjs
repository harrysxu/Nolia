const fs = require("node:fs/promises");
const path = require("node:path");
const ResEdit = require("resedit");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const appInfo = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  const iconPath = path.join(context.packager.projectDir, "build", "icon.ico");

  await updateWindowsExecutableResources(exePath, iconPath, appInfo);
};

async function updateWindowsExecutableResources(exePath, iconPath, appInfo) {
  const exe = ResEdit.NtExecutable.from(await fs.readFile(exePath));
  const resources = ResEdit.NtExecutableResource.from(exe);
  const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  const iconGroup = iconGroups[0];
  const lang = iconGroup?.lang ?? 1033;
  const iconGroupId = iconGroup?.id ?? 1;
  const iconFile = ResEdit.Data.IconFile.from(await fs.readFile(iconPath));

  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    iconGroupId,
    lang,
    iconFile.icons.map((icon) => icon.data)
  );

  updateVersionInfo(resources.entries, appInfo, lang);
  resources.outputResource(exe);
  await fs.writeFile(exePath, Buffer.from(exe.generate()));
}

function updateVersionInfo(entries, appInfo, fallbackLang) {
  const versionEntries = ResEdit.Resource.VersionInfo.fromEntries(entries);
  const versionInfo =
    versionEntries[0] ??
    ResEdit.Resource.VersionInfo.create(fallbackLang, {}, [
      {
        lang: fallbackLang,
        codepage: 1200,
        values: {}
      }
    ]);

  const language =
    versionInfo.getAllLanguagesForStringValues()[0] ??
    versionInfo.getAvailableLanguages()[0] ?? {
      lang: fallbackLang,
      codepage: 1200
    };

  const fileVersion = normalizeWindowsVersion(appInfo.shortVersion || appInfo.buildVersion || appInfo.version);
  const productVersion = normalizeWindowsVersion(appInfo.shortVersionWindows || appInfo.getVersionInWeirdWindowsForm());
  versionInfo.setFileVersion(fileVersion, language.lang);
  versionInfo.setProductVersion(productVersion, language.lang);

  versionInfo.setStringValues(
    language,
    omitEmpty({
      FileDescription: appInfo.productName,
      ProductName: appInfo.productName,
      InternalName: appInfo.productFilename,
      OriginalFilename: `${appInfo.productFilename}.exe`,
      LegalCopyright: appInfo.copyright,
      CompanyName: appInfo.companyName
    }),
    true
  );
  versionInfo.outputToResourceEntries(entries);
}

function normalizeWindowsVersion(version) {
  const parts = String(version ?? "0.0.0")
    .split(".")
    .map((part) => {
      const value = Number.parseInt(part, 10);
      return Number.isFinite(value) && value >= 0 ? Math.min(value, 65535) : 0;
    });

  while (parts.length < 4) {
    parts.push(0);
  }

  return parts.slice(0, 4).join(".");
}

function omitEmpty(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === "string" && value.length > 0));
}
