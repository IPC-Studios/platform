# Backup sidecar: pg_dump (matching the server major version) + rclone for the
# off-box copy. Alpine keeps it small enough that adding it to every deploy is
# free; rclone is used instead of hand-rolled S3 signing because a backup that
# silently fails to leave the box is worse than no backup at all.
FROM postgres:16-alpine

RUN apk add --no-cache rclone

COPY backup.sh restore.sh /backup/
RUN chmod +x /backup/backup.sh /backup/restore.sh

ENTRYPOINT ["/bin/sh", "/backup/backup.sh"]
CMD ["daemon"]
