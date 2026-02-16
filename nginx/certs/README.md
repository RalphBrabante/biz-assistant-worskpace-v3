Place your Cloudflare Origin Certificate files here:

- `fullchain.pem`
- `privkey.pem`

These files are mounted read-only into the nginx container at:

- `/etc/nginx/certs/fullchain.pem`
- `/etc/nginx/certs/privkey.pem`

Never commit real certificate or private key files to git.
