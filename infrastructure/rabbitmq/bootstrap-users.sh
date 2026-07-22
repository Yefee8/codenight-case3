#!/bin/sh
set -eu

admin() {
  rabbitmqadmin \
    --host rabbitmq \
    --username "$RABBITMQ_BOOTSTRAP_USER" \
    --password "$RABBITMQ_BOOTSTRAP_PASSWORD" \
    "$@"
}

attempt=0
until admin list vhosts >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "RabbitMQ management API did not become ready" >&2
    exit 1
  fi
  sleep 2
done

declare_service_user() {
  service="$1"
  username="$2"
  password="$3"
  event_pattern="$4"

  queue_pattern="^fraudcell\\.${service}\\.(events|retry\\..*|dlq)\\.v1$"
  exchange_pattern="^fraudcell\\.(events|retry|dlx)\\.v1$"
  retry_pattern="^${service}\\.(ready|5s|30s|2m|10m|30m)$"

  admin declare user name="$username" password="$password" tags=""
  admin declare permission vhost=/ user="$username" configure='^$' write="$exchange_pattern" read="$queue_pattern"
  admin declare topic_permission vhost=/ user="$username" exchange=fraudcell.events.v1 write="$event_pattern" read='.*'
  admin declare topic_permission vhost=/ user="$username" exchange=fraudcell.retry.v1 write="$retry_pattern" read='.*'
  admin declare topic_permission vhost=/ user="$username" exchange=fraudcell.dlx.v1 write="^${service}$" read='.*'
}

declare_service_user \
  identity \
  "$IDENTITY_RABBITMQ_USER" \
  "$IDENTITY_RABBITMQ_PASSWORD" \
  '^(staff\.(created|profile-updated|status-changed)|role\.changed|sessions\.revoked|audit\.record-requested)$'

declare_service_user \
  transaction \
  "$TRANSACTION_RABBITMQ_USER" \
  "$TRANSACTION_RABBITMQ_PASSWORD" \
  '^(transaction\.(created|risk-assessed|analysis-unavailable)|case\.(created|assigned|status-changed|customer-verification-requested|customer-verification-responded|fraud-type-overridden|risk-level-overridden|decision-recorded|sla-breached|closed|feedback-submitted|ground-truth-set)|audit\.record-requested)$'

declare_service_user \
  ai \
  "$AI_RABBITMQ_USER" \
  "$AI_RABBITMQ_PASSWORD" \
  '^(ai\.(prediction-created|classification-evaluated|model-activated|assignment-recommended)|audit\.record-requested)$'

declare_service_user \
  gamification \
  "$GAMIFICATION_RABBITMQ_USER" \
  "$GAMIFICATION_RABBITMQ_PASSWORD" \
  '^(points\.changed|badge\.earned|level\.changed|audit\.record-requested)$'

declare_service_user \
  gateway \
  "$GATEWAY_RABBITMQ_USER" \
  "$GATEWAY_RABBITMQ_PASSWORD" \
  '^$'

echo "RabbitMQ least-privilege application users are ready"
