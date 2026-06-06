import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const resources = {
  en: {
    translation: {
      home: 'Home',
      sell: 'Sell',
      stock: 'Stock',
      assistant: 'Assistant',
      more: 'More',
    },
  },
  tw: {
    translation: {
      home: 'Fie',
      sell: 'Tɔn',
      stock: 'Adeɛ',
      assistant: 'Boafo',
      more: 'Pii',
    },
  },
  pidgin: {
    translation: {
      home: 'Home',
      sell: 'Sell',
      stock: 'Stock',
      assistant: 'Helper',
      more: 'More',
    },
  },
} as const;

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    compatibilityJSON: 'v4',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    lng: 'en',
    resources,
  });
}

export { i18n };
