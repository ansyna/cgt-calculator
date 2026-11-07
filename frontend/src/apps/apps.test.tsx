import { describe, expect, it } from 'vitest';
import { appForPath } from '../platform/apps';
import { APPS } from '.';

describe('the apps', () => {
  it('have distinct ids, start pages and names', () => {
    for (const key of ['id', 'path', 'name', 'shortName'] as const) {
      expect(new Set(APPS.map((app) => app[key])).size, key).toBe(APPS.length);
    }
  });

  it('each open at one of their own pages', () => {
    for (const app of APPS) {
      expect(app.routes.map((route) => route.path), app.id).toContain(app.path);
      expect(appForPath(APPS, app.path), app.id).toBe(app);
    }
  });

  it("own all their pages, so the layout shows the right app's menu", () => {
    for (const app of APPS) {
      for (const route of app.routes) expect(appForPath(APPS, route.path)?.id, route.path).toBe(app.id);
    }
  });

  it('never claim the same address', () => {
    const paths = APPS.flatMap((app) => app.routes.map((route) => route.path));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('leave the shared pages to no app', () => {
    for (const path of ['/users', '/users/7', '/roles', '/activity', '/login', '/register', '/reset-password']) {
      expect(appForPath(APPS, path), path).toBeNull();
    }
  });

  it('are open to those with access, apart from the pages for everyone', () => {
    for (const app of APPS) {
      for (const route of app.routes) {
        if (route.path === '/' || route.path === '/home') continue;
        expect(route.access, route.path).toEqual(['admin', 'investor']);
      }
    }
  });
});
