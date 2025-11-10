/**
 * Database Mock for Unit Tests
 *
 * Provides mocked database operations for testing services without actual database.
 * Uses jest.fn() to create trackable mock functions.
 */

/**
 * Mock pool object that simulates pg Pool
 */
export const mockPool = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn(),
};

/**
 * Mock client object for transactions
 */
export const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

/**
 * Helper to setup successful query response
 */
export function mockQuerySuccess(rows = [], rowCount = null) {
  mockPool.query.mockResolvedValue({
    rows,
    rowCount: rowCount !== null ? rowCount : rows.length,
    command: 'SELECT',
    fields: [],
    oid: 0,
  });
}

/**
 * Helper to setup query error
 */
export function mockQueryError(error) {
  mockPool.query.mockRejectedValue(error);
}

/**
 * Helper to setup transaction mock
 */
export function mockTransaction() {
  mockPool.connect.mockResolvedValue(mockClient);
  mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
  return mockClient;
}

/**
 * Reset all database mocks
 */
export function resetDatabaseMocks() {
  mockPool.query.mockReset();
  mockPool.connect.mockReset();
  mockPool.end.mockReset();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
}

/**
 * Mock for query results builder
 */
export class MockQueryResult {
  constructor(rows = []) {
    this.rows = rows;
    this.rowCount = rows.length;
    this.command = 'SELECT';
    this.fields = [];
    this.oid = 0;
  }

  static success(rows) {
    return new MockQueryResult(rows);
  }

  static empty() {
    return new MockQueryResult([]);
  }

  static insert(id) {
    return new MockQueryResult([{ id }]);
  }

  static update(rowCount = 1) {
    const result = new MockQueryResult([]);
    result.command = 'UPDATE';
    result.rowCount = rowCount;
    return result;
  }

  static delete(rowCount = 1) {
    const result = new MockQueryResult([]);
    result.command = 'DELETE';
    result.rowCount = rowCount;
    return result;
  }
}

/**
 * Mock database error
 */
export class MockDatabaseError extends Error {
  constructor(message, code = '23505', detail = '') {
    super(message);
    this.name = 'MockDatabaseError';
    this.code = code;
    this.detail = detail;
  }

  static uniqueViolation(field = 'email') {
    return new MockDatabaseError(
      `duplicate key value violates unique constraint`,
      '23505',
      `Key (${field})=(...) already exists.`
    );
  }

  static foreignKeyViolation() {
    return new MockDatabaseError(
      'violates foreign key constraint',
      '23503'
    );
  }

  static notNullViolation(field) {
    return new MockDatabaseError(
      `null value in column "${field}" violates not-null constraint`,
      '23502'
    );
  }
}
