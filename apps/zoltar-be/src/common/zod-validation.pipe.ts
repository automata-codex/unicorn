import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodSchema, ZodTypeDef } from 'zod';

export class ZodValidationPipe<TOut = unknown> implements PipeTransform<
  unknown,
  TOut
> {
  constructor(private schema: ZodSchema<TOut, ZodTypeDef, unknown>) {}

  transform(value: unknown): TOut {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new BadRequestException(`Validation failed: ${issues}`);
    }
    return result.data;
  }
}
