import { BadRequestException, PipeTransform } from '@nestjs/common';
import { firstError } from '@billing/shared';
import type { ZodTypeAny, z } from 'zod';

/** Validates a request body with a shared zod schema; errors come back as { message } in plain words. */
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}
  transform(value: unknown): z.infer<S> {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) throw new BadRequestException({ message: firstError(r.error), field: r.error.issues[0]?.path.join('.') });
    return r.data;
  }
}
