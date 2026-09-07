#!/usr/bin/env bash
# Resume the existing Supabase CLI stack without recreating containers or volumes.
set -euo pipefail

database=supabase_db_favorite
services=(
  supabase_inbucket_favorite
  supabase_auth_favorite
  supabase_rest_favorite
  supabase_realtime_favorite
  supabase_storage_favorite
  supabase_pg_meta_favorite
  supabase_kong_favorite
)

# Preflight every container before starting anything. Never adopt another project.
for container in "$database" "${services[@]}"; do
  project=$(docker inspect --format '{{ index .Config.Labels "com.supabase.cli.project" }}' "$container")
  if [[ "$project" != favorite ]]; then
    printf 'Refusing to start %s: expected Supabase project favorite.\n' "$container" >&2
    exit 1
  fi
done

wait_ready() {
  local container=$1 state deadline=$((SECONDS + 120))
  while (( SECONDS < deadline )); do
    state=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container")
    case "$state" in
      'running healthy'|'running none')
        printf '%s: %s\n' "$container" "$state"
        return 0
        ;;
      exited*|dead*)
        printf '%s stopped before becoming ready: %s\n' "$container" "$state" >&2
        return 1
        ;;
    esac
    sleep 2
  done
  printf 'Timed out waiting for %s: %s\n' "$container" "$state" >&2
  return 1
}

docker start "$database"
wait_ready "$database"
docker start "${services[@]}"
for container in "${services[@]}"; do
  wait_ready "$container"
done

curl --fail --silent --show-error --max-time 10 \
  http://127.0.0.1:54321/auth/v1/health >/dev/null
printf 'Favorite local Supabase is ready: http://127.0.0.1:54321\n'
