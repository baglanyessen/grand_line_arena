import { client } from '../src/db'

// Check the actual connection before mounting routes that can create accounts or games.
const expected = process.env.BROWSER_TEST_SCHEMA
if (!expected || !/^browser_test_[a-f0-9]{32}$/.test(expected)) throw new Error('Missing isolated browser-test schema')
const [row] = await client`SELECT current_schema() AS name`
if (row?.name !== expected) {
  await client.end()
  throw new Error('Browser backend refused a connection outside its isolated schema')
}
await import('../src/index')
