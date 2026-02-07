# Hexo Auto Deploy to VPS

## 0. Update Site URL
Edit `_config.yml` in project root:
- `url: https://your-domain.com`
- `root: /` (usually keep default)

## 1. Server Bootstrap (one-time)
```bash
sudo apt update
sudo apt install -y nginx rsync
sudo mkdir -p /var/www/hexo
sudo chown -R <deploy-user>:<deploy-user> /var/www/hexo
```

Copy `deploy/nginx/hexo.conf.example` to `/etc/nginx/sites-available/hexo`, then update:
- `server_name` -> your domain (for example: `blog.yourdomain.com`)
- `root` -> same path as `TARGET_DIR` in GitHub Secrets (for example: `/var/www/hexo`)

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/hexo /etc/nginx/sites-enabled/hexo
sudo nginx -t
sudo systemctl reload nginx
```

## 2. Domain Binding
- Add DNS record: `A` record `blog.yourdomain.com -> your VPS public IP`.
- After DNS takes effect, enable HTTPS:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d blog.yourdomain.com
```

## 3. GitHub Secrets
In `Settings -> Secrets and variables -> Actions`, add:
- `SERVER_HOST`: VPS IP or hostname
- `SERVER_PORT`: SSH port (default `22`)
- `SERVER_USER`: SSH user (recommend dedicated deploy user)
- `SERVER_SSH_KEY`: private key content (`ed25519` recommended)
- `TARGET_DIR`: deploy directory (for example: `/var/www/hexo`)

## 4. Workflow Trigger
- Workflow file: `.github/workflows/deploy-vps.yml`
- Trigger: push to `main`/`master` or manual `Run workflow`
- Pipeline: `npm ci` -> `npm run clean && npm run build` -> `rsync public/` to VPS

## 5. Troubleshooting
- `Permission denied`: confirm `SERVER_USER` can write to `TARGET_DIR`.
- `404`: confirm Nginx `root` equals `TARGET_DIR`.
- Broken asset URLs: check `_config.yml` `url` is your real domain.

