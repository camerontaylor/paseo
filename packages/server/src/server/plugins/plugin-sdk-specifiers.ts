import { PLUGIN_SDK_PACKAGE_NAMES } from "@getpaseo/plugin";

// These entries are supplied by the host and remain external in author bundles.
export const PLUGIN_CLIENT_ONLY_SDK_SPECIFIERS = PLUGIN_SDK_PACKAGE_NAMES.flatMap((name) => [
  `${name}/client`,
  `${name}/client/ui`,
  `${name}/client/react-native`,
]);

const PLUGIN_SERVER_ONLY_SDK_SPECIFIERS = PLUGIN_SDK_PACKAGE_NAMES.flatMap((name) => [
  `${name}/server`,
  `${name}/server/provider`,
  `${name}/server/usage`,
  `${name}/server/acp`,
]);

export const PLUGIN_SDK_SPECIFIERS = [
  ...PLUGIN_SDK_PACKAGE_NAMES,
  ...PLUGIN_SERVER_ONLY_SDK_SPECIFIERS,
  ...PLUGIN_CLIENT_ONLY_SDK_SPECIFIERS,
] as const;

export function isPluginClientOnlySdkSpecifier(name: string): boolean {
  return (PLUGIN_CLIENT_ONLY_SDK_SPECIFIERS as readonly string[]).includes(name);
}

export function isPluginServerOnlySdkSpecifier(name: string): boolean {
  return (PLUGIN_SERVER_ONLY_SDK_SPECIFIERS as readonly string[]).includes(name);
}
