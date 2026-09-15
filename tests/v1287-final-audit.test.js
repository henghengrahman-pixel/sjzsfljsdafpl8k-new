import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('README and package declare current final release',()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const readme=fs.readFileSync(new URL('../README.md',import.meta.url),'utf8');
  assert.equal(pkg.version,'1.30.2');
  assert.match(readme,/Current release: v1\.30\.1 FAST-TELEGRAM FIX FINAL/);
});

test('Docker install is reproducible from package-lock',()=>{
  const docker=fs.readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');
  assert.match(docker,/COPY package\.json package-lock\.json \.\//);
  assert.match(docker,/npm ci --omit=dev --no-audit --no-fund/);
});

test('release audit is part of npm verify',()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.scripts.verify,'npm run check && npm test && npm run audit');
});
