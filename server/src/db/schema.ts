import { pgTable, uuid, varchar, text, integer, bigint, timestamp, pgEnum, boolean, check, uniqueIndex, index, jsonb } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/* ─── Enums ───────────────────────────────────────────── */

export const crewRoleEnum = pgEnum('crew_role', ['captain', 'officer', 'member'])
export const gameResultEnum = pgEnum('game_result', ['white', 'black', 'draw', 'ongoing'])
export const warStatusEnum = pgEnum('war_status', ['pending', 'active', 'completed', 'cancelled'])
export const warMatchResultEnum = pgEnum('war_match_result', ['white', 'black', 'draw', 'pending'])

/* ─── Users ───────────────────────────────────────────── */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 32 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  rating: integer('rating').notNull().default(1200),
  bounty: bigint('bounty', { mode: 'number' }).notNull().default(0),
  bountyVersion: integer('bounty_version').notNull().default(0),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, table => [check('users_bounty_range', sql`${table.bounty} BETWEEN 0 AND 1000000000000`)])

/* ─── Games ───────────────────────────────────────────── */

export const games = pgTable('games', {
  id: uuid('id').primaryKey().defaultRandom(),
  whiteId: uuid('white_id').notNull().references(() => users.id),
  blackId: uuid('black_id').notNull().references(() => users.id),
  pgn: text('pgn').notNull().default(''),
  result: gameResultEnum('result').notNull().default('ongoing'),
  ratingChangeWhite: integer('rating_change_white'),
  ratingChangeBlack: integer('rating_change_black'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  endedAt: timestamp('ended_at'),
})

export const gameRewards = pgTable('game_rewards', {
  gameId: uuid('game_id').primaryKey().references(() => games.id),
  whiteDelta: integer('white_delta').notNull(),
  blackDelta: integer('black_delta').notNull(),
  whiteAfter: bigint('white_after', { mode: 'number' }).notNull(),
  blackAfter: bigint('black_after', { mode: 'number' }).notNull(),
  status: text('status').notNull(),
  policyVersion: integer('policy_version').notNull(),
  settledAt: timestamp('settled_at').notNull().defaultNow(),
}, table => [
  check('game_rewards_white_after_check', sql`${table.whiteAfter} BETWEEN 0 AND 1000000000000`),
  check('game_rewards_black_after_check', sql`${table.blackAfter} BETWEEN 0 AND 1000000000000`),
  check('game_rewards_status_check', sql`${table.status} IN ('awarded', 'draw', 'short_game', 'pair_limit')`),
])

/* ─── Crews ───────────────────────────────────────────── */

export const crews = pgTable('crews', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  tag: varchar('tag', { length: 10 }).notNull().unique(),
  description: text('description').default(''),
  captainId: uuid('captain_id').notNull().references(() => users.id),
  totalBounty: bigint('total_bounty', { mode: 'number' }).notNull().default(0), // Legacy cache; APIs derive totals from current members.
  maxMembers: integer('max_members').notNull().default(30),
  disbandedAt: timestamp('disbanded_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, table => [check('crews_positive_capacity', sql`${table.maxMembers} > 0`)])

/* ─── Crew Members ────────────────────────────────────── */

export const crewMembers = pgTable('crew_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id).unique('crew_members_user_unique'),
  crewId: uuid('crew_id').notNull().references(() => crews.id),
  role: crewRoleEnum('role').notNull().default('member'),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
}, table => [uniqueIndex('crew_members_one_captain').on(table.crewId).where(sql`${table.role} = 'captain'`),
  index('crew_members_crew_idx').on(table.crewId)])

/* ─── Crew Wars ───────────────────────────────────────── */

export const crewWars = pgTable('crew_wars', {
  id: uuid('id').primaryKey().defaultRandom(),
  challengerCrewId: uuid('challenger_crew_id').notNull().references(() => crews.id),
  defenderCrewId: uuid('defender_crew_id').notNull().references(() => crews.id),
  status: warStatusEnum('status').notNull().default('pending'),
  matchesPerSide: integer('matches_per_side').notNull().default(5), // captain picks this many fighters
  winnerCrewId: uuid('winner_crew_id').references(() => crews.id),
  challengerScoreHalf: integer('challenger_score_half').notNull().default(0),
  defenderScoreHalf: integer('defender_score_half').notNull().default(0),
  requestDeadline: timestamp('request_deadline').notNull().default(sql`(now() AT TIME ZONE 'UTC') + interval '24 hours'`),
  rosterDeadline: timestamp('roster_deadline'),
  endReason: text('end_reason'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  endedAt: timestamp('ended_at'),
})

/* ─── War Matches ─────────────────────────────────────── */

export const warMatches = pgTable('war_matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  warId: uuid('war_id').notNull().references(() => crewWars.id),
  boardNumber: integer('board_number').notNull(),
  whiteId: uuid('white_id').notNull().references(() => users.id),
  blackId: uuid('black_id').notNull().references(() => users.id),
  gameId: uuid('game_id').references(() => games.id),
  result: warMatchResultEnum('result').notNull().default('pending'),
  joinDeadline: timestamp('join_deadline').notNull().default(sql`(now() AT TIME ZONE 'UTC') + interval '24 hours'`),
  whiteReadyAt: timestamp('white_ready_at'),
  blackReadyAt: timestamp('black_ready_at'),
  endedAt: timestamp('ended_at'),
  endReason: text('end_reason'),
}, table => [uniqueIndex('war_matches_board_unique').on(table.warId, table.boardNumber)])

export const warFighters = pgTable('war_fighters', {
  id: uuid('id').primaryKey().defaultRandom(),
  warId: uuid('war_id').notNull().references(() => crewWars.id),
  crewId: uuid('crew_id').notNull().references(() => crews.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  position: integer('position').notNull(),
}, table => [uniqueIndex('war_fighters_user_unique').on(table.warId, table.userId),
  uniqueIndex('war_fighters_position_unique').on(table.warId, table.crewId, table.position),
  check('war_fighters_position_range', sql`${table.position} BETWEEN 0 AND 14`)])

export const warSettlements = pgTable('war_settlements', {
  warId: uuid('war_id').primaryKey().references(() => crewWars.id),
  status: text('status').notNull(),
  policyVersion: integer('policy_version').notNull(),
  settledAt: timestamp('settled_at').notNull().defaultNow(),
}, table => [check('war_settlements_status_check', sql`${table.status} IN ('awarded', 'short_games', 'pair_limit', 'forfeit')`)])

export const warRewards = pgTable('war_rewards', {
  id: uuid('id').primaryKey().defaultRandom(),
  warId: uuid('war_id').notNull().references(() => warSettlements.warId),
  userId: uuid('user_id').notNull().references(() => users.id),
  crewId: uuid('crew_id').notNull().references(() => crews.id),
  delta: integer('delta').notNull(),
  bountyAfter: bigint('bounty_after', { mode: 'number' }).notNull(),
}, table => [uniqueIndex('war_rewards_player_unique').on(table.warId, table.userId),
  check('war_rewards_delta_check', sql`${table.delta} BETWEEN 0 AND 200`),
  check('war_rewards_bounty_after_check', sql`${table.bountyAfter} BETWEEN 0 AND 1000000000000`)])


export const activeEngineOwner = pgTable('active_engine_owner', {
  id: boolean('id').primaryKey().default(true), token: uuid('token').notNull(),
}, table => [check('active_engine_owner_id_check', sql`${table.id}`)])
export const activeGames = pgTable('active_games', {
  id: uuid('id').primaryKey(), revision: integer('revision').notNull(), writeToken: uuid('write_token').notNull(),
  snapshot: jsonb('snapshot').$type<import('../ws/activeGameStore').StoredGame>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [check('active_games_revision_check', sql`${table.revision} > 0`)])
export const activeGamePlayers = pgTable('active_game_players', {
  userId: uuid('user_id').primaryKey().references(() => users.id),
  gameId: uuid('game_id').notNull().references(() => activeGames.id, { onDelete: 'cascade' }),
}, table => [index('active_game_players_game_idx').on(table.gameId)])


export const leadershipChallenges = pgTable('leadership_challenges', {
  id: uuid('id').primaryKey().defaultRandom(), crewId: uuid('crew_id').notNull().references(() => crews.id),
  challengerId: uuid('challenger_id').notNull().references(() => users.id), captainId: uuid('captain_id').notNull().references(() => users.id),
  status: text('status').notNull().default('pending'), challengerScoreHalf: integer('challenger_score_half').notNull().default(0),
  captainScoreHalf: integer('captain_score_half').notNull().default(0), winnerId: uuid('winner_id').references(() => users.id),
  requestDeadline: timestamp('request_deadline').notNull(), createdAt: timestamp('created_at').notNull().defaultNow(), endedAt: timestamp('ended_at'), endReason: text('end_reason'),
}, table => [uniqueIndex('leadership_one_open_per_crew').on(table.crewId).where(sql`${table.status} IN ('pending', 'active')`),
  check('leadership_distinct_players', sql`${table.challengerId} <> ${table.captainId}`),
  check('leadership_status_check', sql`${table.status} IN ('pending','active','completed','declined','cancelled','expired')`)])
export const leadershipMatches = pgTable('leadership_matches', {
  id: uuid('id').primaryKey().defaultRandom(), challengeId: uuid('challenge_id').notNull().references(() => leadershipChallenges.id),
  round: integer('round').notNull(), whiteId: uuid('white_id').notNull().references(() => users.id), blackId: uuid('black_id').notNull().references(() => users.id),
  gameId: uuid('game_id').unique().references(() => games.id), result: text('result').notNull().default('pending'),
  joinDeadline: timestamp('join_deadline').notNull(), whiteReadyAt: timestamp('white_ready_at'), blackReadyAt: timestamp('black_ready_at'),
  endedAt: timestamp('ended_at'), endReason: text('end_reason'),
}, table => [uniqueIndex('leadership_round_unique').on(table.challengeId, table.round),
  check('leadership_round_range', sql`${table.round} BETWEEN 1 AND 3`),
  check('leadership_result_check', sql`${table.result} IN ('pending','white','black','draw')`)])
