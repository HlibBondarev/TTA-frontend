import "@testing-library/jest-dom";
import "fake-indexeddb/auto"; // Globally mocks IndexedDB for Dexie during unit testing
import { vi } from "vitest";

// Reset mocks after each test run
afterEach(() => {
  vi.clearAllMocks();
});
