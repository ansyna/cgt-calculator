import { describe, expect, it } from 'vitest';

// every source file's text, by path from src (e.g. "./platform/api.ts")
const SOURCES = import.meta.glob(['./**/*.{ts,tsx}', '!./generated/**'], { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

/** The files a file imports, as paths from src (without extension). */
function importsOf(file: string): string[] {
  const dir = file.split('/').slice(0, -1);
  return [...SOURCES[file].matchAll(/(?:from\s+|import\s*\(\s*|import\s+)'(\.{1,2}\/[^']+)'/g)].map(([, spec]) => {
    const parts = [...dir];
    for (const part of spec.split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.') parts.push(part);
    }
    return parts.join('/');
  });
}

const sourceFiles = Object.keys(SOURCES).filter((file) => !/\.test\.tsx?$/.test(file));
const appOf = (path: string) => /^\.\/apps\/([^/]+)\//.exec(path)?.[1];

describe('architecture', () => {
  it('finds the source files', () => {
    expect(sourceFiles).toContain('./platform/api.ts');
    expect(sourceFiles).toContain('./apps/cgt/index.tsx');
  });

  it('the shared platform knows no app: apps plug in through src/apps', () => {
    const offending = sourceFiles
      .filter((file) => file.startsWith('./platform/'))
      .flatMap((file) => importsOf(file).filter((target) => target.startsWith('./apps')).map((target) => `${file} -> ${target}`));
    expect(offending).toEqual([]);
  });

  it('apps use the platform, not each other', () => {
    const offending = sourceFiles
      .filter((file) => appOf(file))
      .flatMap((file) =>
        importsOf(file)
          .filter((target) => target.startsWith('./apps') && appOf(target + '/') !== appOf(file) && appOf(target) !== appOf(file))
          .map((target) => `${file} -> ${target}`),
      );
    expect(offending).toEqual([]);
  });
});
