import { AppError } from '../errors/AppError.js';
import { escapeHtml } from '../html/escape-html.js';

// Literal text only: no property traversal, expressions, HTML or executable syntax.
export const TEMPLATE_VARIABLES = ['businessName', 'documentNumber', 'entityType', 'status', 'currency', 'total'] as const;
export type TemplateVariables = Partial<Record<(typeof TEMPLATE_VARIABLES)[number], string>>;
const variable = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

export function validatePlaceholders(template: string) {
  if (template.length > 10000) throw new AppError('Template is too long', 400);
  if (/\{\{\{|\}\}\}/.test(template)) throw new AppError('Invalid placeholder syntax', 400);
  for (const match of template.matchAll(variable)) {
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(match[1]!)) throw new AppError('Template contains an unsupported variable', 400);
  }
  if (template.replace(variable, '').includes('{{') || template.replace(variable, '').includes('}}')) throw new AppError('Invalid placeholder syntax', 400);
  return template;
}

export function renderTextTemplate(template: string, values: TemplateVariables) {
  validatePlaceholders(template);
  return template.replace(variable, (_match, key: keyof TemplateVariables) => values[key] ?? '');
}

export function renderEscapedTemplate(template: string, values: TemplateVariables) {
  return escapeHtml(renderTextTemplate(template, values));
}
