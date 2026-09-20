import { en } from './en.mjs';
import { ja } from './ja.mjs';

export const CATALOGS = { en, ja };
export const SUPPORTED_LOCALES = Object.keys(CATALOGS);
export const DEFAULT_LOCALE = 'en';

const MESSAGE_TAG = '__msg';

/**
 * Build a locale-independent message descriptor. Analysis code emits these
 * instead of user-facing prose so that a single audit can be rendered in any
 * supported locale without re-running the scan.
 */
export function msg(id, params) {
  return params === undefined ? { [MESSAGE_TAG]: id } : { [MESSAGE_TAG]: id, params };
}

export function isMessage(value) {
  return Boolean(value) && typeof value === 'object' && typeof value[MESSAGE_TAG] === 'string';
}

export function messageId(value) {
  return isMessage(value) ? value[MESSAGE_TAG] : null;
}

/** Normalize a POSIX locale string such as `ja_JP.UTF-8` to a supported tag. */
export function normalizeLocale(value) {
  if (typeof value !== 'string') return null;
  const tag = value.trim().toLowerCase().split('.')[0].replace('_', '-');
  if (!tag || tag === 'c' || tag === 'posix') return null;
  if (SUPPORTED_LOCALES.includes(tag)) return tag;
  const base = tag.split('-')[0];
  return SUPPORTED_LOCALES.includes(base) ? base : null;
}

/**
 * Locale precedence: explicit `--lang`, then NEXT_OR_NOT_LANG, then the
 * standard POSIX variables, then English. An explicit unsupported value is an
 * error; an unsupported environment value falls back silently.
 */
export function resolveLocale(requested, env = {}) {
  if (requested !== undefined && requested !== null && requested !== '') {
    const explicit = normalizeLocale(requested);
    if (!explicit) {
      const error = new Error(`Unsupported --lang value: ${requested}. Supported: ${SUPPORTED_LOCALES.join(', ')}.`);
      error.code = 'UNSUPPORTED_LOCALE';
      throw error;
    }
    return explicit;
  }
  for (const name of ['NEXT_OR_NOT_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const fromEnv = normalizeLocale(env[name]);
    if (fromEnv) return fromEnv;
  }
  return DEFAULT_LOCALE;
}

function interpolate(template, params, separator) {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (!params || !(key in params)) return match;
    const value = params[key];
    if (Array.isArray(value)) return value.join(separator);
    return value === null || value === undefined ? '' : String(value);
  });
}

export function createTranslator(locale = DEFAULT_LOCALE) {
  const active = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
  const primary = CATALOGS[active];
  const fallback = CATALOGS[DEFAULT_LOCALE];
  const separator = primary._listSeparator ?? ', ';

  function resolveParams(params) {
    if (!params) return params;
    const resolved = {};
    for (const [key, value] of Object.entries(params)) {
      if (isMessage(value)) resolved[key] = translate(value);
      else if (Array.isArray(value)) resolved[key] = value.map((item) => (isMessage(item) ? translate(item) : item));
      else resolved[key] = value;
    }
    return resolved;
  }

  function translate(idOrMessage, params) {
    const id = isMessage(idOrMessage) ? idOrMessage[MESSAGE_TAG] : idOrMessage;
    const raw = isMessage(idOrMessage) ? idOrMessage.params : params;
    const entry = primary[id] ?? fallback[id];
    if (entry === undefined) return id;
    const resolved = resolveParams(raw);
    if (typeof entry === 'function') return entry(resolved ?? {}, { separator, locale: active });
    return interpolate(entry, resolved, separator);
  }

  translate.locale = active;
  translate.listSeparator = separator;
  return translate;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Walk a result tree and replace every message descriptor.
 * `text` mode yields plain strings for terminal output; `rich` mode yields
 * `{ id, params, text }` so JSON consumers can key off a stable id while
 * still reading a human sentence.
 */
export function localize(value, translate, mode = 'text') {
  if (isMessage(value)) {
    const text = translate(value);
    if (mode !== 'rich') return text;
    const params = value.params === undefined ? null : localize(value.params, translate, 'text');
    return { id: value[MESSAGE_TAG], params, text };
  }
  if (Array.isArray(value)) return value.map((item) => localize(item, translate, mode));
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = localize(item, translate, mode);
    return out;
  }
  return value;
}

const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

/** Terminal column count, counting CJK characters as two columns. */
export function displayWidth(text) {
  let width = 0;
  for (const character of String(text)) width += WIDE.test(character) ? 2 : 1;
  return width;
}

export function padToWidth(text, target) {
  const padding = target - displayWidth(text);
  return padding > 0 ? `${text}${' '.repeat(padding)}` : text;
}
