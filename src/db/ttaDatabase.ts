import Dexie, { type Table } from "dexie";

// Interfaces strictly mapped to PostgreSQL schemas from 01-Tables.sql
export interface TeamLookup {
  id: string; // UUID in PostgreSQL
  clubid: string; // UUID
  sportid: string; // UUID
  name: string; // VARCHAR(100)
  minbirthyear: number | null; // INT NULL
  gender: number; // INT (0: Male, 1: Female)
  createdat: string; // TIMESTAMPTZ
}

export interface TournamentLookup {
  id: string; // UUID in PostgreSQL
  sportid: string; // UUID
  configurationid: string; // UUID
  cityid: string; // UUID
  ownerid: string; // VARCHAR(64)
  name: string; // VARCHAR(200)
  startdate: string; // TIMESTAMPTZ
  enddate: string | null; // TIMESTAMPTZ NULL
  createdat: string; // TIMESTAMPTZ
}

export interface SportConfigurationLookup {
  id: string; // UUID in PostgreSQL
  sportid: string; // UUID
  usescleantime: boolean; // BOOLEAN
  periodscount: number; // INT
  perioddurationminutes: number; // INT
  fieldsize: string; // VARCHAR(50)
  rosterlimit: number; // INT
  lineuplimit: number; // INT
  activeplayerslimit: number; // INT (DEFAULT 7)
}

export interface MatchLookup {
  id: string; // UUID in PostgreSQL
  tournamentid: string; // UUID
  hometeamid: string; // UUID
  guestteamid: string; // UUID
  scheduledat: string; // TIMESTAMPTZ
  matchnumber: string | null; // VARCHAR(50) NULL
  venue: string | null; // VARCHAR(200) NULL
  temperature: number | null; // FLOAT NULL
  homescore: number | null; // INT NULL
  guestscore: number | null; // INT NULL
  createdat: string; // TIMESTAMPTZ
}

export interface MatchLineupLookup {
  id: string; // UUID in PostgreSQL
  matchid: string; // UUID
  playerrosterid: string | null; // UUID NULL
  number: number; // INT (Jersey number or placeholders -1/-2)
  isinstartinglineup: boolean; // BOOLEAN
  positionid: string | null; // UUID NULL
}

export interface EventDefinitionLookup {
  id: string; // UUID in PostgreSQL
  sportid: string; // UUID
  name: string; // VARCHAR(50)
  shortname: string; // VARCHAR(10)
  ispositive: boolean; // BOOLEAN
  createdat: string; // TIMESTAMPTZ
}

export interface GameEvent {
  id: string; // UUID in PostgreSQL
  matchlineupid: string; // UUID
  eventdefinitionid: string; // UUID
  periodnumber: number; // INT
  eventtimestamp: string; // TIMESTAMPTZ
  normalizedmatchtime: string | null; // INTERVAL NULL (mapped as string)
  isleadtogoal: boolean; // BOOLEAN
  createdat: string; // TIMESTAMPTZ

  // Frontend infrastructure tracking properties for offline syncing
  sequenceNumber: number;
  isSynced: number; // 0 = False, 1 = True
}

export interface TimeAnchor {
  id: string; // UUID in PostgreSQL
  matchid: string; // UUID
  periodnumber: number; // INT
  type: number; // INT (0:PeriodStart, 1:PeriodEnd, 2:StoppageStart, 3:StoppageEnd)
  timestamp: string; // TIMESTAMPTZ

  // Frontend infrastructure tracking properties for offline syncing
  sequenceNumber: number;
  isSynced: number; // 0 = False, 1 = True
}

export interface PlayerPresence {
  id: string; // UUID in PostgreSQL
  matchlineupid: string; // UUID
  periodnumber: number; // INT
  timein: string; // TIMESTAMPTZ
  timeout: string | null; // TIMESTAMPTZ NULL

  // Frontend infrastructure tracking properties for offline syncing
  sequenceNumber: number;
  isSynced: number; // 0 = False, 1 = True
}

export interface SyncQueueItem {
  id?: number; // Auto-incremented local primary key
  actionType: "POST" | "PUT" | "DELETE";
  endpoint: string;
  payload: string; // JSON-serialized string of operational entity
  createdAt: string; // TIMESTAMPTZ format
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
  // 👇 New tables added for match rules configuration traversal
  tournaments!: Table<TournamentLookup, string>;
  sportconfigurations!: Table<SportConfigurationLookup, string>;

  constructor() {
    super("TTADatabase");

    // Schema configuration using strict database keys and query-optimized indexes
    this.version(1).stores({
      teams: "id, clubid, sportid",
      matches: "id, tournamentid, hometeamid, guestteamid, scheduledat",
      matchlineups: "id, matchid, playerrosterid, number",
      eventdefinitions: "id, sportid, shortname",
      gameevents:
        "id, matchlineupid, eventdefinitionid, periodnumber, sequenceNumber, isSynced",
      timeanchors: "id, matchid, periodnumber, sequenceNumber, isSynced",
      playerpresences:
        "id, matchlineupid, periodnumber, sequenceNumber, isSynced",
      syncQueue: "++id, actionType, createdAt",
      // 👇 Added configuration tables mapping
      tournaments: "id, sportid, configurationid",
      sportconfigurations: "id, sportid",
    });
  }
}

// Export singleton database controller instance
export const db = new TTADatabase();
