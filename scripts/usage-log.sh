#!/usr/bin/env bash
# Print the RINGO 3D usage log — one line per page visit, recorded by the
# Lambda in DynamoDB as a timestamp and nothing else. No address and no
# identifier is ever stored, so this is a visit count over time, not a
# record of who visited.
#   ./scripts/usage-log.sh            # every visit, oldest first
#   ./scripts/usage-log.sh --daily    # visits per day
set -euo pipefail

rows=$(aws dynamodb scan --region us-east-2 --table-name "${RINGO_TABLE:-ringo3d}" \
  --filter-expression 'begins_with(pk, :p)' \
  --expression-attribute-values '{":p":{"S":"LOG#"}}' \
  --query 'Items[].[central.S, utc.S]' --output text | sort -t$'\t' -k2)

if [[ "${1:-}" == "--daily" ]]; then
  awk -F'\t' '{split($1, d, " "); print d[1]}' <<<"$rows" | uniq -c | awk '{printf "%s  %s visit%s\n", $2, $1, ($1 == 1 ? "" : "s")}'
else
  column -t -s$'\t' <<<"$rows"
fi
echo "---"
printf 'total: %s visits\n' "$(wc -l <<<"$rows")"
