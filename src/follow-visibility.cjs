'use strict';
function followVisibility({ running, previousRunning, dismissed, background = false, enabled = true }) {
  if (!enabled) return { show: false, hide: false, dismissed };
  return { show: running && previousRunning !== true && !dismissed,
    hide: !running && (previousRunning === true || (previousRunning === null && background)),
    dismissed: running ? dismissed : false };
}
module.exports = { followVisibility };
