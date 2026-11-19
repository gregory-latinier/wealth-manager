// `cookie` v2 (pulled in by Fastify's `inject` through light-my-request) ships ESM only,
// so ts-jest has to compile it. pnpm's layout puts `node_modules` twice in its real path
// (node_modules/.pnpm/cookie@x/node_modules/cookie), so only the `cookie` package is let through.
// String.raw keeps the regex source exactly as written; [\\/] matches both / and \ (Windows).
const SEP = String.raw`[\\/]`

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  transform: {
    [String.raw`^.+\.ts$`]: ['ts-jest', { diagnostics: false }],
    [`cookie${SEP}dist${SEP}.+${String.raw`\.js$`}`]: [
      'ts-jest',
      { diagnostics: false, tsconfig: { allowJs: true, module: 'commonjs' } },
    ],
  },
  transformIgnorePatterns: [`node_modules${SEP}(?!${String.raw`\.pnpm`}${SEP}cookie@|cookie${SEP})`],
}
