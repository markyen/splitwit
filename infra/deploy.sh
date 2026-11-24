#!/usr/bin/env bash
# Build the app's image in CodeBuild and deploy it with OpenTofu: the same steps a deploy runner
# would take, run by hand. Also applies infra/bootstrap, with the same guards.
#
#   infra/deploy.sh                       build HEAD of main, then plan and apply infra/
#   infra/deploy.sh --branch NAME         the same from another branch
#   infra/deploy.sh --digest sha256:HEX   no build: deploy an image already in ECR (a rollback)
#   infra/deploy.sh --check               only the checks a deploy ends with (read-only)
#   infra/deploy.sh --drop-flat-rate      remove a web ACL left without a flat-rate subscription
#   infra/deploy.sh --state               once, first: the S3 bucket for the stacks' state, and
#                                         the three backend.hcl files that name it
#   infra/deploy.sh --bootstrap           plan and apply infra/bootstrap
#   infra/deploy.sh --dns adopt           infra/dns: import the zone's records, then plan and apply
#   infra/deploy.sh --dns apply           infra/dns: plan and apply, the site pointing where it does
#   infra/deploy.sh --dns cutover         infra/dns: point the apex and www at CloudFront
#   infra/deploy.sh --dns rollback        infra/dns: point them back at Vercel
#   infra/deploy.sh --attach-boundary     put permissions_boundary_arn (from each stack's tfvars)
#                                         on the four roles, and change nothing else
#   --allow-unpushed                      deploy a commit that is not on origin yet
#   --allow-destroy                       go on even if the plan deletes or replaces something
#
# Needs: an AWS CLI profile already signed in (AWS_PROFILE set; no access-key variables), OpenTofu,
# git, jq and curl (and dig, for --bootstrap and --dns), and the gitignored terraform.tfvars.json
# and backend.hcl in infra/, infra/bootstrap/ and infra/dns/ (copy the .example files). --dns asks
# for a Cloudflare API token (Zone · DNS · Edit and Zone · Zone · Read, on this zone only), which
# it keeps in memory and passes to curl on standard input and to tofu in its environment.
#
# Every plan is shown and applied only after a typed "yes". Everything printed is also written to a
# private log outside the repository (~/Library/Logs/splitwit, or ~/.local/state/splitwit): plans
# show the alert email and the account id. Nothing from the app runs here (no npm, no tests): the
# build, tests included, runs in CodeBuild inside the image build. OpenTofu runs with an empty CLI
# configuration, a fresh data directory and a read-only lock file.
#
# Runner mode, for a deploy runner instead of a person: DEPLOY_NONINTERACTIVE=1, with
# AWS_PROFILE=splitwit-deploy (a profile in the runner's own AWS_CONFIG_FILE). Nothing is asked
# and standard input isn't read. A plan that passes its mode's checks is applied without a "yes";
# anything else ends with "RESULT: REFUSED (<reason>, log: <path>)", exit status 3, and nothing
# applied. Runner mode does only what the deploy role may do: it refuses --state (the state bucket
# is the admin's) and any plan that changes IAM beyond splitwit's four roles and their policies,
# made or changed with a permissions boundary, without a change to who may assume a role, a role's
# deletion, or a change to a managed policy's document. --dns reads the Cloudflare token from the
# file named by CLOUDFLARE_API_TOKEN_FILE, and refuses without one.
#
# In runner mode the tree deploy.sh runs from is the commit: the runner hands over a commit's tree
# without .git, checked against DEPLOY_COMMIT (40 lowercase hex, required), with the gitignored
# tfvars and backend.hcl placed in it. git never runs: the build's commit is DEPLOY_COMMIT, its
# source zip is the tree's files without those gitignored inputs, and the clean-tree and pushed
# checks are left to the runner, which made them. --branch and --allow-unpushed don't apply.
set -euo pipefail
unset CDPATH
umask 077

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
TF=tofu
FUNCTION=splitwit
REPOSITORY=splitwit
KEEP_IMAGES=10 # infra/bootstrap's lifecycle rule keeps this many app images
BUILD_TIMEOUT_S=1800

if [ -d "$HOME/Library/Logs" ]; then
  LOG_DIR="$HOME/Library/Logs/splitwit"
else
  LOG_DIR="$HOME/.local/state/splitwit"
fi
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/deploy-$(date -u +%Y%m%d-%H%M%S).log"

exec > >(tee -a "$LOG") 2>&1

WORK=""
REFUSED=no
on_exit() {
  local code=$?
  [ -n "$WORK" ] && rm -rf "$WORK"
  if [ "$code" -ne 0 ] && [ "$REFUSED" = no ]; then
    echo "RESULT: FAILED (exit $code, log: $LOG)"
  fi
}
trap 'echo "deploy.sh: error at line $LINENO" >&2' ERR
trap on_exit EXIT
trap 'exit 130' INT TERM

die() {
  echo "deploy.sh: $*" >&2
  exit 1
}

say() {
  echo "deploy.sh: $*"
}

# Stop without applying anything, for a reason that a second run wouldn't change
refuse() {
  REFUSED=yes
  echo "RESULT: REFUSED ($*, log: $LOG)"
  exit 3
}

# --- what a plan may do (infra/deploy.test.mjs runs these against sample plans) ------------------

# The roles the stacks make: infra/ makes the first three, infra/bootstrap/ the last
ROLES='["aws_iam_role.app", "aws_iam_role.keep_warm[0]", "aws_iam_role.budgets_action", "aws_iam_role.build"]'

# --attach-boundary: in-place updates of those roles in which permissions_boundary is the only
# attribute that changes, to a policy ARN; nothing else changes, and nothing is imported
ATTACH_ONLY='all(.resource_changes[]?; .change.importing == null and (
  .change.actions == ["no-op"] or .change.actions == ["read"]
  or (.mode == "managed" and .change.actions == ["update"] and (.address | IN($roles[]))
    and (.change.after.permissions_boundary // "" | test("^arn:aws[a-z-]*:iam::[0-9]{12}:policy/."))
    and (.change.before | del(.permissions_boundary)) == (.change.after | del(.permissions_boundary))
    and ([.change.after_unknown // {} | .. | select(. == true)] | length) == 0)))'

# True if every role the stack holds after the plan has a permissions boundary
ROLES_BOUNDED='all(.planned_values.root_module.resources[]? | select(.type == "aws_iam_role"); (.values.permissions_boundary // "") != "")'

# Runner mode: the addresses of IAM changes the deploy role may not make. It may make or change
# splitwit's four roles only with a boundary, and never delete one or change who may assume it;
# put a role's inline policy only on a role with a boundary; and make or delete a splitwit-*
# managed policy, or change its tags, but not its document. Nothing else in IAM.
IAM_BEYOND_DEPLOY_ROLE='([.planned_values.root_module.resources[]? | select(.type == "aws_iam_role")
    | {key: .values.name, value: (.values.permissions_boundary // "")}] | from_entries) as $boundary
  | .resource_changes[]?
  | select(.mode == "managed" and (.type | startswith("aws_iam_")) and .change.actions != ["no-op"] and .change.actions != ["read"])
  | select((.change.importing == null and (
      if .type == "aws_iam_role" then
        (.change.actions | index("delete")) == null
        and (.change.after.name | IN("splitwit-app", "splitwit-keep-warm", "splitwit-budgets-action", "splitwit-build"))
        and (.change.after.permissions_boundary // "") != ""
        and (.change.actions == ["create"] or .change.before.assume_role_policy == .change.after.assume_role_policy)
      elif .type == "aws_iam_role_policy" then
        .change.actions == ["delete"]
        or (if .change.after.role == null then ($boundary | length > 0 and all(.[]; . != ""))
            else ($boundary[.change.after.role] // "") != "" end)
      elif .type == "aws_iam_policy" then
        .change.actions == ["delete"]
        or (.change.actions == ["create"] and (.change.after.name | startswith("splitwit-")))
        or (.change.actions == ["update"] and .change.before.policy == .change.after.policy)
      else false end)) | not)
  | .address'

# --- arguments ---------------------------------------------------------------------------------

BRANCH=main
DIGEST=""
MODE=deploy
ALLOW_UNPUSHED=no
ALLOW_DESTROY=no
DNS_MODE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --branch)
      [ $# -ge 2 ] || die "--branch needs a name"
      BRANCH="$2"
      shift 2
      ;;
    --digest)
      [ $# -ge 2 ] || die "--digest needs sha256:<hex>"
      DIGEST="$2"
      shift 2
      ;;
    --bootstrap)
      MODE=bootstrap
      shift
      ;;
    --state)
      MODE=state
      shift
      ;;
    --check)
      MODE=check
      shift
      ;;
    --drop-flat-rate)
      MODE=drop-flat-rate
      shift
      ;;
    --attach-boundary)
      MODE=attach-boundary
      shift
      ;;
    --dns)
      [ $# -ge 2 ] || die "--dns needs adopt, apply, cutover or rollback"
      MODE=dns
      DNS_MODE="$2"
      shift 2
      ;;
    --allow-unpushed)
      ALLOW_UNPUSHED=yes
      shift
      ;;
    --allow-destroy)
      ALLOW_DESTROY=yes
      shift
      ;;
    *) die "unknown argument: $1 (see the header of this script)" ;;
  esac
done
[[ "$BRANCH" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$ ]] || die "not a branch name: $BRANCH"
[ -z "$DIGEST" ] || [[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || die "--digest takes sha256:<64 lowercase hex>"
if [ "$MODE" = dns ]; then
  case "$DNS_MODE" in adopt | apply | cutover | rollback) ;; *) die "--dns takes adopt, apply, cutover or rollback" ;; esac
  [ "$ALLOW_DESTROY" = no ] || die "--allow-destroy doesn't apply to --dns: each mode allows its own changes"
fi
[ "$MODE" != attach-boundary ] || [ "$ALLOW_DESTROY" = no ] || die "--allow-destroy doesn't apply to --attach-boundary"

case "${DEPLOY_NONINTERACTIVE:-}" in
  "") RUNNER=no ;;
  1) RUNNER=yes ;;
  *) die "DEPLOY_NONINTERACTIVE is 1 (runner mode) or unset, not '$DEPLOY_NONINTERACTIVE'" ;;
esac
DEPLOY_PROFILE=splitwit-deploy
if [ "$RUNNER" = yes ]; then
  # Nothing reads a person's answer, and no tool can wait for one
  exec < /dev/null
  # The tree is the commit the runner verified, without .git: git never runs in runner mode
  [[ "${DEPLOY_COMMIT:-}" =~ ^[0-9a-f]{40}$ ]] ||
    die "runner mode needs DEPLOY_COMMIT, the commit the tree is, as 40 lowercase hex digits; got '${DEPLOY_COMMIT:-}'"
  [ "$BRANCH" = main ] && [ "$ALLOW_UNPUSHED" = no ] ||
    die "--branch and --allow-unpushed don't apply in runner mode: the runner chose and verified the commit"
fi

say "started $(date -u +%Y-%m-%dT%H:%M:%SZ), mode $MODE${DNS_MODE:+ $DNS_MODE}$([ "$RUNNER" = no ] || echo ", runner mode at commit $DEPLOY_COMMIT"), log $LOG"

# --- preconditions -----------------------------------------------------------------------------

if [ "$RUNNER" = yes ]; then
  [ "${AWS_PROFILE:-}" = "$DEPLOY_PROFILE" ] ||
    die "runner mode runs as the AWS profile $DEPLOY_PROFILE, not '${AWS_PROFILE:-}'"
else
  [ -n "${AWS_PROFILE:-}" ] || die "AWS_PROFILE is empty; sign in with a profile first"
fi
for name in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN; do
  [ -z "${!name:-}" ] || die "$name is set; this script runs with a profile only"
done
# Any TF_* variable can change which provider OpenTofu runs (TF_REATTACH_PROVIDERS skips the lock
# check), its arguments, its logs, state encryption or the stack's inputs; AWS endpoint and CA
# overrides would send the admin session somewhere else, and a CLOUDFLARE_* variable could hand the
# provider another credential or endpoint. Refuse them all rather than pick. Runner mode's one
# exception names the file --dns reads the token from; it is unset once read.
env_allowed='^$'
[ "$RUNNER" = no ] || env_allowed='^CLOUDFLARE_API_TOKEN_FILE$'
env_set="$(env | grep -E '^(TF_|AWS_ENDPOINT_URL|AWS_CA_BUNDLE|CLOUDFLARE_)' | cut -d= -f1 | grep -Ev "$env_allowed" | tr '\n' ' ' || true)"
[ -z "$env_set" ] || die "unset these first: $env_set"

if [ "$RUNNER" = yes ]; then
  case "$MODE" in
    state) refuse "--state makes the state bucket, which stays the admin's: run it without DEPLOY_NONINTERACTIVE" ;;
    dns)
      [ -f "${CLOUDFLARE_API_TOKEN_FILE:-}" ] && [ -r "$CLOUDFLARE_API_TOKEN_FILE" ] ||
        refuse "--dns needs a Cloudflare API token, which runner mode reads from the file CLOUDFLARE_API_TOKEN_FILE names, and none is readable"
      ;;
  esac
fi

if [ "$RUNNER" = yes ]; then
  tools="$TF aws jq curl shasum zip"
else
  tools="$TF aws git jq curl shasum"
fi
for tool in $tools; do
  command -v "$tool" > /dev/null || die "$tool is not installed"
done
[ "$MODE" = deploy ] || command -v dig > /dev/null || die "dig is not installed"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/splitwit-deploy.XXXXXX")"
: > "$WORK/tofurc"
export TF_CLI_CONFIG_FILE="$WORK/tofurc"

# tofu in one stack's directory, with its own fresh data directory
tf() {
  local dir="$1"
  shift
  TF_DATA_DIR="$WORK/data-$(basename "$dir")" "$TF" -chdir="$dir" "$@"
}

tf_init() {
  local dir="$1"
  [ -f "$dir/backend.hcl" ] || die "${dir#"$REPO"/}/backend.hcl is missing (copy backend.hcl.example)"
  tf "$dir" init -input=false -lockfile=readonly -backend-config=backend.hcl > "$WORK/init.log" ||
    { cat "$WORK/init.log"; die "tofu init failed in ${dir#"$REPO"/}"; }
}

# Show the plan and list its changes; leaves its JSON in $WORK/plan.json
show_plan() {
  local dir="$1" plan="$2"
  tf "$dir" show -no-color "$plan" || die "couldn't show the plan in ${dir#"$REPO"/}"
  tf "$dir" show -json "$plan" > "$WORK/plan.json" || die "couldn't read the plan in ${dir#"$REPO"/}"
  echo
  say "changes in ${dir#"$REPO"/}:"
  jq -r '.resource_changes[] | select(.change.actions != ["no-op"] or .change.importing != null)
    | "  \(.change.actions | join("+"))\(if .change.importing then " (import)" else "" end) \(.address)"' "$WORK/plan.json"
}

# Ask for a typed yes. Drops anything typed while the plan ran, partial lines included (read -n
# reads the terminal without waiting for Enter), so only an answer typed after reading counts.
confirm() {
  while read -r -s -t 1 -n 1 _typed; do :; done
  local answer
  read -r -p "Type yes to apply, anything else to stop: " answer || answer=""
  [ "$answer" = yes ]
}

# The go-ahead for a plan that passed its mode's checks: a typed yes, or in runner mode the checks
# alone
approve() {
  if [ "$RUNNER" = yes ]; then
    say "runner mode: the plan passed this mode's checks; applying it without a prompt"
    return 0
  fi
  confirm
}

# Show the plan's changes, stop on a delete or replace unless allowed (and, in runner mode, on an
# IAM change the deploy role may not make), then ask for a typed yes. Returns 0 to apply, 1 to stop
# without applying. A plan that can't be read counts as one that deletes.
review_plan() {
  local dir="$1" plan="$2" beyond
  show_plan "$dir" "$plan"
  if [ "$RUNNER" = yes ]; then
    beyond="$(jq -r "$IAM_BEYOND_DEPLOY_ROLE" "$WORK/plan.json")" || die "couldn't read the plan's IAM changes"
    [ -z "$beyond" ] ||
      refuse "the plan changes IAM beyond what $DEPLOY_PROFILE may do: $(printf '%s' "$beyond" | tr '\n' ' '); that stays the admin's"
  fi
  if ! jq -e 'all(.resource_changes[]?; (.change.actions | index("delete")) == null)' "$WORK/plan.json" > /dev/null; then
    if [ "$ALLOW_DESTROY" != yes ]; then
      [ "$RUNNER" = no ] || refuse "the plan deletes or replaces something (above), and --allow-destroy wasn't given"
      say "the plan deletes or replaces something (above); stopping. Rerun with --allow-destroy only if that is intended."
      return 1
    fi
    say "the plan deletes or replaces something, and --allow-destroy was given."
  fi
  approve
}

# On a failed apply, name the one failure that a second run fixes: IAM is eventually consistent,
# so a role made a moment ago can be refused to the service that is to assume it
apply_plan() {
  local dir="$1" plan="$2"
  if ! tf "$dir" apply -input=false "$plan" 2>&1 | tee "$WORK/apply.log"; then
    if grep -qE 'sts:AssumeRole|cannot be assumed|role defined for the function cannot be assumed' "$WORK/apply.log"; then
      say "the apply failed on a role that was just made and isn't visible to the service yet."
      say "Wait a minute and run the same command again; nothing that was created is lost."
    fi
    if [ "$dir" = "$HERE/dns" ]; then
      say "run the same command again now: it makes any record this run deleted and didn't make again."
    fi
    if [ "$dir" = "$HERE" ] && web_acl_unsubscribed; then
      drop_flat_rate_plan
    fi
    die "tofu apply failed in ${dir#"$REPO"/}"
  fi
}

# A subscription's status is one of PENDING_APPROVAL, ACTIVE, SYNC_IN_PROGRESS or FAILED (Pricing
# Plan Manager's Status type, as `aws pricing-plan-manager get-subscription help` lists it). ACTIVE
# and SYNC_IN_PROGRESS (being applied) hold the plan; FAILED doesn't, and PENDING_APPROVAL is for
# paid tiers only. Compared without case, in case the provider's spelling differs from the API's.
SUBSCRIBED_STATUSES='["ACTIVE", "SYNC_IN_PROGRESS"]'

# After a failed apply: true if the state holds the web ACL without a subscription that holds the
# plan, which would leave the ACL billing on pay-as-you-go whatever failed (the subscription, or the
# distribution that was to carry it). A state that can't be read counts as true.
web_acl_unsubscribed() {
  tf "$HERE" show -json > "$WORK/after.json" 2> /dev/null || return 0
  jq -e --argjson held "$SUBSCRIBED_STATUSES" '[.values.root_module.resources[]?] as $r
    | ($r | any(.address == "aws_wafv2_web_acl.site[0]"))
      and ($r | any(.address == "aws_pricingplanmanager_subscription.site[0]" and ((.values.status // "" | ascii_upcase) as $s | $held | index($s))) | not)' \
    "$WORK/after.json" > /dev/null
}

# The web ACL exists without an active flat-rate subscription. Fail closed on money: apply
# flat_rate_plan = false at once, so that no web ACL is left to bill on pay-as-you-go (about $6 a
# month), check that it's gone, and stop. Never returns.
drop_flat_rate_plan() {
  local reason attempt live dist
  # No apply log under --drop-flat-rate; grep's failure mustn't end the script (pipefail)
  reason="$({ grep -m1 'Error: ' "$WORK/apply.log" 2> /dev/null || true; } | sed 's/^[^A-Za-z]*//')"
  say "the apply failed with the web ACL made and no active flat-rate subscription: ${reason:-see above}"
  say "removing the web ACL now, so that nothing bills for it"
  # Targeted, so that nothing the failed apply didn't make is planned here: the web ACL and the
  # subscription, and the distribution only if it exists (a target brings in what it depends on).
  # The function keeps the image it runs now, so a failed image update isn't tried again.
  live="$("${AWS[@]}" lambda get-function --function-name "$FUNCTION" --query 'Code.ResolvedImageUri' --output text 2> /dev/null || true)"
  live="${live##*@}"
  [[ "$live" =~ ^sha256:[0-9a-f]{64}$ ]] || live="$DIGEST"
  # WAF refuses to delete a web ACL that CloudFront still holds, and OpenTofu can't be made to let
  # go of it first: it deletes the web ACL before it updates the distribution, and a plan targeting
  # the distribution alone still brings in the web ACL's delete. So the distribution drops the web
  # ACL through CloudFront's API, CloudFront finishes deploying that, and only then does OpenTofu
  # delete the web ACL (and any subscription left in the state).
  dist="$(tf "$HERE" show -json | jq -r '.values.root_module.resources[]? | select(.address == "aws_cloudfront_distribution.site") | .values.id // empty')"
  if [ -n "$dist" ]; then
    [[ "$dist" =~ ^E[A-Z0-9]+$ ]] || die "THE WEB ACL IS STILL THERE: the distribution's id in the state isn't one ($dist). Send us this output now."
    CF=(aws --region us-east-1 --no-cli-pager cloudfront)
    "${CF[@]}" get-distribution-config --id "$dist" > "$WORK/dist.json" ||
      die "THE WEB ACL IS STILL THERE: couldn't read distribution $dist. Send us this output now."
    if [ -n "$(jq -r '.DistributionConfig.WebACLId // ""' "$WORK/dist.json")" ]; then
      jq '.DistributionConfig | .WebACLId = ""' "$WORK/dist.json" > "$WORK/dist-config.json"
      "${CF[@]}" update-distribution --id "$dist" --if-match "$(jq -r '.ETag' "$WORK/dist.json")" \
        --distribution-config "file://$WORK/dist-config.json" > /dev/null ||
        die "THE WEB ACL IS STILL THERE: CloudFront refused to drop it from distribution $dist. Send us this output now."
      say "distribution $dist no longer names the web ACL; waiting for CloudFront to deploy that (usually 3 to 10 minutes)"
    else
      say "distribution $dist already names no web ACL; waiting for CloudFront to finish deploying"
    fi
    "${CF[@]}" wait distribution-deployed --id "$dist" || say "CloudFront hasn't finished yet; trying the delete anyway"
  fi
  for attempt in 1 2 3; do
    tf "$HERE" plan -input=false -lock=true -var-file=terraform.tfvars.json -var "image_digest=$live" \
      -var flat_rate_plan=false -target=aws_wafv2_web_acl.site -target=aws_pricingplanmanager_subscription.site \
      -out="$WORK/drop.plan" > "$WORK/drop-plan.log" 2>&1 || { cat "$WORK/drop-plan.log"; break; }
    tf "$HERE" show -json "$WORK/drop.plan" > "$WORK/drop.json"
    jq -r '.resource_changes[] | select(.change.actions != ["no-op"] and .change.actions != ["read"]) | "  \(.change.actions | join("+")) \(.address)"' "$WORK/drop.json"
    # Only the web ACL, and a subscription left in the state, may go
    jq -e 'all(.resource_changes[] | select(.change.actions != ["no-op"] and .change.actions != ["read"]);
      (.address == "aws_wafv2_web_acl.site[0]" or .address == "aws_pricingplanmanager_subscription.site[0]") and .change.actions == ["delete"])' "$WORK/drop.json" > /dev/null ||
      { say "that plan changes more than the web ACL; not applying it"; break; }
    tf "$HERE" apply -input=false "$WORK/drop.plan" 2>&1 | tee -a "$WORK/drop-apply.log" && break
    [ "$attempt" = 3 ] || { say "trying again in 60 s"; sleep 60; }
  done
  if [ "$(aws --region us-east-1 --no-cli-pager wafv2 list-web-acls --scope CLOUDFRONT \
    --query "length(WebACLs[?Name=='splitwit'])" --output text 2>&1)" != 0 ]; then
    die "THE WEB ACL IS STILL THERE and bills about \$6 a month until it goes; nothing else was undone. Send us this output now."
  fi
  say "the web ACL is gone and nothing bills for it; the site serves on pay-as-you-go CloudFront, without the rate limit."
  say "Until we choose what replaces it, set \"flat_rate_plan\": false in infra/terraform.tfvars.json."
  if [ "$MODE" = drop-flat-rate ]; then
    echo "RESULT: OK, the web ACL is gone (log: $LOG)"
    exit 0
  fi
  die "stopped: the web ACL had no active flat-rate subscription. Send us this line: ${reason:-see the log}"
}

# The zone's own nameservers, asked directly so that no cache answers for them
zone_ns() {
  dig +short NS "$1" | sed 's/\.$//' | sort
}

# True if CAA at each of the zone's nameservers admits amazon.com, or is empty (any authority)
caa_admits_amazon() {
  local apex="$1" ns caa found=no
  for ns in $(zone_ns "$apex"); do
    found=yes
    caa="$(dig +short +norecurse @"$ns" CAA "$apex")"
    [ -z "$caa" ] || printf '%s\n' "$caa" | grep -q 'issue "amazon.com"' || return 1
  done
  [ "$found" = yes ]
}

# Runner mode's source zip, from the tree instead of git. The runner hands over the commit's tree,
# without .git, having checked it file by file against DEPLOY_COMMIT: in runner mode the tree is the
# commit. It also places the stacks' gitignored inputs in it, which .gitignore's infra/ rules name
# (terraform.tfvars, terraform.tfvars.json, backend.hcl, state, logs, .terraform/); those stay out,
# as they stay out of git archive. Files and symbolic links, as git keeps them; nothing else.
tree_archive() {
  local out="$1"
  (cd "$REPO" && find . \( -path ./.git -o -path ./infra/.terraform -o -path './infra/*/.terraform' \) -prune -o \( -type f -o -type l \) -print) |
    sed 's|^\./||' |
    grep -Ev '^infra/(.*/)?(terraform\.tfvars|terraform\.tfvars\.json|backend\.hcl|[^/]*\.tfstate[^/]*|[^/]*\.log)$' |
    LC_ALL=C sort > "$WORK/source.list" || die "couldn't list the tree's files"
  (cd "$REPO" && zip -q -X -y "$out" -@ < "$WORK/source.list") || die "couldn't archive the tree"
  say "runner mode: archived the tree's $(wc -l < "$WORK/source.list" | tr -d ' ') files, without the gitignored infra inputs"
}

# --- step 0: the account's plan -----------------------------------------------------------------

# Before anything that costs money. An account on AWS's Free plan can't take CloudFront's flat-rate
# plans, and it closes when that plan expires unless upgraded: a decision about money, not this
# script's. Bootstrap stops here too, since a Free-plan account would stop the deploy after it. A
# profile that may not read the account's plan carries on as for a plan that can't be read.
if [ "$MODE" != dns ] && [ "$MODE" != check ] && [ "$MODE" != attach-boundary ]; then
  set -- $(aws --region us-east-1 --no-cli-pager freetier get-account-plan-state \
    --query '[accountPlanType, accountPlanStatus, accountPlanExpirationDate]' --output text 2> "$WORK/plan-state.err" || true)
  case "${1:-}" in
    PAID) say "account plan: PAID" ;;
    FREE)
      say "account plan: FREE, ${2:-?}, expires ${3:-?}"
      echo "RESULT: STOPPED before any change. Send us this line: account plan FREE, ${2:-?}, expires ${3:-?} (log: $LOG)"
      exit 0
      ;;
    *)
      # AWS doesn't say what older accounts get here. Carrying on costs nothing: if the account
      # can't take the flat-rate plan, the subscription is refused and the web ACL removed.
      cat "$WORK/plan-state.err"
      say "couldn't read the account's plan; carrying on, and the flat-rate subscription will fail closed if the account can't take it"
      ;;
  esac
fi

# --- state -------------------------------------------------------------------------------------

# The bucket every stack keeps its state in, made once and kept private: versioned (an older state
# can be put back), encrypted, TLS only, owner-enforced, no public access. Then the gitignored
# backend.hcl of each stack, where missing.
if [ "$MODE" = state ]; then
  S3=(aws --region us-east-1 --no-cli-pager s3api)
  ACCOUNT="$(aws --region us-east-1 --no-cli-pager sts get-caller-identity --query Account --output text)"
  [[ "$ACCOUNT" =~ ^[0-9]{12}$ ]] || die "couldn't read the account id"
  BUCKET="splitwit-tfstate-$ACCOUNT-us-east-1"
  if "${S3[@]}" head-bucket --bucket "$BUCKET" --expected-bucket-owner "$ACCOUNT" 2> "$WORK/head.err"; then
    say "the state bucket $BUCKET is there"
  elif grep -qE '\b(404|Not Found|NoSuchBucket)\b' "$WORK/head.err"; then
    say "the state bucket $BUCKET doesn't exist yet: this makes it, private, versioned and encrypted"
    if ! confirm; then
      echo "RESULT: ABORTED (nothing made, log: $LOG)"
      exit 0
    fi
    "${S3[@]}" create-bucket --bucket "$BUCKET" --object-ownership BucketOwnerEnforced > /dev/null ||
      die "couldn't make $BUCKET (above)"
  else
    cat "$WORK/head.err"
    die "$BUCKET exists but isn't this account's, or couldn't be read (above)"
  fi
  "${S3[@]}" put-public-access-block --bucket "$BUCKET" --expected-bucket-owner "$ACCOUNT" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true ||
    die "couldn't block public access on $BUCKET"
  "${S3[@]}" put-bucket-versioning --bucket "$BUCKET" --expected-bucket-owner "$ACCOUNT" \
    --versioning-configuration Status=Enabled || die "couldn't turn on versioning"
  "${S3[@]}" put-bucket-encryption --bucket "$BUCKET" --expected-bucket-owner "$ACCOUNT" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}' || die "couldn't set encryption"
  "${S3[@]}" put-bucket-policy --bucket "$BUCKET" --expected-bucket-owner "$ACCOUNT" --policy "$(jq -cn --arg b "$BUCKET" '{
    Version: "2012-10-17",
    Statement: [{Sid: "TLSOnly", Effect: "Deny", Principal: "*", Action: "s3:*",
      Resource: ["arn:aws:s3:::\($b)", "arn:aws:s3:::\($b)/*"], Condition: {Bool: {"aws:SecureTransport": "false"}}}]}')" ||
    die "couldn't set the TLS-only policy"
  # Read back what matters
  [ "$("${S3[@]}" get-bucket-versioning --bucket "$BUCKET" --query Status --output text)" = Enabled ] || die "versioning isn't on"
  [ "$("${S3[@]}" get-public-access-block --bucket "$BUCKET" --output json |
    jq -r '.PublicAccessBlockConfiguration | [.BlockPublicAcls, .IgnorePublicAcls, .BlockPublicPolicy, .RestrictPublicBuckets] | all')" = true ] ||
    die "public access isn't blocked"
  [ "$("${S3[@]}" get-bucket-ownership-controls --bucket "$BUCKET" --query 'OwnershipControls.Rules[0].ObjectOwnership' --output text)" = BucketOwnerEnforced ] ||
    die "object ownership isn't BucketOwnerEnforced"
  say "the state bucket is private, versioned, encrypted and TLS only"
  for pair in ":terraform" "/bootstrap:bootstrap" "/dns:dns"; do
    dir="$HERE${pair%%:*}" key="splitwit/${pair#*:}.tfstate"
    if [ -f "$dir/backend.hcl" ]; then
      grep -q "\"$BUCKET\"" "$dir/backend.hcl" || die "${dir#"$REPO"/}/backend.hcl names another bucket; check it before going on"
      say "  ${dir#"$REPO"/}/backend.hcl is there"
    else
      printf 'bucket       = "%s"\nkey          = "%s"\nregion       = "us-east-1"\nencrypt      = true\nuse_lockfile = true\n' \
        "$BUCKET" "$key" > "$dir/backend.hcl"
      say "  wrote ${dir#"$REPO"/}/backend.hcl ($key)"
    fi
  done
  echo "RESULT: OK (log: $LOG)"
  exit 0
fi

# --- bootstrap ---------------------------------------------------------------------------------

if [ "$MODE" = bootstrap ]; then
  BOOT="$HERE/bootstrap"
  [ -f "$BOOT/terraform.tfvars.json" ] || die "infra/bootstrap/terraform.tfvars.json is missing (copy the .example)"
  # ACM checks CAA when it issues, so the certificate made here could never be issued without it
  BOOT_APEX="$(jq -r '(.hostnames // ["splitwit.us"])[0]' "$BOOT/terraform.tfvars.json")"
  caa_admits_amazon "$BOOT_APEX" ||
    die "CAA for $BOOT_APEX doesn't admit amazon.com at its nameservers, so ACM couldn't issue the certificate; run deploy.sh --dns adopt first"
  tf_init "$BOOT"
  tf "$BOOT" plan -input=false -lock=true -var-file=terraform.tfvars.json -out="$WORK/boot.plan"
  if ! review_plan "$BOOT" "$WORK/boot.plan"; then
    echo "RESULT: ABORTED (nothing applied, log: $LOG)"
    exit 0
  fi
  apply_plan "$BOOT" "$WORK/boot.plan"
  echo
  say "the certificate's validation records; deploy.sh --dns apply adds them:"
  tf "$BOOT" output -json acm_validation_records | jq -r '.[] | "  \(.name) \(.type) \(.value)"'
  echo "RESULT: OK (log: $LOG)"
  exit 0
fi

# --- dns ---------------------------------------------------------------------------------------

if [ "$MODE" = dns ]; then
  DNS="$HERE/dns"
  [ -f "$DNS/terraform.tfvars.json" ] || die "infra/dns/terraform.tfvars.json is missing (copy the .example)"
  ZONE_ID="$(jq -r '.zone_id // empty' "$DNS/terraform.tfvars.json")"
  APEX="$(jq -r '.apex // "splitwit.us"' "$DNS/terraform.tfvars.json")"
  # Left out, the zone id is the one zone the token reaches, which must be named the apex
  [ -z "$ZONE_ID" ] || [[ "$ZONE_ID" =~ ^[0-9a-f]{32}$ ]] || die "zone_id in infra/dns/terraform.tfvars.json is not a zone id"
  for key in serve_from adopt existing_records distribution_domain acm_validation_records; do
    jq -e --arg k "$key" 'has($k) | not' "$DNS/terraform.tfvars.json" > /dev/null ||
      die "$key is set by deploy.sh for each run; take it out of infra/dns/terraform.tfvars.json"
  done

  if [ "$RUNNER" = yes ]; then
    # Read by the shell itself, so the token is in no program's arguments
    CF_TOKEN="$(< "$CLOUDFLARE_API_TOKEN_FILE")" || CF_TOKEN=""
    unset CLOUDFLARE_API_TOKEN_FILE
    say "read the Cloudflare API token from the file CLOUDFLARE_API_TOKEN_FILE names"
  else
    read -r -s -p "Cloudflare API token for $APEX (input hidden): " CF_TOKEN || CF_TOKEN=""
    echo
  fi
  [[ "$CF_TOKEN" =~ ^[A-Za-z0-9_-]{40,}$ ]] || die "that isn't a Cloudflare API token"
  # GET from Cloudflare's API; the token reaches curl on its standard input, never its arguments
  cf() {
    printf 'header = "Authorization: Bearer %s"\n' "$CF_TOKEN" |
      curl -sS --fail-with-body --max-time 30 -K - "https://api.cloudflare.com/client/v4$1"
  }

  # The token reaches this zone and no other
  cf "/zones?per_page=50" > "$WORK/zones.json" ||
    die "Cloudflare refused to list zones (above); the token needs Zone · Zone · Read on $APEX as well as Zone · DNS · Edit"
  if [ -z "$ZONE_ID" ]; then
    ZONE_ID="$(jq -r --arg apex "$APEX" 'if .success and (.result | length) == 1 and .result[0].name == $apex then .result[0].id else empty end' "$WORK/zones.json")"
    [[ "$ZONE_ID" =~ ^[0-9a-f]{32}$ ]] ||
      die "the token must reach $APEX and no other zone; it reaches: $(jq -r '[.result[]?.name] | join(", ")' "$WORK/zones.json")"
    say "zone $APEX: $ZONE_ID (the token's one zone)"
  fi
  jq -e --arg id "$ZONE_ID" --arg apex "$APEX" \
    '.success and (.result | length) == 1 and .result[0].id == $id and .result[0].name == $apex' "$WORK/zones.json" > /dev/null ||
    die "the token must reach $APEX ($ZONE_ID) and no other zone; it reaches: $(jq -r '[.result[]?.name] | join(", ")' "$WORK/zones.json")"

  # Every record in the zone, for imports and for the check that nothing in it goes unmanaged
  cf "/zones/$ZONE_ID/dns_records?per_page=5000" > "$WORK/records.json" || die "could not list the zone's records (above)"
  jq -e '.success and .result_info.total_count == (.result | length)' "$WORK/records.json" > /dev/null ||
    die "Cloudflare's list of records came back incomplete"
  say "records in the zone now:"
  jq -r '.result[] | "  \(.type) \(.name) \(.content)\(if .proxied then " (proxied)" else "" end)"' "$WORK/records.json"

  tf_init "$DNS"
  tf "$DNS" output -json > "$WORK/dns-out.json"
  CURRENT="$(jq -r '.serve_from.value // empty' "$WORK/dns-out.json")"
  case "$DNS_MODE" in
    adopt)
      [ -z "$CURRENT" ] || die "the zone is adopted already; use --dns apply"
      SERVE_FROM=vercel
      ;;
    apply) SERVE_FROM="$CURRENT" ;;
    cutover) SERVE_FROM=cloudfront ;;
    rollback) SERVE_FROM=vercel ;;
  esac
  [ -n "$CURRENT" ] || [ "$DNS_MODE" = adopt ] || die "infra/dns has no state yet; run deploy.sh --dns adopt first"

  DIST=""
  if [ "$SERVE_FROM" = cloudfront ]; then
    tf_init "$HERE"
    DIST="$(tf "$HERE" output -json | jq -r '.distribution_domain.value // empty')"
    [[ "$DIST" =~ ^[a-z0-9]+\.cloudfront\.net$ ]] || die "the main stack has no distribution yet; run deploy.sh first"
  fi
  tf_init "$HERE/bootstrap"
  tf "$HERE/bootstrap" output -json > "$WORK/boot.json"

  jq -n --arg serve "$SERVE_FROM" --arg dist "$DIST" --argjson adopt "$([ "$DNS_MODE" = adopt ] && echo true || echo false)" \
    --arg zone "$ZONE_ID" --slurpfile records "$WORK/records.json" --slurpfile boot "$WORK/boot.json" '{
      zone_id: $zone,
      serve_from: $serve,
      adopt: $adopt,
      distribution_domain: (if $dist == "" then null else $dist end),
      acm_validation_records: ($boot[0].acm_validation_records.value // []),
      existing_records: [$records[0].result[] | {id, type, name, content: (.content // ""), priority, tag: .data.tag, value: .data.value}]
    }' > "$WORK/run.tfvars.json"

  CLOUDFLARE_API_TOKEN="$CF_TOKEN" tf "$DNS" plan -input=false -lock=true \
    -var-file=terraform.tfvars.json -var-file="$WORK/run.tfvars.json" -out="$WORK/dns.plan"
  show_plan "$DNS" "$WORK/dns.plan"

  # Nothing in the zone may be left out: each record is in the state already or imported now
  jq -r --slurpfile plan "$WORK/plan.json" '
    ([$plan[0].prior_state.values.root_module.resources[]?.values.id]
      + [$plan[0].resource_changes[] | .change.importing.id // empty | split("/")[1]]) as $known
    | .existing_records[] | select(.id as $id | $known | index($id) | not) | "  \(.type) \(.name) \(.content)"' \
    "$WORK/run.tfvars.json" > "$WORK/unmanaged.txt"
  if [ -s "$WORK/unmanaged.txt" ]; then
    cat "$WORK/unmanaged.txt"
    [ "$RUNNER" = no ] || refuse "the zone has records (above) that infra/dns doesn't manage"
    die "the zone has records (above) that infra/dns doesn't manage; nothing was changed. Send us this list."
  fi

  # Each mode allows its own changes: adopt imports and adds, apply only adds and updates, and a
  # cutover or rollback replaces the apex and www records and nothing else (a plain create of one
  # finishes a run that failed between the delete and the create)
  if ! jq -e --arg mode "$DNS_MODE" '
    [.resource_changes[] | select(.change.actions != ["no-op"] or .change.importing != null)]
    | if $mode == "adopt" then all(.[]; (.change.actions | index("delete")) == null)
      elif $mode == "apply" then all(.[]; (.change.actions | index("delete")) == null and .change.importing == null)
      else all(.[]; .change.importing == null and (
        ((.address | startswith("cloudflare_dns_record.site[")) and (.change.actions == ["delete", "create"] or .change.actions == ["create"]))
        or ((.address | startswith("cloudflare_dns_record.vercel_extra[")) and .change.actions == (if $mode == "cutover" then ["delete"] else ["create"] end))))
      end' "$WORK/plan.json" > /dev/null; then
    [ "$RUNNER" = no ] || refuse "the plan has changes (above) that --dns $DNS_MODE doesn't make"
    die "the plan has changes (above) that --dns $DNS_MODE doesn't make; nothing was changed. Send us this list."
  fi

  if ! approve; then
    echo "RESULT: ABORTED (nothing applied, log: $LOG)"
    exit 0
  fi
  CLOUDFLARE_API_TOKEN="$CF_TOKEN" apply_plan "$DNS" "$WORK/dns.plan"
  CF_TOKEN=""

  # Each record as the zone's nameservers serve it now. Cloudflare's own HTTPS records, made for
  # proxied names, aren't asked for.
  tf "$DNS" show -json > "$WORK/dns-state.json"
  jq -r '.values.root_module.resources[]? | select(.type == "cloudflare_dns_record") | .values
    | [.name, .type, (.content // "" | ltrimstr("\"") | rtrimstr("\"")), (.proxied // false), (.priority // ""), (.data.tag // ""), (.data.value // "")] | map(tostring) | join("\u001f")' \
    "$WORK/dns-state.json" > "$WORK/served.txt"
  NAMESERVERS="$(zone_ns "$APEX" | tr '\n' ' ')"
  [ -n "$NAMESERVERS" ] || die "no nameservers answer for $APEX"
  failed=0
  for ns in $NAMESERVERS; do
    for attempt in 1 2 3 4 5 6; do
      missing=""
      # Fields split on the unit separator: empty ones would merge if split on tabs
      while IFS=$'\x1f' read -r name type content proxied priority tag value; do
        case "$type" in
          CNAME) [ "$name" = "$APEX" ] && want=A || want=CNAME ;;
          *) want="$type" ;;
        esac
        got="$(dig +short +norecurse @"$ns" "$want" "$name" | sed 's/\.$//')"
        case "$type/$want/$proxied" in
          */true | CNAME/A/*) [ -n "$got" ] || missing="$missing $type:$name" ;;
          # Cloudflare serves some CAs' records with parameters added ("pki.goog; cansignhttpexchanges=yes")
          CAA/*) printf '%s\n' "$got" | sed -E 's/"([^";]+);[^"]*"$/"\1"/' | grep -qxF "0 $tag \"$value\"" || missing="$missing CAA:$value" ;;
          TXT/*) printf '%s\n' "$got" | grep -qxF "\"$content\"" || missing="$missing TXT:$name" ;;
          MX/*) printf '%s\n' "$got" | grep -qxF "$priority ${content%.}" || missing="$missing MX:$name" ;;
          *) printf '%s\n' "$got" | grep -qxF "${content%.}" || missing="$missing $type:$name" ;;
        esac
      done < "$WORK/served.txt"
      [ -n "$missing" ] || break
      [ "$attempt" = 6 ] || sleep 10
    done
    if [ -n "$missing" ]; then
      say "  FAIL  $ns doesn't serve:$missing"
      failed=1
    else
      say "  ok    $ns serves every record"
    fi
  done
  [ "$failed" = 0 ] || die "a nameserver doesn't serve the records yet (above); check again in a few minutes with dig"
  echo "RESULT: OK (log: $LOG)"
  exit 0
fi

# --- deploy: the source and the stacks' settings ------------------------------------------------

[ -f "$HERE/terraform.tfvars.json" ] || die "infra/terraform.tfvars.json is missing (copy the .example)"
REGION="$(jq -r '.aws_region // "us-east-1"' "$HERE/terraform.tfvars.json")"
[[ "$REGION" =~ ^[a-z]{2}(-[a-z]+)+-[0-9]$ ]] || die "aws_region in terraform.tfvars.json is not a region: $REGION"
AWS=(aws --region "$REGION" --no-cli-pager)

# --- the permissions boundary on the four roles ------------------------------------------------
# Both stacks are planned with permissions_boundary_arn from their own terraform.tfvars.json, and
# applied only if neither plan changes anything but those roles' boundary.
if [ "$MODE" = attach-boundary ]; then
  BOOT="$HERE/bootstrap"
  [ -f "$BOOT/terraform.tfvars.json" ] || die "infra/bootstrap/terraform.tfvars.json is missing (copy the .example)"
  tf_init "$BOOT"
  tf_init "$HERE"
  # The image the stack runs now, so that the function's plan is unchanged
  DIGEST="$(tf "$HERE" output -json | jq -r '.image_uri.value // "" | sub(".*@"; "")')"
  [[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || die "the main stack has no image yet; deploy first"
  tf "$BOOT" plan -input=false -lock=true -var-file=terraform.tfvars.json -out="$WORK/boot.plan"
  tf "$HERE" plan -input=false -lock=true -var-file=terraform.tfvars.json -var "image_digest=$DIGEST" -out="$WORK/main.plan"
  for stack in boot main; do
    if [ "$stack" = boot ]; then dir="$BOOT"; else dir="$HERE"; fi
    show_plan "$dir" "$WORK/$stack.plan"
    cp "$WORK/plan.json" "$WORK/$stack-plan.json"
    jq -e --argjson roles "$ROLES" "$ATTACH_ONLY" "$WORK/plan.json" > /dev/null ||
      refuse "the plan in ${dir#"$REPO"/} changes more than the roles' permissions boundary (above)"
    jq -e "$ROLES_BOUNDED" "$WORK/plan.json" > /dev/null ||
      die "a role in ${dir#"$REPO"/} would have no permissions boundary: set permissions_boundary_arn in its terraform.tfvars.json (see the .example)"
  done
  if jq -s -e 'all(.[].resource_changes[]?; .change.actions != ["update"])' "$WORK/boot-plan.json" "$WORK/main-plan.json" > /dev/null; then
    say "every role has its permissions boundary already; nothing to apply"
    echo "RESULT: OK (log: $LOG)"
    exit 0
  fi
  if ! approve; then
    echo "RESULT: ABORTED (nothing applied, log: $LOG)"
    exit 0
  fi
  for stack in boot main; do
    if [ "$stack" = boot ]; then dir="$BOOT"; else dir="$HERE"; fi
    jq -e 'any(.resource_changes[]?; .change.actions == ["update"])' "$WORK/$stack-plan.json" > /dev/null || continue
    apply_plan "$dir" "$WORK/$stack.plan"
  done
  say "the permissions boundary is on: $(jq -r '.planned_values.root_module.resources[]? | select(.type == "aws_iam_role") | .values.name' \
    "$WORK/boot-plan.json" "$WORK/main-plan.json" | tr '\n' ' ')"
  echo "RESULT: OK (log: $LOG)"
  exit 0
fi

# --- recovery: a web ACL left in the state without a flat-rate subscription ---------------------
if [ "$MODE" = drop-flat-rate ]; then
  tf_init "$HERE"
  if ! web_acl_unsubscribed; then
    say "the state holds no web ACL without a flat-rate subscription; nothing to remove"
    echo "RESULT: OK (log: $LOG)"
    exit 0
  fi
  drop_flat_rate_plan
fi

# --- checks: after a deploy, and alone with --check ------------------------------------------------
run_checks() {
tf "$HERE" output -json > "$WORK/main.json"
DIST="$(jq -r '.distribution_domain.value' "$WORK/main.json")"
URL="$(jq -r '.function_url.value' "$WORK/main.json")"
APEX="$(jq -r '(.hostnames // ["splitwit.us"])[0]' "$HERE/terraform.tfvars.json")"
failed=0
check() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    say "  ok    $what: $got"
  else
    say "  FAIL  $what: got '$got', want '$want'"
    failed=1
  fi
}

say "checks (CloudFront can take a few minutes to deploy a new distribution; rerun them with the same commands if it is still in progress):"
code() { curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$@" || echo "no answer"; }

# The function URL refuses anything CloudFront didn't sign
check "function URL called directly" 403 "$(code "$URL")"
# Through the distribution, addressed by the site's names whatever DNS says today
check "https://$APEX/" 200 "$(code --connect-to "$APEX:443:$DIST:443" "https://$APEX/")"
check "HSTS on https://$APEX/" "max-age=63072000; includeSubDomains; preload" \
  "$(curl -sS -o /dev/null -D - --max-time 20 --connect-to "$APEX:443:$DIST:443" "https://$APEX/" | tr -d '\r' | sed -n 's/^[Ss]trict-[Tt]ransport-[Ss]ecurity: //p' | head -1)"
check "http://$APEX/" 301 "$(code --connect-to "$APEX:80:$DIST:80" "http://$APEX/")"
check "https://www.$APEX/ redirect" "https://$APEX/" \
  "$(curl -sS -o /dev/null -w '%{redirect_url}' --max-time 20 --connect-to "www.$APEX:443:$DIST:443" "https://www.$APEX/")"
PLAN_STATUS="$(jq -r '.flat_rate_plan.value // "off" | if . == "off" then . else ascii_upcase end' "$WORK/main.json")"
case "$PLAN_STATUS" in
  off) say "  --    flat-rate plan: off (flat_rate_plan = false), so no rate limit" ;;
  SYNC_IN_PROGRESS) say "  ok    flat-rate plan subscription: SYNC_IN_PROGRESS (being applied; ACTIVE within minutes)" ;;
  *) check "flat-rate plan subscription" ACTIVE "$PLAN_STATUS" ;;
esac
# SNS sends the alert address a confirmation email; until its link is clicked, alarms reach nobody
TOPIC="$(jq -r '.alerts_topic_arn.value // empty' "$WORK/main.json")"
if [ -n "$TOPIC" ]; then
  subs="$("${AWS[@]}" sns list-subscriptions-by-topic --topic-arn "$TOPIC" \
    --query "Subscriptions[?Protocol=='email'].SubscriptionArn" --output text 2> /dev/null || echo unreadable)"
  case "$subs" in
    arn:aws:sns:*) say "  ok    the alert email is confirmed" ;;
    *PendingConfirmation*) say "  WAIT  the alert email isn't confirmed yet: click Confirm in AWS's email to the alert address, then deploy.sh --check" ;;
    *) say "  FAIL  couldn't read the alert email's subscription: ${subs:-none}"; failed=1 ;;
  esac
fi
if command -v dig > /dev/null; then
  if dig +short CAA "$APEX" | grep -q '"amazon.com"'; then
    say "  ok    CAA admits amazon.com"
  else
    say "  FAIL  CAA does not admit amazon.com: ACM cannot renew the certificate (infra/dns)"
    failed=1
  fi
fi

# Informational: whether the site's own DNS reaches CloudFront yet (it doesn't before the cutover)
if curl -sS -o /dev/null -D - --max-time 20 "https://$APEX/" 2> /dev/null | tr -d '\r' | grep -qi '^x-amz-cf-id:'; then
  say "  --    through DNS, https://$APEX/ is served by CloudFront"
else
  say "  --    through DNS, https://$APEX/ isn't served by CloudFront (expected before the cutover)"
fi

echo
say "image $DIGEST is live on $FUNCTION; the distribution is $DIST"
[ "$failed" = 0 ] || die "a check failed (above)"
echo "RESULT: OK (log: $LOG)"
}

if [ "$MODE" = check ]; then
  tf_init "$HERE"
  DIGEST="$(tf "$HERE" output -json | jq -r '.image_uri.value // "" | sub(".*@"; "")')"
  [ -n "$DIGEST" ] || die "the main stack has no image yet; deploy first"
  run_checks
  exit 0
fi

tf_init "$HERE/bootstrap"
tf "$HERE/bootstrap" output -json > "$WORK/boot.json"
SOURCE_BUCKET="$(jq -r '.source_bucket.value // empty' "$WORK/boot.json")"
PROJECT="$(jq -r '.codebuild_project.value // empty' "$WORK/boot.json")"
[ -n "$SOURCE_BUCKET" ] && [ -n "$PROJECT" ] || die "infra/bootstrap has no outputs; run deploy.sh --bootstrap first"

# The image the function runs now, if it exists yet
LIVE="$("${AWS[@]}" lambda get-function --function-name "$FUNCTION" --query 'Code.ResolvedImageUri' --output text 2> "$WORK/live.err" || true)"
if [ -z "$LIVE" ] || [ "$LIVE" = None ]; then
  grep -q ResourceNotFoundException "$WORK/live.err" || { cat "$WORK/live.err"; die "could not read the function's current image"; }
  LIVE=""
  say "the function doesn't exist yet: this is the first deploy"
else
  LIVE="${LIVE##*@}"
  say "live image: $LIVE"
fi

# App images in ECR, oldest first: "<digest> <pushed at>"
"${AWS[@]}" ecr describe-images --repository-name "$REPOSITORY" --filter tagStatus=TAGGED \
  --query 'sort_by(imageDetails, &imagePushedAt)[].[imageDigest, imagePushedAt]' --output text > "$WORK/images.txt"

if [ -n "$DIGEST" ]; then
  # --- a deploy of an existing image: no source, no build ------------------------------------
  grep -q "^$DIGEST[[:space:]]" "$WORK/images.txt" || die "$DIGEST is not a tagged image in the $REPOSITORY repository"
  say "deploying the existing image $DIGEST (no build)"
else
  # --- the source ----------------------------------------------------------------------------
  if [ "$RUNNER" = yes ]; then
    SHA="$DEPLOY_COMMIT"
    say "runner mode: the tree is commit $SHA as the runner verified it, so git isn't asked and the clean-tree and pushed checks are the runner's"
  else
    cd "$REPO"
    [ -z "$(git status --porcelain)" ] || die "the working tree has changes or untracked files; deploy a clean commit"
    current="$(git symbolic-ref --quiet --short HEAD || true)"
    [ "$current" = "$BRANCH" ] || die "HEAD is on '${current:-a detached HEAD}', not '$BRANCH' (use --branch to name another)"
    if [ "$ALLOW_UNPUSHED" = yes ]; then
      say "--allow-unpushed: the commit may not be on origin"
    else
      git fetch --quiet origin "$BRANCH" || die "could not fetch origin/$BRANCH"
      git merge-base --is-ancestor HEAD FETCH_HEAD || die "HEAD is not on origin/$BRANCH; push it first (or --allow-unpushed)"
    fi
    SHA="$(git rev-parse HEAD)"
  fi

  # The lifecycle guard: a new image pushes the oldest of the kept ones out, and if that one
  # is live, Lambda fails the function. Refuse while the live image is about to be pushed out.
  if [ -n "$LIVE" ]; then
    newer="$(awk -v live="$LIVE" 'found { n++ } $1 == live { found = 1 } END { print (found ? n + 0 : -1) }' "$WORK/images.txt")"
    [ "$newer" -ge 0 ] || die "the live image $LIVE is not in the repository any more; deploy a kept image with --digest first"
    if [ "$newer" -ge $((KEEP_IMAGES - 1)) ]; then
      die "the live image has $newer newer images; one more build would push it out of the $KEEP_IMAGES kept. Deploy a recent image with --digest first."
    fi
  fi

  if [ "$RUNNER" = yes ]; then
    tree_archive "$WORK/source.zip"
  else
    git archive --format=zip -o "$WORK/source.zip" "$SHA"
  fi
  ZIP_SHA256="$(shasum -a 256 "$WORK/source.zip" | cut -d' ' -f1)"
  TAG="app-${SHA:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
  KEY="manual/$ZIP_SHA256.zip"
  say "commit $SHA, source sha256 $ZIP_SHA256, tag $TAG"

  VERSION_ID="$("${AWS[@]}" s3api put-object --bucket "$SOURCE_BUCKET" --key "$KEY" --body "$WORK/source.zip" \
    --checksum-algorithm SHA256 --query VersionId --output text)"
  [ -n "$VERSION_ID" ] && [ "$VERSION_ID" != None ] || die "the upload returned no version id (is versioning on?)"

  # --- the build -----------------------------------------------------------------------------
  BUILD_ID="$("${AWS[@]}" codebuild start-build --project-name "$PROJECT" \
    --source-location-override "$SOURCE_BUCKET/$KEY" --source-version "$VERSION_ID" \
    --environment-variables-override "name=IMAGE_TAG,value=$TAG,type=PLAINTEXT" \
    --query build.id --output text)"
  say "build $BUILD_ID started; checking every 15 s"
  started=$SECONDS
  misses=0
  while :; do
    # A failed or empty read (a network blip, an expiring session) is retried, not taken as the
    # build's end: the build carries on in CodeBuild either way.
    status="" phase=""
    read -r status phase < <("${AWS[@]}" codebuild batch-get-builds --ids "$BUILD_ID" \
      --query 'builds[0].[buildStatus, currentPhase]' --output text) || true
    case "$status" in
      IN_PROGRESS | SUCCEEDED | FAILED | FAULT | TIMED_OUT | STOPPED) misses=0 ;;
      *)
        misses=$((misses + 1))
        [ "$misses" -lt 3 ] || die "couldn't read build $BUILD_ID's status; it may still be running"
        say "  couldn't read the build's status; trying again in 15 s"
        sleep 15
        continue
        ;;
    esac
    [ "$status" = IN_PROGRESS ] || break
    [ $((SECONDS - started)) -lt "$BUILD_TIMEOUT_S" ] || die "the build is still running after $BUILD_TIMEOUT_S s; see CodeBuild"
    say "  $phase"
    sleep 15
  done
  [ "$status" = SUCCEEDED ] || die "the build ended $status in phase $phase; see its log in CodeBuild"

  # The digest is read back from ECR, not taken from the build's output. The tag is new and the
  # repository's tags are immutable, so exactly one image carries it, and Lambda needs it to be a
  # single image manifest rather than an index.
  "${AWS[@]}" ecr describe-images --repository-name "$REPOSITORY" --image-ids "imageTag=$TAG" \
    --query 'imageDetails[].[imageDigest, imageManifestMediaType]' --output text > "$WORK/built.txt"
  [ "$(wc -l < "$WORK/built.txt" | tr -d ' ')" = 1 ] || die "expected exactly one image tagged $TAG"
  read -r DIGEST media < "$WORK/built.txt"
  [[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || die "ECR returned an unexpected digest: $DIGEST"
  case "$media" in
    application/vnd.docker.distribution.manifest.v2+json | application/vnd.oci.image.manifest.v1+json) ;;
    *) die "the image is $media, not a single image manifest; Lambda would refuse it" ;;
  esac
  say "built $DIGEST"
fi

# --- plan and apply the main stack -------------------------------------------------------------

tf_init "$HERE"
tf "$HERE" plan -input=false -lock=true -var-file=terraform.tfvars.json -var "image_digest=$DIGEST" -out="$WORK/main.plan"
if ! review_plan "$HERE" "$WORK/main.plan"; then
  echo "RESULT: ABORTED (nothing applied; the image $DIGEST stays in ECR, log: $LOG)"
  exit 0
fi
apply_plan "$HERE" "$WORK/main.plan"

run_checks
