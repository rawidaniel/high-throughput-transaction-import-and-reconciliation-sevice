// Central place for all DI tokens. Using Symbols (not strings) avoids
// accidental collisions and gives you autocomplete via TypeScript.

export const FILE_STORAGE = Symbol('FILE_STORAGE');
export const IMPORT_REPOSITORY = Symbol('IMPORT_REPOSITORY');
export const CLOCK = Symbol('CLOCK');
export const ID_GENERATOR = Symbol('ID_GENERATOR');
export const IMPORT_FILE_REPOSITORY = Symbol('IMPORT_FILE_REPOSITORY');
