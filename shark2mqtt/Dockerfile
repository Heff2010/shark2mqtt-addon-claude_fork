# Claude Shark2MQTT Home Assistant app wrapper.
#
# This builds FROM the bridge fork's shark2mqtt container
# (github.com/Heff2010/shark2mqtt-claude_fork), then replaces the
# entrypoint with a Home Assistant-aware run script.
#
# Home Assistant writes /data/options.json in a way that may only be
# readable by root. This wrapper intentionally starts as root so it can
# read add-on options, create /tmp/.X11-unix, and persist tokens in /data.
ARG SHARK2MQTT_VERSION=1.5.5-claude.2
FROM ghcr.io/heff2010/shark2mqtt:${SHARK2MQTT_VERSION}

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends jq curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY run.sh /run.sh
RUN chmod 755 /run.sh

ENV PYTHONUNBUFFERED=1

ENTRYPOINT ["/run.sh"]
