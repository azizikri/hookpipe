import Handlebars from 'handlebars';

const templateCache = new Map();

Handlebars.registerHelper('json', (context) => new Handlebars.SafeString(JSON.stringify(context)));
Handlebars.registerHelper('upper', (str) => str.toUpperCase());
Handlebars.registerHelper('lower', (str) => str.toLowerCase());
Handlebars.registerHelper('default', (value, fallback) => value || fallback);

export function renderTemplate(templateString, data) {
  let compiledTemplate = templateCache.get(templateString);
  if (!compiledTemplate) {
    compiledTemplate = Handlebars.compile(templateString);
    templateCache.set(templateString, compiledTemplate);
  }
  return compiledTemplate(data);
}

export function registerHelper(name, fn) {
  Handlebars.registerHelper(name, fn);
}
