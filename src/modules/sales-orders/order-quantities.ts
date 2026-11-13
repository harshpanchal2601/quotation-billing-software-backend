import { decimal, type DecimalInput } from '../../core/money/index.js';
import { AppError } from '../../core/errors/AppError.js';

export function availableOrderQuantity(ordered: DecimalInput, fulfilled: DecimalInput, reserved: DecimalInput) {
  const cap = decimal(fulfilled);
  if (cap.lt(0) || cap.gt(ordered) || decimal(reserved).lt(0) || decimal(reserved).gt(cap)) throw new AppError('Order quantities are inconsistent', 409);
  return cap.sub(reserved);
}
export function fulfillmentStatus(lines: Array<{ quantity: DecimalInput; fulfilled: DecimalInput }>) {
  if (lines.length > 0 && lines.every((line) => decimal(line.fulfilled).eq(line.quantity))) return 'FULFILLED';
  return lines.some((line) => decimal(line.fulfilled).gt(0)) ? 'PARTIALLY_FULFILLED' : 'OPEN';
}
