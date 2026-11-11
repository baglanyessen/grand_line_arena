// Versions order both increases and decreases; comparing balances would discard legitimate losses.
export function mergeBountyProfile(current, incoming) {
  if (!current || current.id !== incoming?.id || !Number.isSafeInteger(incoming.bountyVersion) ||
      incoming.bountyVersion < (current.bountyVersion ?? 0) ||
      !Number.isSafeInteger(incoming.bounty) || incoming.bounty < 0) return current
  return { ...current, bounty: incoming.bounty, bountyVersion: incoming.bountyVersion }
}
