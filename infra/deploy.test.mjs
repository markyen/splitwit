// node --test infra/deploy.test.mjs
// infra/deploy.sh, offline. Each run is of a copy of the script in a temporary directory, with
// sample tfvars and stubs for aws, tofu, git, curl and dig, so no run reaches AWS, Cloudflare or the
// network. It checks runner mode (DEPLOY_NONINTERACTIVE=1): which profile and environment it
// accepts, that it never reads standard input, that it applies only plans that pass their mode's
// checks, and that it refuses the rest. The plan checks are also run against sample plans.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const DEPLOY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'deploy.sh');
const JQ = spawnSync('/bin/sh', ['-c', 'command -v jq'], { encoding: 'utf8' }).stdout.trim();
const DIGEST = `sha256:${'a'.repeat(64)}`;
const BOUNDARY = 'arn:aws:iam::000000000000:policy/example-boundary';
const TOKEN = 'cf_example_token_0123456789abcdefghijklmnopqrstuvwxyz';

// --- the sandbox -----------------------------------------------------------------------------------

const STUBS = {
  // tofu -chdir=<stack dir> <command> ...: answers from the sandbox's files for that stack
  tofu: `
stack="$(basename "\${1#-chdir=}")"; shift
echo "tofu $stack $*" >> "$BOX/calls"
cmd="$1"; shift
case "$cmd" in
  init) exit 0 ;;
  plan) for a in "$@"; do case "$a" in -out=*) : > "\${a#-out=}" ;; esac; done ;;
  show)
    if [ "$1" = -json ] && [ $# -ge 2 ]; then cat "$BOX/plan-$stack.json"
    elif [ "$1" = -json ]; then cat "$BOX/state-$stack.json" 2> /dev/null || exit 1
    else echo "(the plan for $stack)"; fi ;;
  apply) echo "$stack" >> "$BOX/applied" ;;
  output)
    if [ $# -ge 2 ]; then jq ".$2.value" "$BOX/outputs-$stack.json"; else cat "$BOX/outputs-$stack.json"; fi ;;
  *) exit 97 ;;
esac`,
  aws: `
echo "aws $*" >> "$BOX/calls"
case "$*" in
  *"freetier get-account-plan-state"*)
    if [ -f "$BOX/freetier-denied" ]; then echo "An error occurred (AccessDeniedException)" >&2; exit 254; fi
    printf 'PAID\\tACTIVE\\tNone\\n' ;;
  *) echo "aws stub: no answer for this call" >&2; exit 97 ;;
esac`,
  dig: `
echo "dig $*" >> "$BOX/calls"
case "$*" in
  *" NS "*) echo ns1.example.net. ;;
  *CAA*) echo '0 issue "amazon.com"' ;;
esac`,
  // Keeps what it read on standard input (Cloudflare's token arrives there), and fails
  curl: `
echo "curl $*" >> "$BOX/calls"
env | grep '^CLOUDFLARE_' >> "$BOX/curl-env"
cat >> "$BOX/curl-stdin"
exit 22`,
  git: `
echo "git $*" >> "$BOX/calls"
exit 97`,
};

function sandbox(t) {
  const box = mkdtempSync(path.join(os.tmpdir(), 'splitwit-deploy-test-'));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const bin = path.join(box, 'bin');
  const infra = path.join(box, 'repo', 'infra');
  for (const dir of [bin, path.join(box, 'home'), path.join(box, 'tmp'), path.join(infra, 'bootstrap'), path.join(infra, 'dns')]) {
    mkdirSync(dir, { recursive: true });
  }
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(path.join(bin, name), `#!/bin/bash\nBOX='${box}'\n${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
  }
  symlinkSync(JQ, path.join(bin, 'jq'));
  copyFileSync(DEPLOY, path.join(infra, 'deploy.sh'));
  for (const dir of [infra, path.join(infra, 'bootstrap'), path.join(infra, 'dns')]) {
    writeFileSync(path.join(dir, 'backend.hcl'), 'bucket = "example"\n');
    writeFileSync(path.join(dir, 'terraform.tfvars.json'), '{}\n');
  }
  writeFileSync(path.join(box, 'aws-config'), '[profile splitwit-deploy]\nregion = us-east-1\n');
  return {
    dir: box,
    script: path.join(infra, 'deploy.sh'),
    write(name, value) {
      writeFileSync(path.join(box, name), typeof value === 'string' ? value : JSON.stringify(value));
    },
    read(name) {
      return existsSync(path.join(box, name)) ? readFileSync(path.join(box, name), 'utf8') : '';
    },
  };
}

const RUNNER = { DEPLOY_NONINTERACTIVE: '1', AWS_PROFILE: 'splitwit-deploy' };

// Runs the copy with only the variables given (undefined unsets one). stdin 'open' is a pipe that
// is never written to or closed: a script that reads it waits until the timeout kills it.
function run(box, args, vars = {}, { stdin = 'closed', timeout = 15_000 } = {}) {
  const env = {
    HOME: path.join(box.dir, 'home'),
    TMPDIR: path.join(box.dir, 'tmp'),
    PATH: `${path.join(box.dir, 'bin')}:/usr/bin:/bin`,
    AWS_CONFIG_FILE: path.join(box.dir, 'aws-config'),
    ...vars,
  };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', [box.script, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    if (stdin === 'closed') child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('exit', () => child.stdin.destroy());
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, out });
    });
  });
}

// --- sample plans --------------------------------------------------------------------------------

const TRUST = '{"Statement":[{"Action":"sts:AssumeRole","Effect":"Allow","Principal":{"Service":"codebuild.amazonaws.com"}}],"Version":"2012-10-17"}';

const role = (name, extra = {}) => ({
  arn: `arn:aws:iam::000000000000:role/${name}`,
  assume_role_policy: TRUST,
  description: 'example',
  id: name,
  max_session_duration: 3600,
  name,
  path: '/',
  permissions_boundary: null,
  tags_all: { project: 'splitwit' },
  ...extra,
});

function change(address, actions, extra = {}) {
  const managed = !address.startsWith('data.');
  const type = address.replace(/^data\./, '').split('.')[0];
  return { address, mode: managed ? 'managed' : 'data', type, change: { actions, before: null, after: null, after_unknown: {}, ...extra } };
}

const planned = (...roles) => ({ root_module: { resources: roles.map((values) => ({ type: 'aws_iam_role', values })) } });

// The update --attach-boundary makes to one role
function attach(address, name, boundary = BOUNDARY) {
  return change(address, ['update'], { before: role(name), after: role(name, { permissions_boundary: boundary }) });
}

const MAIN_ROLES = [['aws_iam_role.app', 'splitwit-app'], ['aws_iam_role.keep_warm[0]', 'splitwit-keep-warm'], ['aws_iam_role.budgets_action', 'splitwit-budgets-action']];

const attachMain = (...more) => ({
  resource_changes: [...MAIN_ROLES.map(([a, n]) => attach(a, n)), change('aws_lambda_function.app', ['no-op']), change('data.aws_iam_policy_document.app', ['read']), ...more],
  planned_values: planned(...MAIN_ROLES.map(([, n]) => role(n, { permissions_boundary: BOUNDARY }))),
});

const attachBoot = () => ({
  resource_changes: [attach('aws_iam_role.build', 'splitwit-build'), change('aws_codebuild_project.build', ['no-op'])],
  planned_values: planned(role('splitwit-build', { permissions_boundary: BOUNDARY })),
});

// A bootstrap plan with one ordinary change and the given extra ones
const bootPlan = (...more) => ({
  resource_changes: [change('aws_codebuild_project.build', ['update']), change('aws_iam_role.build', ['no-op']), ...more],
  planned_values: planned(role('splitwit-build')),
});

function bootstrapBox(t, plan) {
  const box = sandbox(t);
  box.write('repo/infra/bootstrap/terraform.tfvars.json', { firebase_web_config: {} });
  box.write('plan-bootstrap.json', plan);
  box.write('outputs-bootstrap.json', { acm_validation_records: { value: [] } });
  return box;
}

function assertRefused(r, pattern) {
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /RESULT: REFUSED \(/);
  assert.match(r.out, pattern);
  assert.doesNotMatch(r.out, /RESULT: (OK|FAILED|ABORTED)/);
}

// --- runner mode: profile and environment, before any tool runs -----------------------------------

test('runner mode runs as splitwit-deploy and no other profile, before running any tool', async (t) => {
  for (const profile of [undefined, '', 'default', 'fullfeed-deploy', 'splitwit-read', 'SPLITWIT-DEPLOY']) {
    const box = sandbox(t);
    const r = await run(box, ['--bootstrap'], { ...RUNNER, AWS_PROFILE: profile });
    assert.equal(r.code, 1, `${profile}: ${r.out}`);
    assert.match(r.out, /runner mode runs as the AWS profile splitwit-deploy/);
    assert.match(r.out, /RESULT: FAILED/);
    assert.equal(box.read('calls'), '', `${profile}: no tool runs`);
  }
});

test('DEPLOY_NONINTERACTIVE is 1 or unset', async (t) => {
  for (const value of ['yes', '0', 'true']) {
    const box = sandbox(t);
    const r = await run(box, ['--bootstrap'], { ...RUNNER, DEPLOY_NONINTERACTIVE: value });
    assert.equal(r.code, 1, value);
    assert.match(r.out, /DEPLOY_NONINTERACTIVE is 1 \(runner mode\) or unset/);
    assert.equal(box.read('calls'), '');
  }
});

test('runner mode refuses access-key variables, TF_*, endpoint overrides and Cloudflare variables', async (t) => {
  const cases = [
    { AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE' }, { AWS_SECRET_ACCESS_KEY: 'x' }, { AWS_SESSION_TOKEN: 'x' },
    { TF_LOG: 'trace' }, { AWS_ENDPOINT_URL: 'https://example.com' }, { AWS_CA_BUNDLE: '/tmp/ca.pem' },
    { CLOUDFLARE_API_TOKEN: TOKEN },
  ];
  for (const extra of cases) {
    const box = sandbox(t);
    const r = await run(box, ['--bootstrap'], { ...RUNNER, ...extra });
    assert.equal(r.code, 1, `${Object.keys(extra)}: ${r.out}`);
    assert.match(r.out, /is set; this script runs with a profile only|unset these first/);
    assert.equal(box.read('calls'), '');
  }
});

test('--state stays the admin\'s: runner mode refuses it before running any tool', async (t) => {
  const box = sandbox(t);
  const r = await run(box, ['--state'], RUNNER);
  assertRefused(r, /--state makes the state bucket/);
  assert.equal(box.read('calls'), '');
});

test('the DNS modes refuse in runner mode without a readable token file', async (t) => {
  for (const mode of ['adopt', 'apply', 'cutover', 'rollback']) {
    for (const file of [undefined, '/nonexistent/cloudflare-token']) {
      const box = sandbox(t);
      const r = await run(box, ['--dns', mode], { ...RUNNER, CLOUDFLARE_API_TOKEN_FILE: file });
      assertRefused(r, /--dns needs a Cloudflare API token/);
      assert.equal(box.read('calls'), '', `--dns ${mode}: no tool runs`);
    }
  }
});

test('with a token file, --dns reads the token from it and hands it to curl on standard input only', async (t) => {
  const box = sandbox(t);
  box.write('cf-token', `${TOKEN}\n`);
  const r = await run(box, ['--dns', 'apply'], { ...RUNNER, CLOUDFLARE_API_TOKEN_FILE: path.join(box.dir, 'cf-token') }, { stdin: 'open' });
  assert.equal(r.signal, null, `waited for input: ${r.out}`);
  assert.match(r.out, /read the Cloudflare API token from the file/);
  // The stub curl fails, so the run stops at Cloudflare's first answer
  assert.match(r.out, /Cloudflare refused to list zones/);
  assert.match(box.read('curl-stdin'), new RegExp(`Authorization: Bearer ${TOKEN}`));
  assert.ok(!r.out.includes(TOKEN), 'the token is never printed');
  assert.ok(!box.read('calls').includes(TOKEN), 'the token is in no argument');
  assert.equal(box.read('curl-env'), '', 'the file variable is unset before any tool runs');
});

// --- runner mode: plans ----------------------------------------------------------------------------

test('runner mode applies a plan that passes its checks, without reading standard input', async (t) => {
  for (const stdin of ['closed', 'open']) {
    const box = bootstrapBox(t, bootPlan());
    const r = await run(box, ['--bootstrap'], RUNNER, { stdin });
    assert.equal(r.signal, null, `stdin ${stdin}: waited for input\n${r.out}`);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /applying it without a prompt/);
    assert.match(r.out, /RESULT: OK/);
    assert.equal(box.read('applied'), 'bootstrap\n');
  }
});

test('runner mode carries on when the role may not read the account\'s plan', async (t) => {
  const box = bootstrapBox(t, bootPlan());
  box.write('freetier-denied', '');
  const r = await run(box, ['--bootstrap'], RUNNER);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /couldn't read the account's plan; carrying on/);
  assert.equal(box.read('applied'), 'bootstrap\n');
});

test('runner mode refuses a plan that deletes or replaces, unless --allow-destroy', async (t) => {
  for (const actions of [['delete'], ['delete', 'create'], ['create', 'delete']]) {
    const box = bootstrapBox(t, bootPlan(change('aws_s3_bucket_policy.source', actions)));
    const r = await run(box, ['--bootstrap'], RUNNER);
    assertRefused(r, /deletes or replaces something/);
    assert.equal(box.read('applied'), '', 'nothing applied');
  }
  const box = bootstrapBox(t, bootPlan(change('aws_s3_bucket_policy.source', ['delete'])));
  const r = await run(box, ['--bootstrap', '--allow-destroy'], RUNNER);
  assert.equal(r.code, 0, r.out);
  assert.equal(box.read('applied'), 'bootstrap\n');
});

test('runner mode refuses a plan that changes IAM beyond the deploy role, naming what', async (t) => {
  const trustChange = change('aws_iam_role.build', ['update'], {
    before: role('splitwit-build', { permissions_boundary: BOUNDARY }),
    after: role('splitwit-build', { permissions_boundary: BOUNDARY, assume_role_policy: TRUST.replace('codebuild', 'lambda') }),
  });
  const plan = bootPlan(trustChange);
  plan.resource_changes = plan.resource_changes.filter((c) => c.change.actions[0] !== 'no-op');
  const box = bootstrapBox(t, plan);
  const r = await run(box, ['--bootstrap', '--allow-destroy'], RUNNER);
  assertRefused(r, /changes IAM beyond what splitwit-deploy may do: aws_iam_role\.build; that stays the admin's/);
  assert.equal(box.read('applied'), '');
});

test('without runner mode, a closed standard input is no "yes": nothing is applied', async (t) => {
  const box = bootstrapBox(t, bootPlan());
  const r = await run(box, ['--bootstrap'], { AWS_PROFILE: 'any-profile' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /RESULT: ABORTED/);
  assert.equal(box.read('applied'), '');
});

// --- --attach-boundary -----------------------------------------------------------------------------

function attachBox(t, main, boot = attachBoot()) {
  const box = sandbox(t);
  box.write('outputs-infra.json', { image_uri: { value: `000000000000.dkr.ecr.us-east-1.amazonaws.com/splitwit@${DIGEST}` } });
  box.write('plan-infra.json', main);
  box.write('plan-bootstrap.json', boot);
  return box;
}

test('--attach-boundary applies both stacks when each changes only the roles\' boundary', async (t) => {
  for (const vars of [RUNNER, { AWS_PROFILE: 'any-profile' }]) {
    const box = attachBox(t, attachMain());
    const r = await run(box, ['--attach-boundary'], vars, { stdin: vars === RUNNER ? 'open' : 'closed' });
    if (vars === RUNNER) {
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /the permissions boundary is on: splitwit-build splitwit-app splitwit-keep-warm splitwit-budgets-action/);
      assert.equal(box.read('applied'), 'bootstrap\ninfra\n');
    } else {
      assert.match(r.out, /RESULT: ABORTED/, 'a person types yes');
      assert.equal(box.read('applied'), '');
    }
    assert.match(box.read('calls'), new RegExp(`tofu infra plan .*-var image_digest=${DIGEST}`), 'the live image, unchanged');
    assert.doesNotMatch(box.read('calls'), /freetier/, 'no account plan step: an attach costs nothing');
  }
});

test('--attach-boundary refuses, and applies neither stack, if a plan changes anything else', async (t) => {
  const extras = [
    change('aws_lambda_function.app', ['update']),
    change('aws_iam_role_policy.app', ['update']),
    change('aws_iam_role.other', ['update'], { before: role('other'), after: role('other', { permissions_boundary: BOUNDARY }) }),
  ];
  for (const extra of extras) {
    const box = attachBox(t, attachMain(extra));
    const r = await run(box, ['--attach-boundary'], RUNNER);
    assertRefused(r, /the plan in infra changes more than the roles' permissions boundary/);
    assert.equal(box.read('applied'), '', `${extra.address}: nothing applied`);
  }
});

test('--attach-boundary stops if permissions_boundary_arn is missing from a stack\'s tfvars', async (t) => {
  const boot = { resource_changes: [change('aws_iam_role.build', ['no-op'])], planned_values: planned(role('splitwit-build')) };
  const box = attachBox(t, attachMain(), boot);
  const r = await run(box, ['--attach-boundary'], RUNNER);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /a role in infra\/bootstrap would have no permissions boundary: set permissions_boundary_arn/);
  assert.equal(box.read('applied'), '');
});

// --- the plan checks against sample plans ----------------------------------------------------------

function jqProgram(name) {
  const match = new RegExp(`^${name}='([^']*)'$`, 'm').exec(readFileSync(DEPLOY, 'utf8'));
  assert.ok(match, `${name} is defined in deploy.sh`);
  return match[1];
}

function jq(program, input, args = []) {
  const r = spawnSync(JQ, ['-e', ...args, program], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.ok(r.status === 0 || r.status === 1 || r.status === 4, `jq failed: ${r.stderr}`);
  return { ok: r.status === 0, out: r.stdout };
}

test('ATTACH_ONLY: boundary-only updates of the four roles, nothing else', () => {
  const attachOnly = jqProgram('ATTACH_ONLY');
  const roles = ['--argjson', 'roles', jqProgram('ROLES')];
  const ok = (plan) => jq(attachOnly, plan, roles).ok;
  assert.equal(ok(attachMain()), true);
  assert.equal(ok(attachBoot()), true);
  assert.equal(ok({ resource_changes: [change('aws_iam_role.app', ['no-op'])] }), true);

  const refused = [
    change('aws_iam_role.app', ['update'], { before: role('splitwit-app'), after: role('splitwit-app', { permissions_boundary: BOUNDARY, description: 'other' }) }),
    change('aws_iam_role.app', ['update'], { before: role('splitwit-app'), after: role('splitwit-app', { permissions_boundary: BOUNDARY, assume_role_policy: '{}' }) }),
    change('aws_iam_role.app', ['update'], { before: role('splitwit-app'), after: role('splitwit-app', { permissions_boundary: 'not-an-arn' }) }),
    change('aws_iam_role.app', ['update'], { before: role('splitwit-app', { permissions_boundary: BOUNDARY }), after: role('splitwit-app') }),
    change('aws_iam_role.app', ['update'], { before: role('splitwit-app'), after: role('splitwit-app', { permissions_boundary: BOUNDARY }), after_unknown: { arn: true } }),
    change('aws_iam_role.app', ['delete', 'create'], { before: role('splitwit-app'), after: role('splitwit-app', { permissions_boundary: BOUNDARY }) }),
    change('aws_iam_role.app', ['no-op'], { importing: { id: 'splitwit-app' } }),
    change('aws_iam_role.extra', ['create'], { after: role('splitwit-extra', { permissions_boundary: BOUNDARY }) }),
    change('aws_iam_role_policy.app', ['update']),
    change('aws_cloudfront_distribution.site', ['update']),
  ];
  for (const bad of refused) {
    assert.equal(ok({ resource_changes: [attach('aws_iam_role.build', 'splitwit-build'), bad] }), false, JSON.stringify(bad));
  }
});

test('ROLES_BOUNDED: every role the plan leaves has a boundary', () => {
  const bounded = jqProgram('ROLES_BOUNDED');
  assert.equal(jq(bounded, attachMain()).ok, true);
  assert.equal(jq(bounded, { planned_values: planned(role('splitwit-app', { permissions_boundary: BOUNDARY }), role('splitwit-build')) }).ok, false);
  assert.equal(jq(bounded, { planned_values: planned(role('splitwit-app', { permissions_boundary: '' })) }).ok, false);
});

test('IAM_BEYOND_DEPLOY_ROLE: names exactly the IAM changes the deploy role may not make', () => {
  const beyond = jqProgram('IAM_BEYOND_DEPLOY_ROLE');
  const bounded = planned(...['splitwit-app', 'splitwit-keep-warm', 'splitwit-budgets-action'].map((n) => role(n, { permissions_boundary: BOUNDARY })));
  const named = (rc, pv = bounded) => jq(beyond, { resource_changes: rc, planned_values: pv }, ['-r']).out.trim().split('\n').filter(Boolean);

  const allowed = [
    change('aws_iam_role.keep_warm[0]', ['create'], { after: role('splitwit-keep-warm', { permissions_boundary: BOUNDARY }) }),
    change('aws_iam_role.app', ['update'], { before: role('splitwit-app', { permissions_boundary: BOUNDARY }), after: role('splitwit-app', { permissions_boundary: BOUNDARY, description: 'new' }) }),
    change('aws_iam_role.app', ['update'], { before: role('splitwit-app'), after: role('splitwit-app', { permissions_boundary: BOUNDARY }) }),
    change('aws_iam_role_policy.app', ['update'], { after: { role: 'splitwit-app', policy: '{}' } }),
    change('aws_iam_role_policy.keep_warm[0]', ['create'], { after: { policy: '{}' }, after_unknown: { role: true } }),
    change('aws_iam_role_policy.budgets_action', ['delete'], { before: { role: 'splitwit-budgets-action' } }),
    change('aws_iam_policy.ocr_stop', ['create'], { after: { name: 'splitwit-ocr-stop', policy: '{}' } }),
    change('aws_iam_policy.ocr_stop', ['update'], { before: { name: 'splitwit-ocr-stop', policy: '{}', tags: {} }, after: { name: 'splitwit-ocr-stop', policy: '{}', tags: { a: 'b' } } }),
    change('aws_iam_policy.ocr_stop', ['delete'], { before: { name: 'splitwit-ocr-stop' } }),
    change('data.aws_iam_policy_document.app', ['read']),
    change('aws_iam_role.build', ['no-op']),
    change('aws_lambda_function.app', ['update']),
  ];
  assert.deepEqual(named(allowed), []);

  const refused = [
    change('aws_iam_role.keep_warm[0]', ['delete'], { before: role('splitwit-keep-warm', { permissions_boundary: BOUNDARY }) }),
    change('aws_iam_role.app', ['delete', 'create'], { before: role('splitwit-app'), after: role('splitwit-app', { permissions_boundary: BOUNDARY }) }),
    change('aws_iam_role.app', ['update'], { before: role('splitwit-app', { permissions_boundary: BOUNDARY }), after: role('splitwit-app', { permissions_boundary: BOUNDARY, assume_role_policy: '{}' }) }),
    change('aws_iam_role.app', ['update'], { before: role('splitwit-app', { permissions_boundary: BOUNDARY }), after: role('splitwit-app') }),
    change('aws_iam_role.keep_warm[0]', ['create'], { after: role('splitwit-keep-warm') }),
    change('aws_iam_role.other', ['create'], { after: role('other', { permissions_boundary: BOUNDARY }) }),
    change('aws_iam_role.app', ['update'], {
      before: role('splitwit-app', { permissions_boundary: BOUNDARY }),
      after: role('splitwit-app', { permissions_boundary: BOUNDARY, description: 'new' }),
      importing: { id: 'splitwit-app' },
    }),
    change('aws_iam_policy.ocr_stop', ['update'], { before: { name: 'splitwit-ocr-stop', policy: '{"a":1}' }, after: { name: 'splitwit-ocr-stop', policy: '{"a":2}' } }),
    change('aws_iam_policy.other', ['create'], { after: { name: 'other', policy: '{}' } }),
    change('aws_iam_policy.ocr_stop', ['delete', 'create'], { before: { name: 'splitwit-ocr-stop' }, after: { name: 'splitwit-ocr-stop' } }),
    change('aws_iam_user.writer', ['create'], { after: { name: 'writer' } }),
    change('aws_iam_access_key.writer', ['create'], { after: {} }),
    change('aws_iam_role_policy_attachment.app', ['create'], { after: { role: 'splitwit-app' } }),
  ];
  for (const bad of refused) {
    assert.deepEqual(named([...allowed, bad]), [bad.address], JSON.stringify(bad));
  }

  // A role's inline policy on a role without a boundary, named or not yet known
  const unbounded = planned(role('splitwit-app'), role('splitwit-budgets-action', { permissions_boundary: BOUNDARY }));
  assert.deepEqual(named([change('aws_iam_role_policy.app', ['update'], { after: { role: 'splitwit-app' } })], unbounded), ['aws_iam_role_policy.app']);
  assert.deepEqual(named([change('aws_iam_role_policy.x', ['create'], { after: {}, after_unknown: { role: true } })], unbounded), ['aws_iam_role_policy.x']);
});
