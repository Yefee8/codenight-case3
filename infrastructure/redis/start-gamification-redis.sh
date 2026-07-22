#!/bin/sh
set -eu
umask 077
cat > /tmp/fraudcell-users.acl <<EOF
user gamification on >${REDIS_PASSWORD} ~fraudcell:game:* +@read +@write +@connection -keys -flushall -flushdb -config
user default off
EOF
exec redis-server /etc/redis/redis.conf --aclfile /tmp/fraudcell-users.acl

