import { AppError } from '../../core/errors/AppError.js';
import type { ItemSpecification } from './items.types.js';

export function validateAndCleanSpecifications(rawSpecs: unknown): ItemSpecification[] {
  if (rawSpecs === undefined || rawSpecs === null) {
    return [];
  }

  if (!Array.isArray(rawSpecs)) {
    throw new AppError('Specifications must be an array of label and value objects', 400);
  }

  if (rawSpecs.length > 50) {
    throw new AppError('Specifications cannot exceed 50 entries', 400);
  }

  const seenLabels = new Set<string>();
  const cleaned: ItemSpecification[] = [];

  for (const item of rawSpecs) {
    if (typeof item !== 'object' || item === null) {
      throw new AppError('Each specification entry must be an object containing label and value', 400);
    }

    const record = item as Record<string, unknown>;
    if (typeof record.label !== 'string' || typeof record.value !== 'string') {
      throw new AppError('Each specification entry must contain string label and string value', 400);
    }

    const label = record.label.trim();
    const value = record.value.trim();

    if (label.length === 0 || label.length > 100) {
      throw new AppError('Specification label must be between 1 and 100 characters', 400);
    }

    if (value.length === 0 || value.length > 1000) {
      throw new AppError('Specification value must be between 1 and 1000 characters', 400);
    }

    const lowerLabel = label.toLowerCase();
    if (seenLabels.has(lowerLabel)) {
      throw new AppError(`Duplicate specification label "${label}" is not allowed`, 400);
    }

    seenLabels.add(lowerLabel);
    cleaned.push({ label, value });
  }

  return cleaned;
}

export function parseSpecificationsJson(rawJson: unknown): ItemSpecification[] {
  if (!Array.isArray(rawJson)) return [];
  return rawJson
    .filter((item): item is { label: string; value: string } => (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).label === 'string' &&
      typeof (item as Record<string, unknown>).value === 'string'
    ))
    .map((item) => ({ label: item.label.trim(), value: item.value.trim() }));
}
