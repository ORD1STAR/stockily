import { createPrismaClient } from './infra-db.js';

describe('createPrismaClient', () => {
  it('constructs a PrismaClient instance', () => {
    expect(createPrismaClient()).toBeDefined();
  });
});
