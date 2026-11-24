// SR-050: single source of version information. APP_VERSION is injected at build/test time from package.json.
declare const __APP_VERSION__: string;

export const APP_NAME = 'clause-lab';
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
/** Bump when detection/region output changes: cached indices from another analyzer revision are rebuilt. */
export const ANALYZER_VERSION = 4;
/** Index file format identifier and schema version. */
export const INDEX_FORMAT = 'clause-index' as const;
export const INDEX_SCHEMA = 2 as const;
