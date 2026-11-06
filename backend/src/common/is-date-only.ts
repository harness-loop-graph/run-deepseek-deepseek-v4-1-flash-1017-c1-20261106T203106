import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { isDateOnly } from './dates';

/**
 * Accepts only real calendar dates in `YYYY-MM-DD` form, so invalid values such
 * as 2026-13-01 are rejected at the boundary with 422 instead of reaching SQL.
 */
export function IsDateOnly(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isDateOnly',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && isDateOnly(value);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a valid date in YYYY-MM-DD format`;
        },
      },
    });
  };
}
