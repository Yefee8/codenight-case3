#!/bin/sh
set -eu
umask 077
cat > /tmp/fraudcell-users.acl <<EOF
user default off ~fraudcell:gateway:* +@read +@write +@connection +@transaction
user gateway on >${REDIS_PASSWORD} ~fraudcell:gateway:* +@read +@write +@connection +eval +evalsha -keys -flushall -flushdb -config
EOF
exec redis-server /etc/redis/redis.conf --aclfile /tmp/fraudcell-users.acl
