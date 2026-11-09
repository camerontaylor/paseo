// Preserve the public import identity through fork packaging, which rewrites
// quoted @getpaseo/* module paths to the fork scope. Both names use host modules.
export const PLUGIN_SDK_PACKAGE_NAMES = [
  ["@getpaseo", "plugin"].join("/"),
  "@camerontaylor/paseo-plugin",
  // The release transform rewrites this entry to the installed host SDK name.
  "@getpaseo/plugin",
] as const;

export function pluginSdkEntry(specifier: string): string | null {
  for (const name of PLUGIN_SDK_PACKAGE_NAMES) {
    if (specifier === name) return "";
    if (specifier.startsWith(`${name}/`)) return specifier.slice(name.length);
  }
  return null;
}
