import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const json = file => JSON.parse(readFileSync(file, 'utf8'));
function command(cwd, bin, args) {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8' });
  assert.ifError(result.error);
  return result;
}
function fixture(t, failTests = false) {
  const dir = mkdtempSync(join(tmpdir(), 'closlab-release-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'empty-hooks'));
  copyFileSync(new URL('./release.mjs', import.meta.url), join(dir, 'scripts/release.mjs'));
  const config = readFileSync(new URL('../.bumpversion.cfg', import.meta.url), 'utf8').replace(/^current_version\s*=.*$/m, 'current_version = 0.1.0');
  writeFileSync(join(dir, '.bumpversion.cfg'), config);
  const pkg = { name: 'closlab', private: true, version: '0.1.0', scripts: {
    test: `node -e "process.exit(${failTests ? 1 : 0})"`, build: 'node scripts/release.mjs --check',
  }, dependencies: { 'same-version-dependency': '0.1.0' } };
  const lock = { name: 'closlab', version: '0.1.0', lockfileVersion: 3, packages: {
    '': { name: 'closlab', version: '0.1.0', dependencies: pkg.dependencies },
    'node_modules/same-version-dependency': { version: '0.1.0', integrity: 'unchanged-dependency-data' },
  } };
  for (const [name, data] of [['package.json', pkg], ['package-lock.json', lock]]) writeFileSync(join(dir, name), JSON.stringify(data, null, 2) + '\n');
  const git = (...args) => {
    const result = command(dir, 'git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-b', 'main');
  git('config', 'user.name', 'ClosLab release test'); git('config', 'user.email', 'release-test@example.invalid');
  git('config', 'commit.gpgsign', 'false'); git('config', 'tag.gpgsign', 'false');
  git('config', 'core.hooksPath', join(dir, 'empty-hooks'));
  git('add', '.'); git('commit', '-m', 'Initial test project');
  const release = (...args) => command(dir, process.execPath, ['scripts/release.mjs', ...args]);
  return { dir, git, release, lock };
}

for (const [part, next] of [['patch', '0.1.1'], ['minor', '0.2.0'], ['major', '1.0.0']]) {
  test(`${part} release synchronizes app versions, preserves dependencies and creates an annotated tag`, t => {
    const { dir, git, release, lock } = fixture(t);
    const initial = git('rev-parse', 'HEAD');
    const preview = release(part, '--dry-run');
    assert.equal(preview.status, 0, preview.stderr);
    assert.ok(preview.stdout.includes(next));
    assert.equal(git('rev-parse', 'HEAD'), initial);
    assert.equal(git('status', '--porcelain'), '');
    assert.equal(git('tag', '--list'), '');
    const result = release(part);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(json(join(dir, 'package.json')).version, next);
    const updated = json(join(dir, 'package-lock.json'));
    assert.equal(updated.version, next); assert.equal(updated.packages[''].version, next);
    assert.deepEqual(updated.packages['node_modules/same-version-dependency'], lock.packages['node_modules/same-version-dependency']);
    assert.deepEqual(updated.packages[''].dependencies, lock.packages[''].dependencies);
    assert.match(readFileSync(join(dir, '.bumpversion.cfg'), 'utf8'), new RegExp(`current_version = ${next.replaceAll('.', '\\.')}`));
    assert.equal(git('log', '-1', '--format=%s'), `Release v${next}`);
    assert.equal(git('cat-file', '-t', `refs/tags/v${next}`), 'tag');
    assert.equal(git('rev-list', '-n', '1', `v${next}`), git('rev-parse', 'HEAD'));
    assert.equal(git('status', '--porcelain'), '');
  });
}

test('failed preflight tests leave all version files and tags unchanged', t => {
  const { dir, git, release } = fixture(t, true);
  assert.notEqual(release('patch').status, 0);
  assert.equal(json(join(dir, 'package.json')).version, '0.1.0');
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(git('tag', '--list'), '');
});

test('rejects dirty trees, non-main branches and duplicate release tags before editing files', t => {
  const { dir, git, release } = fixture(t);
  writeFileSync(join(dir, 'pending.txt'), 'pending work');
  assert.match(release('patch').stderr, /Commit or stash/);
  rmSync(join(dir, 'pending.txt'));
  git('checkout', '-b', 'work');
  assert.match(release('patch').stderr, /from main/);
  git('checkout', 'main'); git('tag', 'v0.1.1');
  assert.match(release('patch').stderr, /already exists/);
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(json(join(dir, 'package.json')).version, '0.1.0');
});

test('build-time validation rejects a mismatched lockfile root version', t => {
  const { dir, release, lock } = fixture(t);
  lock.packages[''].version = '9.0.0';
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
  const result = release('--check');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Version mismatch/);
});
