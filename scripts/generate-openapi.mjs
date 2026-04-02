#!/usr/bin/env node
/**
 * Generates public/openapi.yaml from TSDoc comments in src/app/api/**\/route.ts.
 *
 * The script reads every exported HTTP-method handler (GET, POST, PATCH,
 * DELETE, PUT), extracts its JSDoc block, and converts it into an OpenAPI 3.0
 * operation object.  Path parameters are derived from the file path
 * ([param] → {param}).  Query params and request-body fields are parsed from
 * the @param req bullet list.  @returns tags supply response descriptions.
 *
 * Run directly:   node scripts/generate-openapi.mjs
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── file discovery ────────────────────────────────────────────────────────────

function findRouteFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findRouteFiles(full, acc);
    else if (entry.name === 'route.ts') acc.push(full);
  }
  return acc;
}

// ── path derivation ───────────────────────────────────────────────────────────

/** src/app/api/climbs/[id]/route.ts  →  /api/climbs/{id} */
function fileToApiPath(filePath) {
  return filePath
    .replace(/\\/g, '/')
    .replace(/.*\/src\/app/, '')
    .replace(/\/route\.ts$/, '')
    .replace(/\[([^\]]+)\]/g, '{$1}');
}

// ── JSDoc extraction ──────────────────────────────────────────────────────────

/** Find every `/** … *\/ export async function METHOD` pair in source.
 *
 * The inner pattern `([^*]|\*(?!\/))*` matches a single JSDoc block without
 * crossing `*\/` boundaries, ensuring we capture the function-level JSDoc
 * rather than the module-level JSDoc at the top of the file.
 */
function extractHandlers(source) {
  const handlers = [];
  // Match exactly one JSDoc block (stops at the first */) followed immediately
  // by the export declaration (only whitespace between them).
  const re = /\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*export\s+async\s+function\s+(GET|POST|PATCH|DELETE|PUT)\b/g;
  for (const m of source.matchAll(re)) {
    handlers.push({ rawJsdoc: m[1], method: m[2] });
  }
  return handlers;
}

/** Strip the leading ` * ` decoration from each line. */
function cleanJsdoc(raw) {
  return raw.split('\n').map(l => l.replace(/^\s*\*\s?/, '')).join('\n');
}

function parseJsdoc(raw) {
  const text = cleanJsdoc(raw);
  const lines = text.split('\n');

  const descLines = [];
  const tags = [];
  let cur = null;

  for (const line of lines) {
    if (/^\s*@\w+/.test(line)) {
      if (cur) tags.push(cur);
      cur = { tag: (line.match(/^\s*@(\w+)/) || ['', ''])[1], lines: [line] };
    } else if (cur) {
      cur.lines.push(line);
    } else {
      descLines.push(line);
    }
  }
  if (cur) tags.push(cur);

  const fullDesc = descLines.join('\n').trim();

  // First paragraph → summary, strip markdown bold/backticks, collapse newlines
  const summary = (fullDesc.split(/\n\s*\n/)[0] || '')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();

  const authRequired = /\*\*Authentication:\*\*\s+Required/i.test(fullDesc);
  // Session-only when doc says "session cookie." without mentioning ?token
  const sessionOnly =
    /session\s+cookie\s*\./i.test(fullDesc) && !/\?\s*token/i.test(fullDesc);

  return { summary, tags, authRequired, sessionOnly };
}

// ── parameter extraction ──────────────────────────────────────────────────────

/** Match lines like:  - `name` *(required)* — description */
const BULLET_RE = /^\s*-\s+`([^`]+)`(?:\s+\*\(([^)]+)\)\*)?\s*[—–-]\s*(.+)/gm;

function extractBullets(text) {
  const params = [];
  for (const m of text.matchAll(BULLET_RE)) {
    params.push({
      name: m[1],
      required: m[2] === 'required',
      description: m[3]
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .trim(),
    });
  }
  return params;
}

function extractParamInfo(tags, method) {
  const reqTag = tags.find(
    t => t.tag === 'param' && /req|_req/.test(t.lines[0]),
  );
  if (!reqTag) return { queryParams: [], bodyFields: [] };

  const allText = reqTag.lines.join('\n');
  const params = extractBullets(allText);
  const isBodyMethod = ['POST', 'PATCH', 'PUT'].includes(method);
  const hasBodyHint  = /body|JSON/i.test(allText);
  const hasQueryHint = /query param/i.test(allText);

  if (!isBodyMethod || hasQueryHint) return { queryParams: params, bodyFields: [] };
  if (hasBodyHint || !hasQueryHint)  return { queryParams: [], bodyFields: params };
  return { queryParams: params, bodyFields: [] };
}

// ── response extraction ───────────────────────────────────────────────────────

function extractResponses(tags) {
  const responses = {};

  for (const tag of tags.filter(t => t.tag === 'returns')) {
    const raw = tag.lines
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/^\s*@returns\s*/, '')
      .replace(/`([^`]+)`/g, '$1')
      .trim();

    // Take only the first sentence / line for the description
    const desc = raw.split(/\\n|\n/)[0].trim();

    // Pattern 1: starts with 3-digit status code, e.g. "404 if not found"
    const codeFirst = desc.match(/^(\d{3})\s+(.*)/);
    if (codeFirst) {
      responses[codeFirst[1]] = codeFirst[2]
        .replace(/^(if|on|when)\s+/i, '')
        .trim() || codeFirst[1];
      continue;
    }

    // Pattern 2: "… with status 201" anywhere in text
    const statusMention = desc.match(/\bstatus\s+(\d{3})\b/);
    if (statusMention && !responses[statusMention[1]]) {
      responses[statusMention[1]] = desc;
      continue;
    }

    // Default: first success response
    if (!responses['200'] && !responses['201']) {
      responses['200'] = desc;
    }
  }

  return responses;
}

// ── path param extraction ─────────────────────────────────────────────────────

function pathParamNames(apiPath) {
  return [...apiPath.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
}

// ── operation builder ─────────────────────────────────────────────────────────

function buildOperation(method, apiPath, rawJsdoc) {
  const { summary, tags, authRequired, sessionOnly } = parseJsdoc(rawJsdoc);
  const { queryParams, bodyFields } = extractParamInfo(tags, method);
  const responseCodes = extractResponses(tags);
  const ppNames = pathParamNames(apiPath);

  // Build parameters array (path params first, then query params)
  const parameters = [
    ...ppNames.map(name => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    })),
    ...queryParams.map(p => ({
      name: p.name,
      in: 'query',
      required: p.required || false,
      ...(p.description ? { description: p.description } : {}),
      schema: { type: 'string' },
    })),
  ];

  // Convert plain-string response values to OpenAPI response objects
  const responses = {};
  for (const [code, val] of Object.entries(responseCodes)) {
    responses[code] = typeof val === 'string' ? { description: val } : val;
  }
  // Ensure at least one success response
  if (!responses['200'] && !responses['201'] && !responses['204']) {
    const defaultCode =
      method === 'POST' ? '201' : method === 'DELETE' ? '204' : '200';
    responses[defaultCode] = { description: 'Success' };
  }

  const op = {
    summary: summary || `${method} ${apiPath}`,
    ...(parameters.length ? { parameters } : {}),
    responses,
  };

  // Request body for mutating methods
  if (['POST', 'PATCH', 'PUT'].includes(method) && bodyFields.length > 0) {
    const required = bodyFields.filter(f => f.required).map(f => f.name);
    const properties = Object.fromEntries(
      bodyFields.map(f => [
        f.name,
        { type: 'string', ...(f.description ? { description: f.description } : {}) },
      ]),
    );
    op.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            ...(required.length ? { required } : {}),
            properties,
          },
        },
      },
    };
  }

  // Security
  if (authRequired) {
    op.security = sessionOnly
      ? [{ cookieAuth: [] }]
      : [{ apiKeyAuth: [] }, { cookieAuth: [] }];
  }

  return op;
}

// ── minimal YAML serializer ───────────────────────────────────────────────────
// Handles the subset of YAML needed for OpenAPI 3.0 objects.

const QUOTE_START  = /^[-?:,[\]{}#&*!|>'"%@`~]/;
const QUOTE_INLINE = /: | #|\n/;
const NULL_BOOL    = /^(null|true|false|yes|no|on|off)$/i;
const IS_NUMBER    = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function yamlStr(s) {
  if (s === '') return '""';
  if (
    QUOTE_START.test(s) ||
    QUOTE_INLINE.test(s) ||
    NULL_BOOL.test(s) ||
    IS_NUMBER.test(s) ||
    /\s$/.test(s)
  ) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
  }
  return s;
}

function yamlDump(val, depth = 0) {
  const pad = '  '.repeat(depth);

  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return String(val);
  if (typeof val === 'number')  return String(val);
  if (typeof val === 'string')  return yamlStr(val);

  if (Array.isArray(val)) {
    if (!val.length) return '[]';
    return val.map(item => {
      const rendered = yamlDump(item, depth + 1);
      if (typeof item === 'object' && item !== null) {
        const lines = rendered.split('\n');
        const first = pad + '- ' + lines[0].trimStart();
        const rest  = lines.slice(1).join('\n');
        return rest ? first + '\n' + rest : first;
      }
      return pad + '- ' + rendered;
    }).join('\n');
  }

  // Object
  const entries = Object.entries(val);
  if (!entries.length) return '{}';
  return entries.map(([k, v]) => {
    const key = yamlStr(k);
    if (v === null || v === undefined || typeof v !== 'object') {
      return pad + key + ': ' + yamlDump(v, depth + 1);
    }
    if (Array.isArray(v)) {
      if (!v.length) return pad + key + ': []';
      return pad + key + ':\n' + yamlDump(v, depth + 1);
    }
    if (!Object.keys(v).length) return pad + key + ': {}';
    return pad + key + ':\n' + yamlDump(v, depth + 1);
  }).join('\n');
}

// ── main ──────────────────────────────────────────────────────────────────────

function generate() {
  const apiDir = join(ROOT, 'src', 'app', 'api');
  const files  = findRouteFiles(apiDir);
  const paths  = {};

  for (const file of files) {
    const apiPath  = fileToApiPath(file);
    const source   = readFileSync(file, 'utf-8');
    const handlers = extractHandlers(source);
    if (!handlers.length) continue;

    if (!paths[apiPath]) paths[apiPath] = {};
    for (const { rawJsdoc, method } of handlers) {
      paths[apiPath][method.toLowerCase()] = buildOperation(method, apiPath, rawJsdoc);
    }
  }

  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'allaboard.dev API',
      version: '1.0',
      description: 'REST API for the Allaboard board-climbing community platform.',
    },
    servers: [
      { url: 'https://www.allaboard.dev', description: 'Production (www)' },
      { url: 'https://allaboard.dev',     description: 'Production (apex)' },
      { url: 'http://localhost:3000',     description: 'Local development' },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'allaboard_session',
          description: 'iron-session encrypted cookie set after Google OAuth login.',
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'query',
          name: 'token',
          description: 'Personal API token from your profile page. Pass as ?token=<value>.',
        },
      },
    },
    paths,
  };

  const yaml    = yamlDump(spec) + '\n';
  const outPath = join(ROOT, 'public', 'openapi.yaml');
  writeFileSync(outPath, yaml);
  console.log(
    `[generate-openapi] ✓ ${outPath}` +
    ` (${files.length} route files, ${Object.keys(paths).length} paths)`,
  );

  // Copy the Scalar stylesheet to public/ so ScalarClient can inject and
  // remove it dynamically — preventing it from bleeding into other pages.
  const scalarCssSrc  = join(ROOT, 'node_modules', '@scalar', 'api-reference-react', 'dist', 'style.css');
  const scalarCssDest = join(ROOT, 'public', 'scalar-styles.css');
  if (existsSync(scalarCssSrc)) {
    copyFileSync(scalarCssSrc, scalarCssDest);
    console.log(`[generate-openapi] ✓ ${scalarCssDest}`);
  }
}

generate();
