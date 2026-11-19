// `cookie` v2 is ESM only. Fastify's `inject` (light-my-request) require()s it, and @fastify/cookie
// loads it with a dynamic import(), which Jest's VM rejects without --experimental-vm-modules.
// Compiling both to CommonJS with ts-jest turns the import() into a require() and fixes both paths.
// pnpm's layout puts `node_modules` twice in a real path, so the ignore pattern allows these packages
// through at both levels. String.raw keeps the regex source as written; [\\/] matches / and \ (Windows).
const SEP = String.raw`[\\/]`
const CJS = { diagnostics: false, tsconfig: { allowJs: true, module: 'commonjs' } }

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  // Test files share one database, so run them one at a time.
  maxWorkers: 1,
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  transform: {
    [String.raw`^.+\.ts$`]: ['ts-jest', { diagnostics: false }],
    [`cookie${SEP}dist${SEP}.+${String.raw`\.js$`}`]: ['ts-jest', CJS],
    [`@fastify${SEP}cookie${SEP}index${String.raw`\.js$`}`]: ['ts-jest', CJS],
  },
  transformIgnorePatterns: [
    `node_modules${SEP}(?!${String.raw`\.pnpm`}${SEP}(@fastify\\+)?cookie@|cookie${SEP}|@fastify${SEP}cookie${SEP})`,
  ],
}
