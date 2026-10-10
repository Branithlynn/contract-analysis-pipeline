import mammoth from "mammoth";
import type { Logger } from "@nexus/shared/node";

export async function parseDocx(path: string, logger: Logger): Promise<string> {
  const { value, messages } = await mammoth.extractRawText({ path });
  // Mostly unsupported styles or elements. Useful when a document comes out oddly, not worth a warning.
  for (const { type, message } of messages) logger.debug({ type, message }, "mammoth message");
  return value;
}
