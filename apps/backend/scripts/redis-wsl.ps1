# Starts Redis for local backend dev WITHOUT Docker (production keeps
# using infra/docker-compose.yml — this file changes nothing about prod).
#
# Uses the existing Ubuntu WSL distro and runs redis-server on port 6380,
# matching apps/backend/.env (REDIS_URL=redis://localhost:6380).
# First run installs redis-server inside WSL (needs sudo once).
#
# Usage:  pnpm redis:wsl   (from apps/backend)

$ErrorActionPreference = "Stop"
$Port = 6380

function Test-Port($p) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $iar = $c.BeginConnect("127.0.0.1", $p, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(1000) -and $c.Connected
    $c.Close()
    return $ok
  } catch { return $false }
}

if (Test-Port $Port) {
  Write-Host "Redis already listening on 127.0.0.1:$Port — nothing to do."
  exit 0
}

Write-Host "Ensuring redis-server exists in Ubuntu WSL (sudo password may be asked once)…"
wsl -d Ubuntu -- sh -c "command -v redis-server >/dev/null || sudo apt-get update && sudo apt-get install -y redis-server"

Write-Host "Starting redis-server on port $Port (daemonized, no snapshot, no Docker)…"
wsl -d Ubuntu -- sh -c "redis-server --port $Port --daemonize yes --save '' --appendonly no"

Start-Sleep -Seconds 2
if (Test-Port $Port) {
  Write-Host "OK: Redis is up on 127.0.0.1:$Port. Restart the backend (npm run dev) to reconnect."
} else {
  Write-Error "Redis did not come up on port $Port. Run 'wsl -d Ubuntu' then 'redis-server --port $Port' to see the error."
  exit 1
}
