const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'web', 'i18n.js'), 'utf8');

// Runs web/i18n.js with a minimal browser and returns window.BlogI18n.
function load({ saved = null, browser = 'en-GB' } = {}) {
  const store = new Map(saved ? [['blog-language', saved]] : []);
  const window = { dispatchEvent() {} };
  const document = {
    readyState: 'loading',
    documentElement: {},
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  vm.runInNewContext(SOURCE, { window, document, localStorage, navigator: { language: browser }, CustomEvent: class {} });
  return { i18n: window.BlogI18n, store, document };
}

test('the language follows the browser unless the reader chose one', () => {
  expect(load({ browser: 'zh-CN' }).i18n.language).toBe('zh');
  expect(load({ browser: 'zh' }).i18n.language).toBe('zh');
  expect(load({ browser: 'en-US' }).i18n.language).toBe('en');
  expect(load({ browser: 'fr' }).i18n.language).toBe('en');
  expect(load({ browser: 'zh-TW', saved: 'en' }).i18n.language).toBe('en');
  expect(load({ browser: 'en', saved: 'zh' }).i18n.language).toBe('zh');
  expect(load({ browser: 'en', saved: 'xx' }).i18n.language).toBe('en');
});

test('t, locale and setLanguage switch together, and the choice is saved', () => {
  const { i18n, store, document } = load({ browser: 'en' });
  expect(i18n.t('文章', 'Posts')).toBe('Posts');
  expect(i18n.locale()).toBe('en-GB');
  i18n.setLanguage('zh');
  expect(i18n.t('文章', 'Posts')).toBe('文章');
  expect(i18n.locale()).toBe('zh-CN');
  expect(document.documentElement.lang).toBe('zh-CN');
  expect(store.get('blog-language')).toBe('zh');
});

test('API errors are shown in Chinese when known, and as sent otherwise', () => {
  const { i18n } = load({ browser: 'zh-CN' });
  expect(i18n.translateError('Sign in to do that')).toBe('请先登录');
  expect(i18n.translateError('Files can be at most 25 MB')).toBe('文件最大 25 MB');
  expect(i18n.translateError('Something new')).toBe('Something new');
  i18n.setLanguage('en');
  expect(i18n.translateError('Sign in to do that')).toBe('Sign in to do that');
});
