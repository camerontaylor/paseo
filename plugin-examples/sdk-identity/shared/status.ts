import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const statusRpc = defineRpc({
  name: "status",
  input: z.object({}),
  output: z.object({ provider: z.string() }),
});
