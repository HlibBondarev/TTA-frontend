import { db } from "./ttaDatabase";

const TEST_MATCH_ID = "6f2e8f1a-7b3c-4d5e-8f9a-0b1c2d3e4f70";
const TEST_TOURNAMENT_ID = "1f2e8f1a-7b3c-4d5e-8f9a-0b1c2d3e4f70";

/**
 * Seeds the local IndexedDB with minimal match and lineup data required for offline testing.
 */
export async function seedTestData(): Promise<void> {
  const existingLineups = await db.matchlineups
    .where("matchid")
    .equals(TEST_MATCH_ID)
    .count();

  if (existingLineups > 0) {
    return;
  }

  console.log("Seeding local IndexedDB with test match data...");

  await db.transaction("rw", [db.matches, db.matchlineups], async () => {
    // 1. Seed Match references
    await db.matches.add({
      id: TEST_MATCH_ID,
      tournamentid: TEST_TOURNAMENT_ID,
      hometeamid: "3f2e8f1a-7b3c-4d5e-8f9a-0b1c2d3e4f70",
      guestteamid: "4f2e8f1a-7b3c-4d5e-8f9a-0b1c2d3e4f70",
      scheduledat: new Date().toISOString(),
      matchnumber: "M01",
      venue: "Olympic Aquatics Arena",
      temperature: 26.5,
      homescore: null,
      guestscore: null,
      createdat: new Date().toISOString(),
    });

    // 2. Seed 13 Match Lineups (Players with Jersey Numbers 1 to 13)
    const mockLineups = Array.from({ length: 13 }, (_, i) => ({
      id: `a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c${(i + 1).toString(16).padStart(2, "0")}`,
      matchid: TEST_MATCH_ID,
      playerrosterid: `b1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c${(i + 1).toString(16).padStart(2, "0")}`,
      number: i + 1,
      isinstartinglineup: i < 7,
      positionid: null,
    }));

    await db.matchlineups.bulkAdd(mockLineups);
  });

  console.log("Database seeding completed successfully.");
}
