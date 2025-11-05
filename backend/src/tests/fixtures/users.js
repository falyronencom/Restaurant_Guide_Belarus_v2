/**
 * User Test Fixtures
 *
 * Predefined test users with various roles and configurations.
 * These fixtures are used across multiple test suites to ensure
 * consistent test data.
 */

export const testUsers = {
  // Regular user - standard privileges
  regularUser: {
    email: 'user@test.com',
    phone: '+375291234567', // Belarus MTS number
    password: 'Test123!@#',
    name: 'Иван Иванов',
    role: 'user',
    authMethod: 'email'
  },

  // Second regular user - for testing user isolation
  regularUser2: {
    email: 'user2@test.com',
    phone: '+375292345678',
    password: 'Test123!@#',
    name: 'Петр Петров',
    role: 'user',
    authMethod: 'email'
  },

  // Partner user - can manage establishments
  partner: {
    email: 'partner@test.com',
    phone: '+375331234567', // Belarus MTC number
    password: 'Partner123!@#',
    name: 'Владимир Партнеров',
    role: 'partner',
    authMethod: 'email'
  },

  // Second partner - for testing establishment ownership
  partner2: {
    email: 'partner2@test.com',
    phone: '+375332345678',
    password: 'Partner123!@#',
    name: 'Александр Бизнесов',
    role: 'partner',
    authMethod: 'email'
  },

  // Admin user - full privileges
  admin: {
    email: 'admin@test.com',
    phone: '+375441234567', // Belarus Velcom number
    password: 'Admin123!@#',
    name: 'Сергей Админов',
    role: 'admin',
    authMethod: 'email'
  },

  // Phone-only user (no email)
  phoneOnlyUser: {
    email: null,
    phone: '+375295555555',
    password: 'Test123!@#',
    name: 'Мария Телефонова',
    role: 'user',
    authMethod: 'phone'
  },

  // Email-only user (no phone)
  emailOnlyUser: {
    email: 'emailonly@test.com',
    phone: null,
    password: 'Test123!@#',
    name: 'Николай Емайлов',
    role: 'user',
    authMethod: 'email'
  }
};

/**
 * Invalid user data for validation testing
 */
export const invalidUsers = {
  // Invalid email format
  invalidEmail: {
    email: 'not-an-email',
    phone: '+375291234567',
    password: 'Test123!@#',
    name: 'Test User'
  },

  // Invalid Belarus phone format
  invalidPhone: {
    email: 'test@test.com',
    phone: '+7123456789', // Russian phone
    password: 'Test123!@#',
    name: 'Test User'
  },

  // Weak password
  weakPassword: {
    email: 'test@test.com',
    phone: '+375291234567',
    password: '123', // Too short
    name: 'Test User'
  },

  // Missing required fields
  missingName: {
    email: 'test@test.com',
    phone: '+375291234567',
    password: 'Test123!@#',
    name: '' // Empty name
  },

  // No contact method
  noContactMethod: {
    email: null,
    phone: null,
    password: 'Test123!@#',
    name: 'Test User'
  }
};

/**
 * User data for testing edge cases
 */
export const edgeCaseUsers = {
  // Very long name
  longName: {
    email: 'longname@test.com',
    phone: '+375297777777',
    password: 'Test123!@#',
    name: 'А'.repeat(255), // 255 character name
    authMethod: 'email'
  },

  // Special characters in name
  specialCharsName: {
    email: 'special@test.com',
    phone: '+375298888888',
    password: 'Test123!@#',
    name: "Мария-Анна О'Брайен-Иванова",
    authMethod: 'email'
  },

  // Mixed case email (should normalize to lowercase)
  mixedCaseEmail: {
    email: 'TeSt@ExAmPlE.CoM',
    phone: '+375299999999',
    password: 'Test123!@#',
    name: 'Test User',
    authMethod: 'email'
  }
};

export default {
  testUsers,
  invalidUsers,
  edgeCaseUsers
};
