#!/bin/sh
set -eu

# Only the public trust anchor is shared with the ILIAS container.
tls_dir=/run/ilias-mysql-tls
mkdir -p "$tls_dir"
openssl req -x509 -newkey rsa:2048 -nodes -days 365 -sha256 \
    -subj '/CN=mysql' -addext 'subjectAltName=DNS:mysql' \
    -keyout "$tls_dir/server.key" -out "$tls_dir/server.pem" 2>/dev/null
chown mysql:mysql "$tls_dir/server.key"
chmod 600 "$tls_dir/server.key"
cp "$tls_dir/server.pem" /run/ilias-mysql-trust/server.pem.new
chmod 644 /run/ilias-mysql-trust/server.pem.new
mv /run/ilias-mysql-trust/server.pem.new /run/ilias-mysql-trust/server.pem

exec docker-entrypoint.sh mariadbd "$@" \
    --ssl-cert="$tls_dir/server.pem" --ssl-key="$tls_dir/server.key"
