import Dexie, { type Table } from "dexie";

// Interfaces strictly aligned with OpenAPI camelCase DTOs
export interface TeamLookup {
  id: string;
  clubId: string;
  sportId: string;
  name: string;
  minBirthYear: number | null;
  gender: number; // 0: Male, 1: Female
  createdAt: string;
}

export interface TournamentLookup {
  id: string;
  sportId: string;
  configurationId: string;
  cityId: string;
  ownerId: string;
  name: string;
  startDate: string;
  endDate: string | null;
  createdAt: string;
}

export interface SportConfigurationLookup {
  id: string;
  sportId: string;
  usesCleanTime: boolean;
  periodsCount: number;
  periodDurationMinutes: number;
  fieldSize: string;
  rosterLimit: number;
  lineupLimit: number;
  activePlayersLimit: number;
}

export interface MatchLookup {
  id: string;
  tournamentId: string;
  homeTeamId: string;
  guestTeamId: string;
  scheduledAt: string;
  matchNumber: string | null;
  venue: string | null;
  temperature: number | null;
  homeScore: number | null;
  guestScore: number | null;
  createdAt: string;
}

export interface MatchLineupLookup {
  id: string;
  matchId: string;
  playerRosterId: string | null;
  number: number;
  isInStartingLineup: boolean;
  positionId: string | null;
}

export interface EventDefinitionLookup {
  id: string;
  sportId: string;
  name: string;
  shortName: string;
  isPositive: boolean;
  createdAt: string;
}

export interface GameEvent {
  id: string;
  matchLineupId: string;
  eventDefinitionId: string;
  periodNumber: number;
  eventTimestamp: string;
  isLeadToGoal: boolean;
  createdAt: string;

  // Frontend infrastructure tracking properties for offline syncing
  sequenceNumber: number;
  isSynced: number; // 0 = False, 1 = True
}

export interface TimeAnchor {
  id: string;
  matchId: string;
  periodNumber: number;
  type: number; // 0:PeriodStart, 1:PeriodEnd, 2:StoppageStart, 3:StoppageEnd
  timestamp: string;

  // Frontend infrastructure tracking properties for offline syncing
  sequenceNumber: number;
  isSynced: number; // 0 = False, 1 = True
}

export interface PlayerPresence {
  id: string;
  matchLineupId: string;
  periodNumber: number;
  timeIn: string;
  timeOut: string | null;

  // Frontend infrastructure tracking properties for offline syncing
  sequenceNumber: number;
  isSynced: number; // 0 = False, 1 = True
}

export interface SyncQueueItem {
  id?: number; // Auto-incremented local primary key
  actionType: "POST" | "PUT" | "DELETE";
  endpoint: string;
  payload: string; // JSON-serialized string of operational entity
  createdAt: string;
}

// Offline-First IndexedDB Controller using Dexie.js
export class TTADatabase extends Dexie {
  teams!: Table<TeamLookup, string>;
  matches!: Table<MatchLookup, string>;
  matchlineups!: Table<MatchLineupLookup, string>;
  eventdefinitions!: Table<EventDefinitionLookup, string>;
  gameevents!: Table<GameEvent, string>;
  timeanchors!: Table<TimeAnchor, string>;
  playerpresences!: Table<PlayerPresence, string>;
  syncQueue!: Table<SyncQueueItem, number>;
  tournaments!: Table<TournamentLookup, string>;
  sportconfigurations!: Table<SportConfigurationLookup, string>;

  constructor() {
    super("TTADatabase");

    // Schema configuration using camelCase index paths matching API DTOs
    this.version(1).stores({
      teams: "id, clubId, sportId",
      matches: "id, tournamentId, homeTeamId, guestTeamId, scheduledAt",
      matchlineups: "id, matchId, playerRosterId, number",
      eventdefinitions: "id, sportId, shortName",
      gameevents:
        "id, matchLineupId, eventDefinitionId, periodNumber, sequenceNumber, isSynced",
      timeanchors: "id, matchId, periodNumber, sequenceNumber, isSynced",
      playerpresences:
        "id, matchLineupId, periodNumber, sequenceNumber, isSynced",
      syncQueue: "++id, actionType, createdAt",
      tournaments: "id, sportId, configurationId",
      sportconfigurations: "id, sportId",
    });
  }
}

// Export singleton database controller instance
export const db = new TTADatabase();
