// Builds a map's level away from the page (main.js levelOf), so paging through the maps in a menu never freezes it. The
// level is plain data, so it comes back whole.
import { generateLevel } from './level.js';

self.onmessage = (e) => {
  const { id, n } = e.data || {};
  try {
    self.postMessage({ n, level: generateLevel(id) });
  } catch (err) {
    self.postMessage({ n, err: String(err) });
  }
};
