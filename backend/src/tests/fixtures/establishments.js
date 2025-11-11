/**
 * Establishment Test Fixtures
 *
 * Realistic Belarus establishment data for testing.
 * Uses authentic Belarusian restaurant names, categories, and cuisines.
 */

import { belarusCities, minskLocations } from './coordinates.js';

/**
 * Valid establishment data for testing CRUD operations
 */
export const testEstablishments = [
  // Traditional Belarusian restaurant in Minsk
  {
    name: 'Васильки',
    description: 'Традиционная белорусская кухня в уютной атмосфере. Специализируемся на драниках, мачанке и других национальных блюдах.',
    city: 'Минск',
    address: 'пр. Независимости 47',
    latitude: 53.9,
    longitude: 27.5,
    phone: '+375291234567',
    email: 'vasilki@example.com',
    website: 'https://vasilki.by',
    categories: ['Ресторан'],
    cuisines: ['Народная'],
    price_range: '$$$',
    working_hours: {
      monday: { open: '10:00', close: '23:00' },
      tuesday: { open: '10:00', close: '23:00' },
      wednesday: { open: '10:00', close: '23:00' },
      thursday: { open: '10:00', close: '23:00' },
      friday: { open: '10:00', close: '01:00' },
      saturday: { open: '11:00', close: '01:00' },
      sunday: { open: '11:00', close: '23:00' }
    }
  },

  // European brewery
  {
    name: 'Гамбринус',
    description: 'Европейская кухня и собственная пивоварня. Большой выбор крафтового пива и стейков.',
    city: 'Минск',
    address: 'ул. Притыцкого 156',
    latitude: 53.92,
    longitude: 27.48,
    phone: '+375291234568',
    email: 'gambrinus@example.com',
    website: 'https://gambrinus.by',
    categories: ['Ресторан', 'Бар'],
    cuisines: ['Европейская'],
    price_range: '$$',
    working_hours: {
      monday: { open: '12:00', close: '02:00' },
      tuesday: { open: '12:00', close: '02:00' },
      wednesday: { open: '12:00', close: '02:00' },
      thursday: { open: '12:00', close: '02:00' },
      friday: { open: '12:00', close: '04:00' },
      saturday: { open: '12:00', close: '04:00' },
      sunday: { open: '12:00', close: '02:00' }
    }
  },

  // Italian restaurant
  {
    name: 'La Scala',
    description: 'Настоящая итальянская кухня в центре Минска. Паста, пицца из дровяной печи, вина Италии.',
    city: 'Минск',
    address: 'ул. Ленина 5',
    latitude: 53.905,
    longitude: 27.557,
    phone: '+375291234569',
    email: 'lascala@example.com',
    website: 'https://lascala.by',
    categories: ['Ресторан', 'Пиццерия'],
    cuisines: ['Итальянская'],
    price_range: '$$$',
    working_hours: {
      monday: { open: '11:00', close: '23:00' },
      tuesday: { open: '11:00', close: '23:00' },
      wednesday: { open: '11:00', close: '23:00' },
      thursday: { open: '11:00', close: '23:00' },
      friday: { open: '11:00', close: '01:00' },
      saturday: { open: '11:00', close: '01:00' },
      sunday: { open: '11:00', close: '23:00' }
    }
  },

  // Japanese sushi bar
  {
    name: 'Токио',
    description: 'Японская кухня: суши, роллы, рамен. Мастера из Японии, свежие продукты каждый день.',
    city: 'Минск',
    address: 'пр. Победителей 84',
    latitude: 53.915,
    longitude: 27.535,
    phone: '+375291234570',
    email: 'tokyo@example.com',
    website: null,
    categories: ['Ресторан'],
    cuisines: ['Японская', 'Азиатская'],
    price_range: '$$$$',
    working_hours: {
      monday: { open: '12:00', close: '23:00' },
      tuesday: { open: '12:00', close: '23:00' },
      wednesday: { open: '12:00', close: '23:00' },
      thursday: { open: '12:00', close: '23:00' },
      friday: { open: '12:00', close: '23:00' },
      saturday: { open: '12:00', close: '23:00' },
      sunday: { open: '12:00', close: '23:00' }
    }
  },

  // Cozy cafe
  {
    name: 'Кофе Тайм',
    description: 'Уютная кофейня с авторским кофе и домашней выпечкой. Идеально для работы с ноутбуком.',
    city: 'Минск',
    address: 'ул. Октябрьская 10',
    latitude: 53.883,
    longitude: 27.574,
    phone: '+375291234571',
    email: 'coffeetime@example.com',
    website: 'https://coffeetime.by',
    categories: ['Кофейня'],
    cuisines: ['Европейская'],
    price_range: '$',
    working_hours: {
      monday: { open: '08:00', close: '22:00' },
      tuesday: { open: '08:00', close: '22:00' },
      wednesday: { open: '08:00', close: '22:00' },
      thursday: { open: '08:00', close: '22:00' },
      friday: { open: '08:00', close: '22:00' },
      saturday: { open: '09:00', close: '22:00' },
      sunday: { open: '09:00', close: '22:00' }
    }
  },

  // Georgian restaurant
  {
    name: 'Тбилиси',
    description: 'Грузинская кухня: хачапури, хинкали, шашлыки. Атмосфера Грузии в Минске.',
    city: 'Минск',
    address: 'ул. Немига 38',
    latitude: 53.904,
    longitude: 27.553,
    phone: '+375291234572',
    email: 'tbilisi@example.com',
    website: null,
    categories: ['Ресторан'],
    cuisines: ['Грузинская'],
    price_range: '$$',
    working_hours: {
      monday: { open: '11:00', close: '23:00' },
      tuesday: { open: '11:00', close: '23:00' },
      wednesday: { open: '11:00', close: '23:00' },
      thursday: { open: '11:00', close: '23:00' },
      friday: { open: '11:00', close: '01:00' },
      saturday: { open: '11:00', close: '01:00' },
      sunday: { open: '11:00', close: '23:00' }
    }
  },

  // Fast food
  {
    name: 'Burger Brothers',
    description: 'Лучшие бургеры в городе. Свежее мясо, домашние булочки, быстрая доставка.',
    city: 'Минск',
    address: 'пр. Машерова 25',
    latitude: 53.918,
    longitude: 27.540,
    phone: '+375291234573',
    email: 'burgers@example.com',
    website: 'https://burgerbrothers.by',
    categories: ['Фаст-фуд'],
    cuisines: ['Американская'],
    price_range: '$',
    working_hours: {
      monday: { open: '10:00', close: '23:00' },
      tuesday: { open: '10:00', close: '23:00' },
      wednesday: { open: '10:00', close: '23:00' },
      thursday: { open: '10:00', close: '23:00' },
      friday: { open: '10:00', close: '02:00' },
      saturday: { open: '10:00', close: '02:00' },
      sunday: { open: '10:00', close: '23:00' }
    }
  },

  // Establishment in Gomel (different city for geographic testing)
  {
    name: 'Сож',
    description: 'Ресторан на берегу реки Сож. Белорусская и европейская кухня, панорамный вид.',
    city: 'Гомель',
    address: 'ул. Советская 1',
    latitude: 52.4,
    longitude: 31.0,
    phone: '+375232123456',
    email: 'sozh@example.com',
    website: null,
    categories: ['Ресторан'],
    cuisines: ['Народная', 'Европейская'],
    price_range: '$$',
    working_hours: {
      monday: { open: '10:00', close: '23:00' },
      tuesday: { open: '10:00', close: '23:00' },
      wednesday: { open: '10:00', close: '23:00' },
      thursday: { open: '10:00', close: '23:00' },
      friday: { open: '10:00', close: '01:00' },
      saturday: { open: '10:00', close: '01:00' },
      sunday: { open: '10:00', close: '23:00' }
    }
  }
];

/**
 * Invalid establishment data for validation testing
 */
export const invalidEstablishments = {
  // Invalid city (not in Belarus city list)
  invalidCity: {
    name: 'Москва Ресторан',
    description: 'Test description',
    city: 'Москва', // Not in valid cities list
    address: 'Test address',
    latitude: 53.9,
    longitude: 27.5,
    categories: ['Ресторан'],
    cuisines: ['Европейская']
  },

  // Coordinates outside Belarus
  outsideBelarus: {
    name: 'Варшава Кафе',
    description: 'Test description',
    city: 'Минск',
    address: 'Test address',
    latitude: 52.2297, // Warsaw coordinates
    longitude: 21.0122,
    categories: ['Кофейня'],
    cuisines: ['Европейская']
  },

  // Too many categories (max 2)
  tooManyCategories: {
    name: 'Все Подряд',
    description: 'Test description',
    city: 'Минск',
    address: 'Test address',
    latitude: 53.9,
    longitude: 27.5,
    categories: ['Ресторан', 'Кофейня', 'Бар'], // 3 categories
    cuisines: ['Европейская']
  },

  // Too many cuisines (max 3)
  tooManyCuisines: {
    name: 'Международная Кухня',
    description: 'Test description',
    city: 'Минск',
    address: 'Test address',
    latitude: 53.9,
    longitude: 27.5,
    categories: ['Ресторан'],
    cuisines: ['Европейская', 'Азиатская', 'Американская', 'Итальянская'] // 4 cuisines
  },

  // Invalid category
  invalidCategory: {
    name: 'Strange Place',
    description: 'Test description',
    city: 'Минск',
    address: 'Test address',
    latitude: 53.9,
    longitude: 27.5,
    categories: ['Nightclub'], // Not in valid categories
    cuisines: ['Европейская']
  },

  // Invalid cuisine
  invalidCuisine: {
    name: 'Mexican Food',
    description: 'Test description',
    city: 'Минск',
    address: 'Test address',
    latitude: 53.9,
    longitude: 27.5,
    categories: ['Ресторан'],
    cuisines: ['Mexican'] // Not in valid cuisines
  },

  // Missing required fields
  missingRequired: {
    name: 'Incomplete',
    // Missing description, city, address, coordinates, categories, cuisines
  }
};

/**
 * Minimal valid establishment (only required fields)
 */
export const minimalEstablishment = {
  name: 'Минимальное Кафе',
  description: 'Короткое описание',
  city: 'Минск',
  address: 'ул. Тестовая 1',
  latitude: 53.9,
  longitude: 27.5,
  categories: ['Кофейня'],
  cuisines: ['Европейская']
  // No phone, email, website, working_hours - all optional
};

export default {
  testEstablishments,
  invalidEstablishments,
  minimalEstablishment
};
