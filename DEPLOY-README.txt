This branch is generated. Do not edit it by hand.

Source:    https://github.com/ashyamctommy-eng/Digital-Store_Final (main)
Built by:  scripts/deploy-branch.mjs

The web root for this site is THIS directory.

These paths are NOT part of the repository and must survive a redeploy:
  api/config.php   bootstrap config (data_dir, admin_api_key)
  api/data/        order ledger, stock queue, settings.json

If your host's Git deploy removes untracked files, it will delete both,
and the store loses its orders and saved credentials with them. Back them
up before redeploying, and restore them afterwards.

After the first deploy:
  1. cp api/config.sample.php api/config.php  and set admin_api_key + data_dir
  2. chmod 755 api/data api/data/inventory
  3. Open /admin/configurations and paste the gateway credentials there.
