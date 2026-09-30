// CF Workers scheduled() handler.

import { createDeps } from '../server/composition'
import { createCloudflarePlatform } from '../server/platform/cloudflare'
import { syncPendingRemoteDownloadUsageReports } from '../server/usecases/downloads/remote-download-usage'
import { purgeExpiredResourceChanges } from '../server/usecases/resource-changes'
import { reconcileImageDomains } from '../server/usecases/site/image-domain-provider'
import { runLicensingRefresh } from '../server/usecases/site/licensing'
import { syncPendingCloudTrafficReports } from '../server/usecases/store/traffic-metering'
import { ZPAN_CLOUD_URL_DEFAULT } from '../shared/constants'

// Subset of the worker Env used by the scheduled handler.
// The full Env is defined in bootstrap.ts; this avoids circular imports.
export interface ScheduledEnv {
  DB: D1Database
  ZPAN_CLOUD_URL?: string
  ZPAN_TELEMETRY_ALLOW_IP?: string
  ZPAN_TRASH_RETENTION_DAYS?: string
  [key: string]: unknown
}

const TRAFFIC_SYNC_CRON = '*/10 * * * *'
const STATS_ROLLUP_CRON = '10 * * * *'
type ScheduledTrigger = Pick<ScheduledEvent, 'cron'>

export async function handleScheduled(event: ScheduledTrigger, env: ScheduledEnv): Promise<void> {
  const platform = createCloudflarePlatform(env)
  const deps = createDeps(platform)
  const cloudBaseUrl = env.ZPAN_CLOUD_URL ?? ZPAN_CLOUD_URL_DEFAULT
  if (event.cron === TRAFFIC_SYNC_CRON) {
    await deps.quota.reconcileFreePlanBaselines()
    await Promise.all([
      syncPendingCloudTrafficReports(deps, { cloudBaseUrl }),
      syncPendingRemoteDownloadUsageReports(deps, { cloudBaseUrl }),
    ])
    return
  }

  if (event.cron === STATS_ROLLUP_CRON) {
    const now = new Date()
    await Promise.all([
      deps.adminStats.refreshHourlyRollups(now),
      deps.webdavState.purgeExpiredLocks(),
      purgeExpiredResourceChanges(deps, now),
      reconcileImageDomains(deps),
    ])
    return
  }

  await runLicensingRefresh(deps, cloudBaseUrl)
}
