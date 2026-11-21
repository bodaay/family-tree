#!/bin/zsh
# The browser tests: Puppeteer driving the system's Chrome, each script on a
# fresh local family.
#
#   npm run test:e2e                      the whole suite: three lanes side by side,
#                                         then two lanes on a family moved to
#                                         per-person keys (design document 1.25)
#   npm run test:e2e -- name [name ...]   some scripts (tests/e2e/<name>.mjs), one lane
#   MOVE=1 npm run test:e2e -- name       the same, on a moved family
#
# Each lane starts its own API server and Vite dev server, with its server data
# and its family's links in a temporary folder, never in the repo. The family is
# a made-up one of 800 people, tests/e2e/fixture/family.json (written by
# make-family.mjs beside it; FIXTURE= another file), never a real family's.
# "name+" runs on the family the script before it left (writegate-check+ checks
# that the server's write check held all along).
#
# One line per script (lane, name, exit code, PASS and FAIL counts, seconds),
# then ALL PASSED or the number that failed (exit 1). Logs and screenshots stay
# in the temporary folder (printed at the end; set E2E_TMP to choose it). Never
# prints links or keys. CHROME: another Chrome. Scripts needing a setup of their
# own (offline, outdated, gate4, fix-rollback) run alone: see their headers.
emulate -L zsh
ROOT=${0:A:h:h:h}
E2E=$ROOT/tests/e2e
FIXTURE=${FIXTURE:-$E2E/fixture/family.json}
# double.mjs: the move's snapshot is written once (fixed in version 1.27)
export FIXED=${FIXED:-1}
TMP=${E2E_TMP:-$(mktemp -d -t ft-e2e)}
mkdir -p $TMP

# the lanes of the full suite (as in the regressions of versions 1.27 to 1.34)
LANE_A=(
  alias-search alias-merge alias-sample alias-review-merge alias-review-privacy
  mar-admin mar-member mar-sample mar-review-ext mar-review-privacy mar-review-regress
  int-old-invites int-old-access int-old-edit int-kit-rotation writegate-check+ int-merge-marriages pkeys
  export export-pick
)
LANE_B=(
  rekey-flow writegate-check+ rekey-triggers writegate-check+ rekey-review-dos writegate-check+ rekey-review-lockout writegate-check+
  lock-faceid lock-recovery lock-newphone lock-review-kit lock-review-lock
  multidev-add writegate-check+ multidev-remove writegate-check+ multidev-kit writegate-check+ multidev-admin writegate-check+
  writegate-flow back edit-req delete-req double
)
LANE_C=(
  perm-profile perm-review-auth writegate-check+ perm-review-lists perm-review-seats merge-perm-device
  combine-renew-first combine-device-gate writegate-check+
  fix-invite-survives writegate-check+ fix-kit-invite fix-weak-device writegate-check+ fix-junk-subject writegate-check+
  fix-lock-invites fix-ux-kit fix-merge-mothers
  death assess selfapprove asks decide mourning genview reach inlaws kinname nodups
  namesake ladder fcard counts minors scan genspan tabs tap3d kidslink kin-far milk
)
LANE_M1=(years widen hidden selfapprove decide kinname rekey-flow writegate-check+ mar-review-privacy int-old-invites milk writegate-check+)
LANE_M2=(asks multidev-add writegate-check+ merge-perm-device death inlaws mar-admin alias-review-privacy perm-profile)

# the family the tests were written against
cp $FIXTURE $TMP/family.json || exit 1

# lane <n> <move> <names...>: its own servers on ports 52n0 (app) and 88n0 (API)
lane() {
  local n=$1 move=$2; shift 2
  local dir=$TMP/lane$n app=$((5200 + 10 * n)) api=$((8800 + 10 * n))
  mkdir -p $dir/logs $dir/work $dir/shots
  for port in $app $api; do
    if lsof -ti tcp:$port -sTCP:LISTEN > /dev/null 2>&1; then echo "lane $n: port $port is in use"; return 1; fi
  done
  local pids=()
  (cd $ROOT && PORT=$api FT_DATA=$dir/server exec node server/index.ts > $dir/server.log 2>&1) &
  pids+=($!)
  (cd $ROOT && FT_API=http://localhost:$api exec node node_modules/vite/bin/vite.js --port $app --strictPort > $dir/vite.log 2>&1) &
  pids+=($!)
  trap "kill $pids 2>/dev/null" EXIT INT TERM
  local i
  for i in {1..60}; do
    curl -s -o /dev/null --max-time 2 http://localhost:$app/ && curl -s -o /dev/null --max-time 2 http://localhost:$api/ && break
    sleep 0.5
  done
  local base=http://localhost:$app link=$dir/work/data/secrets/invite-local.txt failed=0 name code passes fails start
  for name in "$@"; do
    if [[ $name == *+ ]]; then
      name=${name%+}
    else
      (cd $dir/work && FT_DATA=$dir/server node $ROOT/scripts/init-family.ts $TMP/family.json > /dev/null 2>&1) || { echo "$n $name: INIT FAILED"; failed=$((failed + 1)); continue; }
      if [[ $move == 1 ]]; then
        (cd $ROOT && node tests/e2e/move.ts --api $base --link $link > $dir/logs/$name.move.log 2>&1) || { echo "$n $name: MOVE FAILED"; failed=$((failed + 1)); continue; }
      fi
    fi
    start=$(date +%s)
    (cd $ROOT && FT_REPO=$ROOT SHOTS=$dir/shots OUT=$dir/shots node $E2E/$name.mjs $base $link $dir/shots > $dir/logs/$name.log 2>&1)
    code=$?
    passes=$(grep -cE '^(PASS|ok) ' $dir/logs/$name.log)
    fails=$(grep -c '^FAIL' $dir/logs/$name.log)
    echo "$n $name: exit=$code pass=$passes fail=$fails ($(( $(date +%s) - start ))s)"
    (( code == 0 && fails == 0 )) || failed=$((failed + 1))
  done
  kill $pids 2>/dev/null
  echo "$n done: $failed failed"
  (( failed == 0 ))
}

total=0
run_lanes() {
  # run_lanes <move> <lane-number:array-name> ...: side by side, then the tally
  local move=$1; shift
  local spec jobs=()
  for spec in "$@"; do
    lane ${spec%%:*} $move ${(P)${spec#*:}} > $TMP/out${spec%%:*}.txt 2>&1 &
    jobs+=($!)
    sleep 3  # the dev servers prepare their modules one after another
  done
  # every lane to its end (a wait can return early: never start the next phase,
  # or the tally, while a lane still runs)
  local j
  for j in $jobs; do
    while kill -0 $j 2>/dev/null; do wait $j 2>/dev/null || sleep 1; done
  done
  for spec in "$@"; do
    grep -v ' done: ' $TMP/out${spec%%:*}.txt
    local f=$(sed -n 's/^.* done: \([0-9]*\) failed$/\1/p' $TMP/out${spec%%:*}.txt | tail -1)
    total=$(( total + ${f:-1} ))
  done
}

if (( $# )); then
  SEL=("$@")
  run_lanes ${MOVE:-0} 1:SEL
else
  run_lanes 0 1:LANE_A 2:LANE_B 3:LANE_C
  run_lanes 1 4:LANE_M1 5:LANE_M2
fi
echo "logs: $TMP"
if (( total )); then echo "$total FAILED"; exit 1; fi
echo "ALL PASSED"
