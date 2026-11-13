# Uptime of the hosted demo

The hosted demo stays up until **2026-11-25** (HACKATHON.md Q-012). Two layers watch it. Both alert the owner.

## On the host: `omniswarm-health.timer`

It runs `infra/deploy/health.sh` every minute, as root. `release.sh` enables it on every deploy.

| Check | Passes when |
|---|---|
| `api-health` | `GET https://<domain>/api/health`, sent to nginx on 127.0.0.1:443, answers 200 with `"ok":true` |
| `api-ready` | `GET /api/ready` answers 200: the database is reachable, migrations are applied, the queue is installed |
| `workers` | `omniswarm-workers.target` and every enabled `omniswarm-worker@N` are active, and `/api/health` counts at least one live worker (pg-boss) |
| `disk` | `/srv/omniswarm` and Docker's data root are under `OMNI_DISK_ALARM_PCT` (80 %) used |

When a check fails `OMNI_HEALTH_RESTART_AFTER` (2) runs in a row:
- The host repairs it. Unhealthy containers restart. A stopped or missing api, web or nginx container starts again. Failed workers are reset and started. The repair repeats every 10 further failed runs.
- It sends one alert to `OMNI_ALERT_WEBHOOK_URL`, and one more when the check recovers.
- A full disk alerts but is not repaired.

Every all-green run fetches `OMNI_HEARTBEAT_URL`. Both URLs live in `/etc/omniswarm/ops.env` (`infra/env/ops.env.example`).

Look at it on the host:

```sh
systemctl list-timers 'omniswarm-*'
journalctl -u omniswarm-health --since -1h        # one ok/FAIL line per check per run
journalctl -u omniswarm-health -g ALERT           # alerts sent
```

## Off the host: choose one (owner, W12-19)

The on-box timer cannot report a host that is down. Use at least one of these:

1. **Heartbeat (recommended).** Create a check on healthchecks.io (free tier), or a push monitor on Uptime Kuma or Better Stack, with a 1-minute period and 5 minutes of grace. Put its ping URL in `OMNI_HEARTBEAT_URL`. The service alerts by e-mail when the pings stop: the host is down, the timer is stuck, or a check is failing.
2. **HTTP monitor.** Use UptimeRobot or Better Stack (free tiers) with a 5-minute interval and e-mail alerts:
   - `https://<domain>/api/health`, keyword `"ok":true`
   - `https://<domain>/api/ready`, status 200
   - `https://<domain>/`, status 200
3. **Cron on the owner's machine.** The same checks as the deploy smoke test, without the rate-limit burst:
   ```cron
   */10 * * * * cd ~/OmniSwarm && infra/deploy/smoke.sh --no-burst <domain> > /tmp/omniswarm-smoke.log 2>&1 || mail -s "omniswarm smoke failed" you@example.com < /tmp/omniswarm-smoke.log
   ```

## Drill (wave check step 8)

1. On the host, stop every api container: `sudo docker stop $(sudo docker ps -q --filter label=com.docker.compose.service=api)`.
2. Within 2 minutes, `journalctl -u omniswarm-health` shows two `FAIL api-health` runs, then the repair. `docker ps` shows the api containers running again.
3. The webhook receives one `down` alert and, a minute later, one `recovered` alert.
4. The external monitor shows the outage, sends one alert, then one recovery.

## After 2026-11-25

- Stop the external monitors.
- Either keep the host running, or stop it. To stop: run `sudo systemctl disable --now omniswarm-health.timer omniswarm-workers.target`, then `docker compose ... down` (keep the `pgdata` volume and `/srv/omniswarm/{reports,backup}`). Then stop the VM.
- Copy the newest backup off the host first: `/srv/omniswarm/backup/db-*.dump` and `reports-*.tar.gz`.
