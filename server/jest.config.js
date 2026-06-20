/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Set env before any module (incl. config.ts) is imported.
  setupFiles: ['<rootDir>/jest.setup.js'],
  clearMocks: true,
};
