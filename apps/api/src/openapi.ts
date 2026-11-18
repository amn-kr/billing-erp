/**
 * The server's exact description (OpenAPI 3.1), made from the server's own code (step 8.1d, owner
 * 18 Nov 2026): every address, its method, its path and query values, whether it needs sign-in,
 * and the exact shape of what it accepts (from the same shared zod rules that check the input).
 * The phone app's code for talking to the server is made from it.
 *
 * Answers are described as plain JSON for now; their shapes are added as the phone screens need them.
 * `pnpm --filter @billing/api openapi` writes apps/api/openapi.json; a test fails when it is out of date.
 */
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA, SSE_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { CLIENT_HEADER, PASSCODE_HEADER, REFRESH_HEADER, REQUEST_KEY_HEADER } from '@billing/shared';
import type { ZodTypeAny } from 'zod';
import { ZodObject } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AppModule } from './app.module';
import { IS_PUBLIC } from './common/decorators';
import { ZodPipe } from './common/zod.pipe';

type Json = Record<string, unknown>;
interface Arg { index: number; data?: string; pipes?: unknown[] }
type Ctor = new (...a: never[]) => object;

const VERB: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.GET]: 'get', [RequestMethod.POST]: 'post', [RequestMethod.PUT]: 'put', [RequestMethod.DELETE]: 'delete', [RequestMethod.PATCH]: 'patch',
};

const schemaOf = (pipes: unknown[] | undefined): ZodTypeAny | null => {
  const p = (pipes ?? []).find((x) => x instanceof ZodPipe) as unknown as { schema: ZodTypeAny } | undefined;
  return p?.schema ?? null;
};
const json = (s: ZodTypeAny): Json => {
  const out = zodToJsonSchema(s, { target: 'openApi3', $refStrategy: 'none' }) as Json;
  delete out.$schema;
  return out;
};
const join = (...parts: string[]) => '/' + parts.flatMap((p) => p.split('/')).filter(Boolean).join('/');
const words = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

export function describeApi(): Json {
  const controllers = (Reflect.getMetadata('controllers', AppModule) as Ctor[]) ?? [];
  const paths: Record<string, Record<string, Json>> = {};
  for (const C of controllers) {
    const base = String(Reflect.getMetadata(PATH_METADATA, C) ?? '');
    const classPublic = !!Reflect.getMetadata(IS_PUBLIC, C);
    const tag = C.name.replace(/Controller$/, '');
    for (const name of Object.getOwnPropertyNames(C.prototype)) {
      if (name === 'constructor') continue;
      const fn = (C.prototype as Record<string, unknown>)[name];
      if (typeof fn !== 'function') continue;
      const sub = Reflect.getMetadata(PATH_METADATA, fn) as string | string[] | undefined;
      const m = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
      if (sub === undefined || m === undefined || !VERB[m]) continue;
      const route = join('api', base, Array.isArray(sub) ? sub[0]! : sub);
      const path = route.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      const verb = VERB[m]!;
      const isPublic = classPublic || !!Reflect.getMetadata(IS_PUBLIC, fn);
      const sse = !!Reflect.getMetadata(SSE_METADATA, fn);
      const code = (Reflect.getMetadata(HTTP_CODE_METADATA, fn) as number | undefined) ?? (verb === 'post' ? 201 : 200);

      const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, C, name) ?? {}) as Record<string, Arg>;
      const parameters: Json[] = [...route.matchAll(/:([A-Za-z0-9_]+)/g)].map((x) => ({ name: x[1], in: 'path', required: true, schema: { type: 'string' } }));
      let body: Json | null = null;
      for (const [key, a] of Object.entries(args)) {
        const type = Number(key.split(':')[0]);
        const s = schemaOf(a.pipes);
        if (type === RouteParamtypes.BODY) body = s ? json(s) : { type: 'object', description: 'Checked by the server itself.' };
        if (type === RouteParamtypes.QUERY) {
          if (a.data) parameters.push({ name: a.data, in: 'query', required: false, schema: s ? json(s) : { type: 'string' } });
          else if (s instanceof ZodObject) {
            const props = (json(s).properties ?? {}) as Record<string, Json>;
            const req = new Set((json(s).required ?? []) as string[]);
            for (const [k, v] of Object.entries(props)) parameters.push({ name: k, in: 'query', required: req.has(k), schema: v });
          }
        }
      }
      // the extra headers some saves take
      if (verb !== 'get') parameters.push({ $ref: '#/components/parameters/RequestKey' });

      const op: Json = {
        operationId: `${tag}_${name}`,
        tags: [tag],
        summary: words(name),
        ...(parameters.length ? { parameters } : {}),
        ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: body } } } } : {}),
        responses: {
          [String(code)]: sse
            ? { description: 'Server-sent events (live news).', content: { 'text/event-stream': { schema: { type: 'string' } } } }
            : code === 204
              ? { description: 'Done.' }
              : { description: 'Done.', content: { 'application/json': { schema: {} } } },
          default: { $ref: '#/components/responses/Problem' },
        },
        ...(isPublic ? { security: [] } : {}),
      };
      (paths[path] ??= {})[verb] = op;
    }
  }
  const sorted = Object.fromEntries(Object.keys(paths).sort().map((p) => [p, Object.fromEntries(Object.keys(paths[p]!).sort().map((v) => [v, paths[p]![v]]))]));
  return {
    openapi: '3.1.0',
    info: {
      title: 'Shop Billing App server',
      version: '1',
      description: 'Made from the server code (apps/api/src/openapi.ts). Amounts are strings with 2 decimals; dates are YYYY-MM-DD (Asia/Kolkata).',
    },
    servers: [{ url: '/' }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'The access token from sign-in (15 minutes).' } },
      parameters: {
        RequestKey: { name: REQUEST_KEY_HEADER, in: 'header', required: false, schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,100}$' }, description: 'One-time key: the same save sent again is saved once.' },
        Client: { name: CLIENT_HEADER, in: 'header', required: false, schema: { type: 'string', enum: ['phone'] }, description: 'The phone app: sign-in answers carry refreshToken instead of a cookie.' },
        RefreshToken: { name: REFRESH_HEADER, in: 'header', required: false, schema: { type: 'string' }, description: 'The phone’s refresh token, for /api/auth/refresh and /api/auth/logout.' },
        Passcode: { name: PASSCODE_HEADER, in: 'header', required: false, schema: { type: 'string' }, description: 'The transaction passcode, when the shop has it switched on.' },
      },
      responses: {
        Problem: {
          description: 'Refused, with a message in plain words.',
          content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, code: { type: 'string' }, field: { type: 'string' } }, required: ['message'] } } },
        },
      },
    },
    paths: sorted,
  };
}
