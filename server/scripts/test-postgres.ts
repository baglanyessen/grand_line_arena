const processResult = Bun.spawn([process.execPath, 'test', 'src/db/gameRepository.integration.test.ts', 'src/db/crewRepository.integration.test.ts', 'src/db/activeGames.integration.test.ts'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, RUN_POSTGRES_TESTS: '1' }, stdout: 'inherit', stderr: 'inherit',
})
process.exit(await processResult.exited)
import { fileURLToPath } from 'node:url'

