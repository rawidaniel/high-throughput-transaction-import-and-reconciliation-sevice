// Central place for all DI tokens. Using Symbols (not strings) avoids
// accidental collisions and gives you autocomplete via TypeScript.

export const FILE_STORAGE = Symbol('FILE_STORAGE');
export const IMPORT_REPOSITORY = Symbol('IMPORT_REPOSITORY');
export const CLOCK = Symbol('CLOCK');
export const ID_GENERATOR = Symbol('ID_GENERATOR');
export const IMPORT_FILE_REPOSITORY = Symbol('IMPORT_FILE_REPOSITORY');
export const JOB_REPOSITORY = Symbol('JOB_REPOSITORY');
export const LINE_READER = Symbol('LINE_READER');
export const RISK_SCORING_POOL = Symbol('RISK_SCORING_POOL');
export const TRANSACTION_REPOSITORY = Symbol('TRANSACTION_REPOSITORY');
export const IMPORT_QUERY = Symbol('IMPORT_QUERY');
