// Minimal hash router. Supports patterns like '#/lesson/:id'.

const routes = [];
let notFoundHandler = () => {};

export function registerRoute(pattern, handler) {
  const paramNames = [];
  const regexStr = pattern.replace(/:[^/]+/g, (match) => {
    paramNames.push(match.slice(1));
    return '([^/]+)';
  });
  const regex = new RegExp(`^${regexStr}$`);
  routes.push({ regex, paramNames, handler });
}

export function setNotFound(handler) {
  notFoundHandler = handler;
}

function resolveCurrentRoute() {
  const hash = window.location.hash || '#/syllabus';

  for (const route of routes) {
    const match = hash.match(route.regex);
    if (match) {
      const params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });
      route.handler(params);
      return;
    }
  }

  notFoundHandler(hash);
}

export function startRouter() {
  window.addEventListener('hashchange', resolveCurrentRoute);

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', resolveCurrentRoute);
  } else {
    resolveCurrentRoute();
  }
}

export function navigate(path) {
  window.location.hash = path;
}
