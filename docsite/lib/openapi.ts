// Reads openapi/gavel.yaml at build time (server components only) and resolves its local $refs,
// so the /api-reference page is always the spec and can never drift from it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type J = any;

export type Operation = {
  method: string;
  path: string;
  op: J;
  id: string;
};

export type Spec = {
  info: J;
  servers: J[];
  tags: { name: string; description?: string }[];
  groups: { tag: string; description: string; ops: Operation[] }[];
  schemes: Record<string, J>;
  root: J;
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

export function loadSpec(): Spec {
  // The docs build runs with docsite/ as the working directory.
  const file = join(process.cwd(), '..', 'openapi', 'gavel.yaml');
  const root: J = parse(readFileSync(file, 'utf8'));
  const tags: { name: string; description?: string }[] = root.tags ?? [];
  const byTag = new Map<string, Operation[]>();
  for (const t of tags) byTag.set(t.name, []);
  for (const [path, item] of Object.entries<J>(root.paths ?? {})) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const tag: string = (op.tags && op.tags[0]) || 'Other';
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push({ method, path, op, id: op.operationId ?? `${method}-${path}` });
    }
  }
  const groups = [...byTag.entries()]
    .filter(([, ops]) => ops.length > 0)
    .map(([tag, ops]) => ({
      tag,
      description: tags.find((t) => t.name === tag)?.description ?? '',
      ops,
    }));
  return {
    info: root.info,
    servers: root.servers ?? [],
    tags,
    groups,
    schemes: root.components?.securitySchemes ?? {},
    root,
  };
}

/** Name of a local $ref target, for display. */
export function refName(ref: string): string {
  return ref.split('/').pop() ?? ref;
}

/** Follows a local `#/...` reference. A value without $ref is returned as is. */
export function deref(root: J, node: J): J {
  let cur = node;
  let guard = 0;
  while (cur && typeof cur === 'object' && typeof cur.$ref === 'string' && guard < 10) {
    const parts = cur.$ref.replace(/^#\//, '').split('/');
    let next: J = root;
    for (const p of parts) next = next?.[p.replace(/~1/g, '/').replace(/~0/g, '~')];
    cur = next;
    guard += 1;
  }
  return cur;
}
