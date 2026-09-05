FROM debian:bookworm-slim

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends samba samba-ad-provision samba-dsdb-modules samba-vfs-modules krb5-user winbind smbclient openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/browser-directory
RUN chmod 0755 /usr/local/bin/browser-directory

EXPOSE 636
ENTRYPOINT ["/usr/local/bin/browser-directory"]
