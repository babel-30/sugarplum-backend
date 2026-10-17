# Brackish Roots

Node.js backend, storefront, builders, and administration for Brackish Roots.

## Runtime

Use Node 24. Install the locked dependencies with `npm ci`, run the isolated
checks with `npm test`, and start the service with `npm start`.

The backend serves the storefront itself. No separate static frontend service is
needed for this deployment. The health check is `/health`.

## Render sandbox deployment

- Keep `SQUARE_ENVIRONMENT=sandbox`. Changing `NODE_ENV` to `production` enables
  hosted security settings; it does not select Square's payment environment.
- Set `NODE_VERSION=24.11.1` and `NODE_ENV=production`.
- Attach a persistent disk at `/var/data`; set
  `DATA_DIR=/var/data/brackish-roots`.
- Set `PUBLIC_SITE_URL` to the verified public HTTPS address.
- Keep `MAIL_DISABLED=true` during migration and initial verification.
- Supply existing Square, SMTP, admin, and session secrets through Render's
  private environment settings. Never commit them.
- Configure the exact public Square webhook URL and its sandbox signature key
  before testing payment callbacks.

## Business data

The SQLite database, saved JSON configurations, patch/apparel artwork, private
customer attachments, and generated assets belong under `DATA_DIR`. Migrate
them privately before making the replacement service available. An empty source
checkout is not a business-data restore.

Databases, environment files, saved root configurations, and `public/uploads`
are excluded from new source commits. Older repository history may still contain
legacy files; ignoring a file does not remove earlier commits.

Only a consistent SQLite snapshot may be transferred. Do not copy a live database
without its journal or a SQLite-supported snapshot. Restore into the new
`brackish-roots` directory with the backend stopped, preserving relative upload
paths. Do not restore local admin sessions onto the hosted service.

## Verification before launch

Verify persistence after a redeploy, storefront assets and configured products,
admin login, custom request attachments, quotes and approvals, team shops,
Square sandbox payment callbacks and inventory, branded email delivery and public
links, and mobile layouts. Keep real payments disabled until the owner explicitly
approves production.

