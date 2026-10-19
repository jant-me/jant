/**
 * Request Validation Middleware
 *
 * An API route names what it accepts in its registration, as Hono's own
 * `validator()` does:
 *
 * ```ts
 * postsApiRoutes.post("/", requireAuthApi(), validate("json", CreatePostApiSchema), async (c) => {
 *   const body = c.req.valid("json");
 * ```
 *
 * The schema then sits on a handler of the route, so `createApp().routes`
 * says what each route accepts: the public surface manifest freezes request
 * fields from there, and they are the names the route checks, not a copy.
 *
 * Errors are the ones `parseValidated` throws, a `ValidationError` (400) with
 * the first issue as its message. Unlike Hono's `validator("json")`, a JSON
 * body is read whatever its `Content-Type`.
 */

import type { Context, Env, MiddlewareHandler } from "hono";
import { z } from "zod";
import { ValidationError } from "../lib/errors.js";
import { parseValidated, readJsonBody } from "../lib/schemas.js";

/** Where a request carries what a schema checks. */
export type RequestTarget = "json" | "query" | "form";

/** What a route declared it accepts. */
export interface DeclaredRequest {
  target: RequestTarget;
  schema: z.ZodType;
}

const declared = new WeakMap<object, DeclaredRequest>();

/** A field's schema without the wrappers that only make it optional. */
function unwrapOptional(schema: z.ZodType): z.ZodType {
  return schema instanceof z.ZodOptional ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodNullable
    ? unwrapOptional(schema.unwrap() as z.ZodType)
    : schema;
}

/**
 * The query as a plain object: each parameter's first value, as
 * `c.req.query()` gives it, and every value of one the schema takes as an
 * array (`?id=a&id=b`).
 */
function readQuery(c: Context, schema: z.ZodType): Record<string, unknown> {
  const query: Record<string, unknown> = c.req.query();
  if (schema instanceof z.ZodObject) {
    for (const [name, field] of Object.entries(schema.shape)) {
      const values = c.req.queries(name);
      if (values && unwrapOptional(field as z.ZodType) instanceof z.ZodArray) {
        query[name] = values;
      }
    }
  }
  return query;
}

/** A multipart or URL-encoded body as a plain object: each field's first value. */
async function readForm(c: Context): Promise<Record<string, unknown>> {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    throw new ValidationError(
      "The request body isn't valid form data. Send it as multipart/form-data.",
    );
  }
  const form: Record<string, unknown> = {};
  for (const [name, value] of formData) {
    if (!Object.hasOwn(form, name)) form[name] = value;
  }
  return form;
}

/**
 * Validate one part of a request against a schema before the handler runs.
 *
 * @param target - `json` for a JSON body, `query` for the query string,
 *   `form` for a multipart or URL-encoded body
 * @param schema - The schema the route accepts
 * @returns Middleware that stores the parsed value for `c.req.valid(target)`
 * @example
 * ```ts
 * routes.get("/", validate("query", ListPostsQuerySchema), async (c) => {
 *   const { cursor, limit } = c.req.valid("query");
 * });
 * ```
 */
export function validate<
  Target extends RequestTarget,
  Schema extends z.ZodType,
  P extends string,
>(
  target: Target,
  schema: Schema,
): MiddlewareHandler<Env, P, { out: { [K in Target]: z.output<Schema> } }> {
  const middleware: MiddlewareHandler<
    Env,
    P,
    { out: { [K in Target]: z.output<Schema> } }
  > = async (c, next) => {
    const input =
      target === "json"
        ? await readJsonBody(c)
        : target === "query"
          ? readQuery(c, schema)
          : await readForm(c);
    c.req.addValidatedData(target, parseValidated(schema, input) as object);
    await next();
  };
  declared.set(middleware, { target, schema });
  return middleware;
}

/**
 * What a handler made by {@link validate} checks.
 *
 * @param handler - Any route handler, e.g. from `createApp().routes`
 * @returns Its target and schema, or `undefined` for any other handler
 * @example
 * ```ts
 * declaredRequest(validate("json", SetLanguageSchema))?.target; // "json"
 * ```
 */
export function declaredRequest(handler: unknown): DeclaredRequest | undefined {
  return typeof handler === "function" ? declared.get(handler) : undefined;
}
