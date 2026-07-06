// Global test setup - loaded by vitest before each test file
import { vi } from 'vitest';

// Silence console output in tests unless explicitly needed
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
