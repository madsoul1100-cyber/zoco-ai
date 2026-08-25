#!/usr/bin/env bash
# Run on the EC2 box (Amazon Linux) after DNS for voice.my-leader.in points here.
set -euo pipefail
DOMAIN="${1:-voice.my-leader.in}"
EMAIL="${2:-}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo: sudo bash scripts/setup-https.sh $DOMAIN you@email.com"
  exit 1
fi
if [[ -z "$EMAIL" ]]; then
  echo "Usage: sudo bash scripts/setup-https.sh voice.my-leader.in you@email.com"
  exit 1
fi

if command -v dnf >/dev/null 2>&1; then
  dnf install -y nginx certbot python3-certbot-nginx
elif command -v yum >/dev/null 2>&1; then
  yum install -y nginx certbot python3-certbot-nginx
else
  apt-get update
  apt-get install -y nginx certbot python3-certbot-nginx
fi

systemctl enable --now nginx
mkdir -p /etc/nginx/conf.d
cat >/etc/nginx/conf.d/voice.conf <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        client_max_body_size 32m;
    }
    location /webhooks/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
    }
    location /embed/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location /widget {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
    }
}
EOF

nginx -t
systemctl reload nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
nginx -t
systemctl reload nginx
ss -tlnp | grep -E ':80|:443' || true
echo "https://${DOMAIN}/ should now be live."
