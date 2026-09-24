import { existsSync, readFileSync } from 'node:fs';

export interface GitContext {
  repository: string;
  sha: string;
  pullRequest?: number;
  ref?: string;
}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{40}$/;

/**
 * The commit a run tested, for the GitHub check of the hosted layer. FLOWRETEST_GIT_REPOSITORY and FLOWRETEST_GIT_SHA
 * win; otherwise GitHub Actions variables. On a pull request GITHUB_SHA is the temporary merge commit, which no check
 * on the pull request page refers to, so the head commit comes from the event payload.
 */
export function gitContext(env: NodeJS.ProcessEnv = process.env): GitContext | undefined {
  let repository = env.FLOWRETEST_GIT_REPOSITORY ?? env.GITHUB_REPOSITORY;
  let sha = env.FLOWRETEST_GIT_SHA;
  let pullRequest: number | undefined;
  const ref = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || undefined;
  if (env.GITHUB_EVENT_PATH && existsSync(env.GITHUB_EVENT_PATH)) {
    try {
      const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as { pull_request?: { number?: number; head?: { sha?: string } } };
      pullRequest = event.pull_request?.number;
      sha ??= event.pull_request?.head?.sha;
    } catch {
      // A broken payload file only loses the pull request link.
    }
  }
  sha ??= env.GITHUB_SHA;
  if (!repository || !sha || !REPO.test(repository) || !SHA.test(sha)) return undefined;
  repository = repository.trim();
  return { repository, sha, ...(pullRequest ? { pullRequest } : {}), ...(ref ? { ref: ref.slice(0, 255) } : {}) };
}
