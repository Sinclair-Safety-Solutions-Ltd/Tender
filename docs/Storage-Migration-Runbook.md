# Storage migration runbook

Use this when durable bytes need to move to another configured location. Product rows keep their ids. `locationId` records where the bytes currently are. Authorization stays in the application.

## Before the cutover

1. Set `STORAGE_LOCATIONS` (or `STORAGE_DRIVER` plus the object-store endpoint variables) so both the current location and the destination location exist.
2. Export a portable copy: `npm run storage:export -- ./storage-export`. Optional tenant filter: `STORAGE_EXPORT_TENANT`.
3. Confirm `storage-export/manifest.json` checksums match the files under `storage-export/files`.
4. If any rows still store bytes in Postgres, run `npm run storage:backfill` before the migration that drops `content`. That migration refuses to run while legacy bytes remain.

## Copy, verify, and flip

1. `npm run storage:relocate -- --to <destinationLocationId>`
2. The command copies each durable or archive object, checks the SHA-256, then points `StoredObject`, tender attachments, and verification documents at the destination.
3. Reads follow `locationId`, so this does not require downtime.
4. Source bytes stay in place until you pass `--remove-source`.

## Rollback

1. Leave the source location in configuration.
2. Run `npm run storage:relocate -- --to <previousLocationId>` before `--remove-source`.
3. If the source was already removed, restore from the export directory and run the relocate again onto the restored location.

## After the cutover

1. Confirm downloads for a tender attachment and a verification PDF.
2. Remove the source only after that check: `npm run storage:relocate -- --to <destinationLocationId> --remove-source`.
3. Keep `STORAGE_DIRECT_URLS` unset unless the destination driver should return short-lived URLs. Session downloads stay the default.
