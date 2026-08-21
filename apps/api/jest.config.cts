 
const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: '@org/api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
  // Multiple e2e spec files each boot a full Nest app + its own Prisma
  // connection pool; running them together (the default when this target
  // executes the whole suite) is real concurrent resource contention, not
  // a code bug — several `beforeAll`s intermittently exceeded Jest's 5000ms
  // default under that load even though every one of them passes cleanly
  // in isolation. Raised globally rather than per-file, since the cause is
  // the same for all of them.
  testTimeout: 30000,
};
