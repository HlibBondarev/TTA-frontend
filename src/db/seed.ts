import { db } from "./ttaDatabase";

const TEST_MATCH_ID = "6f2e8f1a-7b3c-4d5e-8f9a-0b1c2d3e4f70";
const TEST_TOURNAMENT_ID = "1f2e8f1a-7b3c-4d5e-8f9a-0b1c2d3e4f70";
const TEST_SPORT_ID = "5f2e8f1a-7b3c-4d5e-8f9a-0b1c2d3e4f70";

const DEFAULT_EVENT_DEFINITIONS = [
  // Positive Actions
  { name: "Goal", shortName: "GL", isPositive: true },
  { name: "Pass", shortName: "PS", isPositive: true },
  { name: "Save", shortName: "SV", isPositive: true },
  { name: "Block", shortName: "BLK", isPositive: true },
  { name: "Steal", shortName: "STL", isPositive: true },
  // Negative Actions
  { name: "Miss", shortName: "MS", isPositive: false },
  { name: "Turnover", shortName: "TO", isPositive: false },
  { name: "Error", shortName: "ERR", isPositive: false },
  { name: "Foul", shortName: "FL", isPositive: false },
];

/**
 * Seeds the local IndexedDB with minimal match, lineup, and event definition data required for offline testing.
 */
export async function seedTestData(): Promise<void> {
  const existingLineupsCount = await db.matchlineups
    .where("matchId")
    .equals(TEST_MATCH_ID)
    .count();

  // Fetch existing definitions to check against the expected water polo set
  const existingDefs = await db.eventdefinitions.toArray();
  const existingShortnames = new Set(
    existingDefs.map((def) => def.shortName.toUpperCase()),
  );

  // Filter out definitions that are already present in IndexedDB
  const missingDefs = DEFAULT_EVENT_DEFINITIONS.filter(
    (def) => !existingShortnames.has(def.shortName.toUpperCase()),
  );

  // Return early only if both test lineups and all expected event definitions exist
  if (existingLineupsCount > 0 && missingDefs.length === 0) {
    return;
  }

  console.log("Seeding local IndexedDB with test match data...");

  await db.transaction(
    "rw",
    [db.matches, db.matchlineups, db.eventdefinitions],
    async () => {
      // 1. Seed Match references and Lineups if missing
      if (existingLineupsCount === 0) {
        const existingMatch = await db.matches.get(TEST_MATCH_ID);
        if (!existingMatch) {
          await db.matches.add({
            id: TEST_MATCH_ID,
            tournamentId: TEST_TOURNAMENT_ID,
            homeTeamId: "3f2e8f1a-7b3c-4d5e-8f9a-0b1c2d3e4f70",
            guestTeamId: "4f2e8f1a-7b3c-4d5e-8f9a-0b1c2d3e4f70",
            scheduledAt: new Date().toISOString(),
            matchNumber: "M01",
            venue: "Olympic Aquatics Arena",
            temperature: 26.5,
            homeScore: null,
            guestScore: null,
            createdAt: new Date().toISOString(),
          });
        }

        const mockLineups = Array.from({ length: 13 }, (_, i) => ({
          id: `a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c${(i + 1).toString(16).padStart(2, "0")}`,
          matchId: TEST_MATCH_ID,
          playerRosterId: `b1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c${(i + 1).toString(16).padStart(2, "0")}`,
          number: i + 1,
          isInStartingLineup: i < 7,
          positionId: null,
        }));

        await db.matchlineups.bulkAdd(mockLineups);
      }

      // 2. Seed missing Event Definitions only
      if (missingDefs.length > 0) {
        const eventDefsToSeed = missingDefs.map((def, index) => ({
          id: `e1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c${(existingDefs.length + index + 1).toString(16).padStart(2, "0")}`,
          sportId: TEST_SPORT_ID,
          name: def.name,
          shortName: def.shortName,
          isPositive: def.isPositive,
          createdAt: new Date().toISOString(),
        }));

        await db.eventdefinitions.bulkAdd(eventDefsToSeed);
      }
    },
  );

  console.log("Database seeding completed successfully.");
}
