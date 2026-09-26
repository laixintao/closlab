import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const parts = ['patch', 'minor', 'major'];
const versionPattern = /^\d+\.\d+\.\d+$/;

function run(command, args, capture = false) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error?.code === 'ENOENT' && command === 'bumpversion') {
    throw new Error('Install the release tool first: uv tool install bump2version==1.0.1');
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed${result.stderr ? `:\n${result.stderr.trim()}` : ''}`);
  return result.stdout?.trim() ?? '';
}

function checkVersions() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const config = readFileSync('.bumpversion.cfg', 'utf8');
  const configured = config.match(/^current_version\s*=\s*(\S+)\s*$/m)?.[1];
  if (!versionPattern.test(pkg.version) || configured !== pkg.version || lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
    throw new Error('Version mismatch: .bumpversion.cfg, package.json and both package-lock.json root versions must agree.');
  }
  return { version: pkg.version, lock };
}

function requireCleanTree() {
  if (run('git', ['status', '--porcelain'], true)) throw new Error('Commit or stash pending changes before creating a release.');
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--check') {
    console.log(`Version files agree: ${checkVersions().version}`);
    return;
  }
  const [part, option] = args;
  if (!parts.includes(part) || args.length > 2 || (option !== undefined && option !== '--dry-run')) {
    throw new Error('Usage: npm run release -- <patch|minor|major> [--dry-run]');
  }
  const { version, lock } = checkVersions();
  requireCleanTree();
  if (run('git', ['branch', '--show-current'], true) !== 'main') throw new Error('Create production releases from main.');
  const plan = run('bumpversion', ['--dry-run', '--list', part], true);
  const next = plan.match(/^new_version=(\S+)$/m)?.[1];
  if (!next || !versionPattern.test(next) || next === version) throw new Error('bumpversion did not produce a new semantic version.');
  const tag = `v${next}`;
  if (run('git', ['tag', '--list', tag], true)) throw new Error(`Release tag ${tag} already exists.`);
  if (option === '--dry-run') {
    console.log(`Would release ${version} → ${next}: run tests and build, update version files, commit and create ${tag}.`);
    return;
  }

  run('npm', ['test']);
  run('npm', ['run', 'build']);
  requireCleanTree();
  run('bumpversion', ['--new-version', next, '--no-commit', '--no-tag', part]);
  // Update only the app's two lockfile versions, even when a dependency shares
  // its current version. A global text replacement would corrupt dependencies.
  lock.version = next;
  lock.packages[''].version = next;
  writeFileSync('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);
  checkVersions();
  run('git', ['diff', '--check']);
  run('git', ['add', '.bumpversion.cfg', 'package.json', 'package-lock.json']);
  run('git', ['commit', '-m', `Release ${tag}`]);
  run('git', ['tag', '-a', tag, '-m', `ClosLab ${tag}`]);
  console.log(`Created ${tag}. Publish the commit and tag together with:\n  git push --atomic origin main ${tag}`);
}

try { main(); }
catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
