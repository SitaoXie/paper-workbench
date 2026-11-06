# Back up, move, and upgrade your workspace

[简体中文](UPGRADING.zh-CN.md) · [Back to README](../README.md)

Your papers live outside the application code. Updating Git does not back them up. Before upgrading, wait for imports and model generation to finish, then make a backup you can restore.

## A portable library backup

Open **Backup & restore** in the library, then choose **Download backup**. Keep the downloaded `.paperwork` file somewhere private. Creating a backup and restoring it do not call a model API.

The file includes:

- Paper metadata, extracted text and locally stored PDFs.
- Reading versions, translated readings, figure locations and interactive reading data.
- Highlights, notes, handwriting and saved passage explanations/translations.
- Folders, favorites and reading status.
- Conversations and uploaded chat images.

It excludes model connections and archived connections, credentials, `.env`, API usage, active conversation selection, recommendation caches and machine-specific paths. URLs containing query parameters or credentials are omitted from metadata. Your written notes and chat text remain intact: a backup is **not anonymized** and should not be published. Images of paper figures are regenerated from the included PDF; chat image attachments are included directly.

### Restore on another installation

1. Start the destination app. It can have an existing library.
2. Open **Backup & restore → Choose backup** and select the `.paperwork` file.
3. Review the paper, PDF, reading, note, conversation and folder counts.
4. Check the confirmation box and choose **Confirm restore**. Leave the page open until it finishes.
5. Open an imported PDF, a reading and a note to verify the result. Configure your own model connection separately if needed.

Restoration **adds copies**. It does not replace existing papers or settings. Paper, reading, note and conversation IDs are remapped together; imported top-level folders have a `restored` suffix. Importing the same backup again creates another copy. Retrying the same confirmed request within 15 minutes does not import twice. A preview expires after 15 minutes; select the file again if necessary.

The app validates format version, record relationships, PDF/image types, sizes and SHA-256 file checksums before accepting a restore. These checks detect corruption; they do not prove who created an archive. Use backups from a source you trust. Invalid or missing source files stop export instead of silently producing an incomplete backup.

### Size limits and recovery

Portable archives currently allow at most **100 MiB compressed**, **200 MiB decompressed JSON**, **75 MiB of PDF/image files**, **25 MiB per PDF**, **4 MiB per chat image**, and **10,000 papers**. These are archive safety limits, unrelated to model context or token budgets. Use the offline full backup below for a larger library or an exact rollback, including settings and usage.

If import fails, existing records are retained. Imported records are removed on a save failure; a compensating save preserves unrelated concurrent changes. If the disk is unavailable, repair storage before retrying. If the rollback also cannot be saved, the app reports this explicitly and retains staged PDFs that may be referenced by the last saved snapshot. Restart and inspect the library before importing again. Staged content-addressed chat images can remain as unused files after a failed restore; they do not appear in the library. Keep the original backup until you have checked the restored content.

## Offline full backup before an upgrade

This captures settings and secrets as well as the library, and is the right choice for a rollback. The default data directory is `.local-data/`; substitute your `DATA_DIR` if configured. If a custom data directory is a symlink, copy the actual directory contents, not just the link.

1. Wait for active requests to finish.
2. Stop the managed service with `npm run service:stop`. If you started `npm start` or `npm run dev` manually, stop that process too. Check `npm run service:status`; do not copy a store while another instance is writing it.
3. From the checkout, make a private backup **outside the repository**:

```sh
backup_dir="../paper-workbench-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$backup_dir"
cp -a .local-data "$backup_dir/data"
if [ -f .env ]; then cp .env "$backup_dir/.env"; fi
git rev-parse HEAD > "$backup_dir/revision.txt"
```

The full copy includes model keys, local endpoints, PDFs, chat attachments and `api-usage.jsonl`. Treat it like a password-bearing file. Do not commit or upload it publicly. Also retain any external service configuration your model proxy requires; it is not part of this app.

## Upgrade

Read the target release notes first, especially changes to storage. This project is actively developed; there is no guarantee that an older build can read a newer store.

With the service stopped and the full backup complete:

```sh
git status --short
git fetch --tags
# Choose the release you intend to run, or update your development branch.
git switch --detach <release-tag>
npm ci
npm run build
npm run service:start
```

If `git status` shows your own changes, preserve them before switching versions. Do not run a reset over local work. Git ignores `.env` and local runtime data, but still confirm those paths have not been added to a custom Git configuration.

After starting, verify the library count, folders, a PDF, an existing reading, a note, a conversation and the model settings. A newly saved note should still appear after restarting. For a development checkout, run `npm test`, `npm run build` and `npm run test:e2e` against fixtures; those checks do not replace inspecting your restored library.

## Roll back

Stop the service again. Restore **both** the backed-up code revision and matching data; importing a portable archive adds copies and is not a rollback.

1. Move the current data directory aside so you can recover any new work. Do not delete it.
2. Copy `backup_dir/data` back to the original data-directory location. Restore its matching `.env` privately if required.
3. Switch Git to the revision in `revision.txt`, run `npm ci` and `npm run build`, then start the service.
4. Check the same reading and notes before deleting any old backup.

Do not let two app processes write to the same data directory. Store upgrades occur during startup, so making the full backup **before** first starting the new version matters.
