#!/bin/sh
set -eu

realm="${SAMBA_REALM:-UAR.TEST}"
domain="${SAMBA_DOMAIN:-UAR}"
admin_password="${SAMBA_ADMIN_PASSWORD:-Fixture-admin-42!}"
user_password="${BROWSER_TEST_USER_PASSWORD:-Fixture-only-42!}"
tls_dir=/var/lib/samba/private/tls
provisioned_marker=/var/lib/samba/browser-provisioned

if [ ! -f "$provisioned_marker" ]; then
  find /var/lib/samba -mindepth 1 -maxdepth 1 ! -name private -exec rm -rf {} +
  mkdir -p /var/lib/samba/private
  find /var/lib/samba/private -mindepth 1 -maxdepth 1 ! -name tls -exec rm -rf {} +
  rm -f /etc/samba/smb.conf
  samba-tool domain provision --use-rfc2307 --realm="$realm" --domain="$domain" --server-role=dc --dns-backend=SAMBA_INTERNAL --adminpass="$admin_password"
  cp /etc/samba/smb.conf /var/lib/samba/browser-smb.conf
  touch "$provisioned_marker"
elif [ -f /var/lib/samba/browser-smb.conf ]; then
  cp /var/lib/samba/browser-smb.conf /etc/samba/smb.conf
fi

mkdir -p "$tls_dir"
if [ ! -f "$tls_dir/ca.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 7 -subj '/CN=UAR Browser Test CA' -keyout "$tls_dir/ca-key.pem" -out "$tls_dir/ca.pem"
  openssl req -newkey rsa:2048 -nodes -subj '/CN=directory' -keyout "$tls_dir/key.pem" -out "$tls_dir/server.csr"
  printf 'subjectAltName=DNS:directory,DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' > "$tls_dir/server.ext"
  openssl x509 -req -days 7 -in "$tls_dir/server.csr" -CA "$tls_dir/ca.pem" -CAkey "$tls_dir/ca-key.pem" -CAcreateserial -extfile "$tls_dir/server.ext" -out "$tls_dir/cert.pem"
  chmod 0600 "$tls_dir/key.pem" "$tls_dir/ca-key.pem"
fi

cat >> /etc/samba/smb.conf <<EOF
tls enabled = yes
tls keyfile = $tls_dir/key.pem
tls certfile = $tls_dir/cert.pem
tls cafile = $tls_dir/ca.pem
EOF

samba --foreground --no-process-group &
samba_pid=$!
trap 'kill "$samba_pid" 2>/dev/null || true; wait "$samba_pid" 2>/dev/null || true' INT TERM EXIT

attempt=0
until samba-tool domain info 127.0.0.1 >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  sleep 1
done

for group in role-group-assignee role-director role-faculty role-message-admin role-directory-admin role-ticket-admin role-audit-exporter role-user-manager role-full-admin; do
  samba-tool group show "$group" >/dev/null 2>&1 || samba-tool group add "$group" >/dev/null
done

for user in user-owner group-assignee director faculty message-admin directory-admin ticket-admin audit-exporter user-manager full-admin; do
  samba-tool user show "$user" >/dev/null 2>&1 || samba-tool user create "$user" "$user_password" --given-name="Browser" --surname="${user}" --mail-address="${user}@uar.test" >/dev/null
done

for membership in \
  'role-group-assignee:group-assignee' \
  'role-director:director' \
  'role-faculty:faculty' \
  'role-message-admin:message-admin' \
  'role-directory-admin:directory-admin' \
  'role-ticket-admin:ticket-admin' \
  'role-audit-exporter:audit-exporter' \
  'role-user-manager:user-manager' \
  'role-full-admin:full-admin'; do
  group=${membership%%:*}
  user=${membership#*:}
  samba-tool group listmembers "$group" | grep -Fxq "$user" || samba-tool group addmembers "$group" "$user" >/dev/null
done

touch /var/lib/samba/browser-fixtures-ready

wait "$samba_pid"
