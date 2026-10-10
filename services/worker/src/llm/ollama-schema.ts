// Small local models can start a string and never close it: qwen2.5:3b copied the whole contract into
// document_type.quote, then looped on one sentence until num_predict ran out. Ollama compiles the
// schema into a grammar, so a length limit there forces the string to close. Only ollama gets these;
// zod validation is unchanged, and a quote cut at 300 chars is still an exact substring for grounding.
// No repeat_penalty instead: it punishes the braces and quotes json repeats by design.
const CAPS: Record<string, Record<string, number>> = {
  quote: { maxLength: 300 },
  explanation: { maxLength: 400 },
  risk_clauses: { maxItems: 12 },
};

export function capSchemaForOllama(node: unknown, key?: string): unknown {
  if (Array.isArray(node)) return node.map((child) => capSchemaForOllama(child));
  if (node === null || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] =
      k === "properties" && v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v).map(([name, sub]) => [name, capSchemaForOllama(sub, name)]),
          )
        : capSchemaForOllama(v);
  }
  // key is only set for direct children of a properties map, so "quote" here is always a field name.
  const cap = key === undefined ? undefined : CAPS[key];
  return cap === undefined ? out : { ...out, ...cap };
}

type SchemaNode = Record<string, unknown>;

function isNode(value: unknown): value is SchemaNode {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Enums sit on the node itself or, for nullable ones, inside one of its anyOf options.
function enumValues(node: SchemaNode): unknown[] | undefined {
  if (Array.isArray(node.enum)) return node.enum;
  if (!Array.isArray(node.anyOf)) return undefined;
  return node.anyOf.find(
    (opt): opt is SchemaNode & { enum: unknown[] } => isNode(opt) && Array.isArray(opt.enum),
  )?.enum;
}

function lineText(node: SchemaNode): string | undefined {
  const parts: string[] = [];
  if (typeof node.description === "string") parts.push(node.description);
  const values = enumValues(node);
  if (values !== undefined) parts.push(`one of: ${values.join(", ")}`);
  return parts.length > 0 ? parts.join(". ") : undefined;
}

interface Entry {
  path: string;
  key: string;
  text: string;
}

function collectEntries(node: SchemaNode, path: string, out: Entry[]): void {
  if (isNode(node.properties)) {
    for (const [key, child] of Object.entries(node.properties)) {
      if (!isNode(child)) continue;
      const childPath = path === "" ? key : `${path}.${key}`;
      const text = lineText(child);
      if (text !== undefined) out.push({ path: childPath, key, text });
      collectEntries(child, childPath, out);
    }
  }
  if (isNode(node.items)) collectEntries(node.items, `${path}[]`, out);
  if (Array.isArray(node.anyOf)) {
    for (const opt of node.anyOf) if (isNode(opt)) collectEntries(opt, path, out);
  }
}

// Ollama only uses the schema as a grammar; the model never reads it, so descriptions and enum
// meanings would be invisible. This turns them into one line per field for the system prompt. The
// grammar already enforces the structure, so the full schema (~7000 chars) isn't needed. A line that
// repeats under every field (quote, confidence) is written once as "*.key".
export function buildFieldGuide(schema: unknown): string {
  if (!isNode(schema)) return "";
  const entries: Entry[] = [];
  collectEntries(schema, "", entries);

  const counts = new Map<string, number>();
  for (const { key, text } of entries) {
    const id = `${key}\u0000${text}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const lines: string[] = [];
  const written = new Set<string>();
  for (const { path, key, text } of entries) {
    const id = `${key}\u0000${text}`;
    if (written.has(id)) continue;
    written.add(id);
    lines.push(`${(counts.get(id) ?? 0) > 1 ? `*.${key}` : path}: ${text}`);
  }
  return lines.join("\n");
}
