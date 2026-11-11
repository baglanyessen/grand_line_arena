import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeBountyProfile } from './bounty.js'

test('newer bounty updates accept losses without replacing account details', () => {
  const current = { id: 'alice', username: 'Alice', bounty: 200, bountyVersion: 2 }
  assert.deepEqual(mergeBountyProfile(current, { id: 'alice', bounty: 150, bountyVersion: 3 }),
    { ...current, bounty: 150, bountyVersion: 3 })
})

test('delayed, malformed and other-account bounty events cannot overwrite the profile', () => {
  const current = { id: 'alice', bounty: 100, bountyVersion: 2 }
  for (const update of [{ id: 'bob', bounty: 999, bountyVersion: 3 },
    { id: 'alice', bounty: 200, bountyVersion: 1 }, { id: 'alice', bounty: -50, bountyVersion: 3 },
    { id: 'alice', bounty: 200 }, null]) assert.equal(mergeBountyProfile(current, update), current)
  assert.equal(mergeBountyProfile(null, { id: 'alice', bounty: 100, bountyVersion: 3 }), null)
})
