#!/usr/bin/env bash
# Keeps the measurement queue alive, across crashes and across reboots.
#
# TO STOP EVERYTHING:   touch /home/emyot/detour/tools/lab/STOP
# That is checked every two minutes and also at boot, so it is enough on its own -- no need to
# hunt processes or edit crontabs. Delete the file to start again.
cd "$(dirname "$0")"
while true; do
  if [ -f STOP ]; then
    echo "$(date '+%F %H:%M') STOP present, arret du chien de garde" >> watch.log
    # Everything the harness starts, and nothing else: each pattern names a script that lives
    # in this directory, so no unrelated node or python process on the machine is touched.
    for pat in 'node .*parmatch\.js' 'node .*netmatch\.js' 'node .*engmatch\.js' \
               'node .*ttsize\.js' 'node .*gen\.js' 'bash \./night' 'bash \./ablate\.sh'; do
      pkill -f "$pat" 2>/dev/null
    done
    exit 0
  fi
  # Start nothing while a queue is already running: this sits behind whatever was launched
  # first and takes over the moment it stops, finished or not.
  if ! pgrep -f 'bash \./night\.sh|bash \./night2\.sh|bash \./nightq\.sh' > /dev/null; then
    echo "$(date '+%F %H:%M') relance de la file" >> watch.log
    ./nightq.sh >> nightq.log 2>&1
  fi
  sleep 120
done
