/* eslint comma-dangle: 0 */
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

  // Viewer - read-only admin panel role (migration 034): enters the panel,
  // reads everything, changes nothing
  viewer: {
    email: 'viewer@test.com',
    phone: '+375441234568',
    password: 'Viewer123!@#',
    name: 'Ольга Наблюдателева',
    role: 'viewer',
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

/**
 * OAuth provider responses — the raw upstream payloads that verifyGoogleToken /
 * verifyYandexToken normalize. Used to drive the OAuth integration tests'
 * provider-boundary mocks (the google-auth-library ticket payload + the
 * login.yandex.ru/info body). QP4: the suite previously had no OAuth users.
 */
export const oauthProviderResponses = {
  // login.yandex.ru/info?format=json body (verifyYandexToken upstream)
  yandex: {
    id: 90210,
    default_email: 'yandex-user@yandex.ru',
    display_name: 'Яндекс Пользователь',
    default_avatar_id: 'av-yandex-1'
  },
  // Google id_token payload (verifyGoogleToken's ticket.getPayload())
  google: {
    sub: 'google-sub-42',
    email: 'google-user@gmail.com',
    name: 'Google Пользователь',
    picture: 'https://lh3.googleusercontent.com/a/pic',
    email_verified: true
  }
};

export default {
  testUsers,
  invalidUsers,
  edgeCaseUsers,
  oauthProviderResponses
};
