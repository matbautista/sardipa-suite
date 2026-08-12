#!/bin/sh
export WATCHDOG_START_COMMAND=node
export WATCHDOG_START_ARGS=server.js
exec node scripts/watchdog.mjs
