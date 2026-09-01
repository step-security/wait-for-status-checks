import * as core from '@actions/core'
import * as github from '@actions/github'
import {poll} from './poll'
import {wait} from './wait'
import axios, {isAxiosError} from 'axios'
import fs from 'fs'

async function validateSubscription(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH
  let repoPrivate: boolean | undefined

  if (eventPath && fs.existsSync(eventPath)) {
    const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
    repoPrivate = eventData?.repository?.private
  }

  const upstream = 'poseidon/wait-for-status-checks'
  const action = process.env.GITHUB_ACTION_REPOSITORY
  const docsUrl =
    'https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions'

  core.info('')
  core.info('\u001b[1;36mStepSecurity Maintained Action\u001b[0m')
  core.info(`Secure drop-in replacement for ${upstream}`)
  if (repoPrivate === false)
    core.info('\u001b[32m\u2713 Free for public repositories\u001b[0m')
  core.info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`)
  core.info('')

  if (repoPrivate === false) return

  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com'
  const body: Record<string, string> = {action: action || ''}
  if (serverUrl !== 'https://github.com') body.ghes_server = serverUrl
  try {
    await axios.post(
      `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
      body,
      {timeout: 3000}
    )
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 403) {
      core.error(
        `\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m`
      )
      core.error(
        `\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`
      )
      process.exit(1)
    }
    core.info('Timeout or API not reachable. Continuing to next step.')
  }
}

async function run(): Promise<void> {
  await validateSubscription()
  try {
    // read inputs
    const token = core.getInput('token', {required: true})

    // github context
    const context = github.context

    // ignore self/current job check run
    const ignore = (core.getInput('ignore') || '')
      .split(',')
      .map(check => check.trim())
    ignore.push(context.job)

    const matchPattern = core.getInput('match_pattern') || undefined
    const ignorePattern = core.getInput('ignore_pattern') || undefined

    const delaySeconds = parseInt(core.getInput('delay') || '0')
    await wait(delaySeconds * 1000)

    await poll({
      client: github.getOctokit(token),
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: pickSHA(context),
      ignoreChecks: ignore,

      matchPattern,
      ignorePattern,

      // optional
      intervalSeconds: parseInt(core.getInput('interval') || '10'),
      timeoutSeconds: parseInt(core.getInput('timeout') || '3600')
    })

    core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

function pickSHA(context: typeof github.context): string {
  switch (context.eventName) {
    case 'pull_request':
    case 'pull_request_target':
      return context.payload.pull_request?.head.sha || context.sha
    case 'push':
      return context.payload.after || context.sha
    default:
      return context.sha
  }
}

run()
