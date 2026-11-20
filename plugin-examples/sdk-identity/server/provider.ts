import type { ProviderRegistration } from "@getpaseo/plugin/server/provider";

export const provider: ProviderRegistration = {
  id: "sdk-identity-provider",
  label: "SDK identity provider",
  async connect(request) {
    return {
      version: request.versions[0] ?? 1,
      capabilities: [],
      async send() {},
      onEvent() {
        return () => {};
      },
      async close() {},
    };
  },
};
