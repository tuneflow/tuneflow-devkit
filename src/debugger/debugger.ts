import { createApp } from 'vue';
import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import Debugger from './Debugger.vue';

await i18next.use(LanguageDetector).init({
  detection: {
    order: ['querystring', 'htmlTag', 'navigator'],
    lookupQuerystring: 'lang',
    caches: ['cookie'],
  },
  fallbackLng: 'en-US',
});

const app = createApp(Debugger);

async function init() {
  app.mount('#app');
}

init();
