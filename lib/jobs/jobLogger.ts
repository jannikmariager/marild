import { supabaseAdmin } from '@/lib/supabaseAdmin'

export interface JobLoggerCounts {
  [key: string]: number | string | boolean
}

export class JobLogger {
  private jobName: string
  private runId: string
  private startedAt: string

  constructor(jobName: string) {
    this.jobName = jobName
    this.runId = `${jobName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.startedAt = new Date().toISOString()
  }

  async start(details: Record<string, unknown> = {}) {
    await supabaseAdmin.from('job_run_log').insert({
      job_name: this.jobName,
      run_id: this.runId,
      started_at: this.startedAt,
      ok: null,
      counts: {},
      details,
    })
  }

  async finish(ok: boolean, counts: JobLoggerCounts = {}, error?: string, details?: Record<string, unknown>) {
    await supabaseAdmin
      .from('job_run_log')
      .update({
        ok,
        finished_at: new Date().toISOString(),
        counts,
        error,
        details,
      })
      .eq('run_id', this.runId)
      .eq('job_name', this.jobName)
  }

  getRunContext() {
    return { jobName: this.jobName, runId: this.runId }
  }
}

export async function withJobLogger<T>(
  jobName: string,
  fn: (logger: JobLogger) => Promise<T>,
  startDetails?: Record<string, unknown>,
) {
  const logger = new JobLogger(jobName)
  await logger.start(startDetails)
  try {
    const result = await fn(logger)
    return result
  } catch (err) {
    await logger.finish(false, {}, err instanceof Error ? err.message : String(err))
    throw err
  }
}
